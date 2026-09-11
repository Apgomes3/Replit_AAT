import { Router, Response } from 'express';
import pool, { query, withTransaction } from '../db';
import { authenticate, requireRole, requireModuleAccess, requireModuleManage, AuthRequest } from '../middleware/auth';
import { logAudit } from '../db/audit';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import {
  AQUARIUM_CALCULATION_VERSION,
  calculateExhibitHydraulics,
  calculateFoamFractionatorCapacity,
  calculateSandFilterCapacity,
  compatibleWaterTypes,
  evaluateCompactUnit,
} from '../lib/aquariumCalculations';
import { calculateWaterSurfaceAreaM2 } from '../lib/tankCalculations';
import {
  CustomFootprintValidationError,
  normalizeCustomFootprint,
  summarizeCustomFootprint,
} from '../lib/customFootprint';
import {
  isRetiredSystem,
  loadEditableSystem,
  systemLifecycleError,
} from '../lib/systemLifecycle';
import { isLifeSupportSystem } from '../lib/lssSystems';
import { resolveLoopFlows } from '../lib/flowRoute';
import PDFDocument from 'pdfkit';
import { buildTankDesignSheet } from '../lib/tankDesignSheet';

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const privateDocumentUploadsDir = path.join(__dirname, '../../private-uploads/documents');
if (!fs.existsSync(privateDocumentUploadsDir)) fs.mkdirSync(privateDocumentUploadsDir, { recursive: true });
const logoStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_, file, cb) => {
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    cb(null, `logo-${unique}${path.extname(file.originalname)}`);
  },
});
const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
});
const documentStorage = multer.diskStorage({
  destination: privateDocumentUploadsDir,
  filename: (_, file, cb) => {
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    cb(null, `document-${unique}${path.extname(file.originalname)}`);
  },
});
const uploadProjectDocument = multer({
  storage: documentStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

function removeUploadedFile(file?: Express.Multer.File) {
  if (!file) return;
  try {
    fs.unlinkSync(file.path);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') console.error('Failed to clean up project document upload', error);
  }
}

const router = Router();
router.use(authenticate);
router.use((req: AuthRequest, res: Response, next) => {
  // Lifecycle and audit feeds are shared platform services used by other
  // modules such as Design Books and Documents.
  if (req.path.startsWith('/lifecycle/') || req.path.startsWith('/audit/')) return next();
  return requireModuleAccess('projects')(req, res, next);
});

const paginate = (req: any) => {
  const page = parseInt(req.query.page) || 1;
  const page_size = Math.min(parseInt(req.query.page_size) || 25, 200);
  const offset = (page - 1) * page_size;
  return { page, page_size, offset };
};

const buildSort = (sort?: string, allowed = ['project_code', 'project_name', 'project_status', 'created_at']) => {
  if (!sort) return 'created_at DESC';
  const dir = sort.startsWith('-') ? 'DESC' : 'ASC';
  const col = sort.replace(/^-/, '');
  return allowed.includes(col) ? `${col} ${dir}` : 'created_at DESC';
};

const tankNumericFields = {
  length_mm: 'Length',
  width_mm: 'Width',
  height_mm: 'Height',
  design_water_level_mm: 'Water level',
  overflow_level_mm: 'Overflow level',
  gross_volume_m3: 'Gross volume',
  operating_volume_m3: 'Operating volume',
  surface_area_m2: 'Water-surface area',
} as const;

function tankNumberError(value: unknown, field: keyof typeof tankNumericFields) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (Number.isFinite(number) && number >= 0) return null;
  return {
    code: 'VALIDATION',
    field,
    message: `${tankNumericFields[field]} must be a non-negative number.`,
  };
}

function tankDatabaseField(error: any): string | undefined {
  const source = `${error?.constraint || ''} ${error?.column || ''}`.toLowerCase();
  const fields = [
    'tank_code', 'tank_name', 'project_id', 'exhibit_id', 'system_id',
    'product_master_id', 'material_id', ...Object.keys(tankNumericFields),
  ];
  return fields.find(field => source.includes(field));
}

function tankDatabaseResponse(error: any) {
  const field = tankDatabaseField(error);
  return {
    code: error?.code === '23503' ? 'INVALID_REFERENCE' : 'INVALID_REQUEST',
    message: field
      ? `The selected ${field.replace(/_mm$/, '').replace(/_/g, ' ')} is no longer valid.`
      : 'The tank could not be saved. Check the tank details and try again.',
    ...(field ? { field } : {}),
  };
}

function overflowLevelValidation(overflow: unknown, effectiveWaterLevel: unknown) {
  if (overflow === undefined || overflow === null || overflow === '') return null;
  const level = Number(overflow);
  if (!Number.isFinite(level) || level < 0) {
    return { code: 'VALIDATION', field: 'overflow_level_mm', message: 'Overflow level must be a non-negative number.' };
  }
  const maximum = effectiveWaterLevel === undefined || effectiveWaterLevel === null || effectiveWaterLevel === ''
    ? null : Number(effectiveWaterLevel);
  if (maximum != null && Number.isFinite(maximum) && level <= maximum) {
    return { code: 'VALIDATION', field: 'overflow_level_mm', message: 'Overflow level must be above the effective maximum/design water level.' };
  }
  return null;
}

const FLOW_SIDE_STREAM_PRESETS = ['Thermal', 'UV', 'Custom'] as const;

function withoutStaleLinkedSystemFlow(system: any) {
  const source = system?.calculation_inputs?.design_flow_source === 'manual_override'
    ? 'manual_override'
    : 'linked_exhibits';
  return {
    ...system,
    design_flow_m3h: source === 'manual_override' ? system.design_flow_m3h : null,
    design_flow_source: source,
  };
}

function normalizeSideStreams(value: unknown) {
  if (!Array.isArray(value)) return null;
  const normalized = value.map((stream: any, index: number) => {
    const parentLoopNumber = Number(stream?.parent_loop_number);
    const name = String(stream?.name || '').trim();
    const flowPct = stream?.flow_pct == null || stream.flow_pct === ''
      ? Number.NaN
      : Number(stream.flow_pct);
    const preset = stream?.preset == null || stream.preset === ''
      ? null
      : String(stream.preset).trim();
    if (!Number.isInteger(parentLoopNumber) || parentLoopNumber < 1 || parentLoopNumber > 3) {
      throw new Error(`Side stream ${index + 1} must belong to Loop 1, Loop 2, or Loop 3.`);
    }
    if (!name) throw new Error(`Side stream ${index + 1} requires a name.`);
    if (name.length > 255) throw new Error(`Side stream ${index + 1} name must be 255 characters or fewer.`);
    if (!Number.isFinite(flowPct) || flowPct < 0 || flowPct > 100) {
      throw new Error(`${name} allocation must be between 0% and 100%.`);
    }
    if (preset && !FLOW_SIDE_STREAM_PRESETS.includes(preset as any)) {
      throw new Error(`${name} has an unsupported preset.`);
    }
    const uvRevisionId = stream?.uv_revision_id == null || stream.uv_revision_id === ''
      ? null : String(stream.uv_revision_id);
    const uvUnitQuantity = stream?.uv_unit_quantity == null || stream.uv_unit_quantity === ''
      ? null : Number(stream.uv_unit_quantity);
    if (uvUnitQuantity != null && (!Number.isInteger(uvUnitQuantity) || uvUnitQuantity < 1)) {
      throw new Error(`${name} UV unit quantity must be a positive integer.`);
    }
    const uvtBasis = stream?.uvt_basis == null || stream.uvt_basis === ''
      ? '85T' : String(stream.uvt_basis).toUpperCase();
    if (!['85T', '95T'].includes(uvtBasis)) {
      throw new Error(`${name} UVT basis must be 85T or 95T.`);
    }
    const dedicatedPumpValue = stream?.has_dedicated_pump ?? stream?.dedicated_pump;
    const hasDedicatedPump = dedicatedPumpValue == null
      ? null
      : dedicatedPumpValue === true || dedicatedPumpValue === 1 ||
        dedicatedPumpValue === '1' || dedicatedPumpValue === 'true';
    return {
      id: stream?.id ? String(stream.id) : null,
      parent_loop_number: parentLoopNumber,
      name,
      preset,
      flow_pct: flowPct,
      notes: stream?.notes == null || stream.notes === '' ? null : String(stream.notes),
      sort_order: Number.isInteger(Number(stream?.sort_order)) ? Number(stream.sort_order) : index,
      uv_revision_id: uvRevisionId,
      uv_unit_quantity: uvUnitQuantity,
      uvt_basis: uvtBasis,
      has_dedicated_pump: hasDedicatedPump,
    };
  });
  return normalized;
}

async function loadSystemSideStreams(
  systemId: string,
  runner: (text: string, params?: any[]) => Promise<{ rows: any[] }> = query,
) {
  return (await runner(
    `SELECT * FROM system_flow_side_streams
     WHERE system_id=$1
     ORDER BY parent_loop_number, sort_order, created_at, id`,
    [systemId],
  )).rows;
}

async function loadSystemFractionatorAllocations(
  systemId: string,
  runner: (text: string, params?: any[]) => Promise<{ rows: any[] }> = query,
) {
  return (await runner(
    `SELECT * FROM system_flow_fractionator_allocations
     WHERE system_id=$1 ORDER BY parent_loop_number`,
    [systemId],
  )).rows;
}

async function loadSystemSandFilterAllocations(
  systemId: string,
  runner: (text: string, params?: any[]) => Promise<{ rows: any[] }> = query,
) {
  return (await runner(
    `SELECT * FROM system_flow_sand_filter_allocations
     WHERE system_id=$1 ORDER BY parent_loop_number`,
    [systemId],
  )).rows;
}

async function normalizeSandFilterAllocations(
  value: unknown,
  system: any,
  runner: (text: string, params?: any[]) => Promise<{ rows: any[] }> = query,
  existingSnapshots: Map<string, any> = new Map(),
) {
  if (!Array.isArray(value)) return null;
  const seenLoops = new Set<number>();
  const normalized = [];
  for (const [index, allocation] of value.entries()) {
    const loopNumber = Number(allocation?.parent_loop_number);
    if (!Number.isInteger(loopNumber) || loopNumber < 1 || loopNumber > 3 || seenLoops.has(loopNumber)) {
      throw new Error(`Sand Filter allocation ${index + 1} must belong to one unique main loop.`);
    }
    seenLoops.add(loopNumber);
    if (String(system?.[`loop${loopNumber}_filtration`] || '') !== 'Sand Filter') {
      throw new Error(`Loop ${loopNumber} must use Sand Filter before equipment can be allocated.`);
    }
    const rate = allocation?.process_rate_ls_m2 == null || allocation.process_rate_ls_m2 === ''
      ? null : Number(allocation.process_rate_ls_m2);
    if (rate != null && (!Number.isFinite(rate) || rate <= 0)) {
      throw new Error(`Loop ${loopNumber} AAT process rate must be greater than zero.`);
    }
    const notes = allocation?.notes == null ? null : String(allocation.notes).trim() || null;
    if (notes && notes.length > 5000) throw new Error(`Loop ${loopNumber} Sand Filter notes are too long.`);
    const requestedProducts = Array.isArray(allocation?.products) ? allocation.products : [];
    const productIds: string[] = [];
    const quantities = new Map<string, number>();
    for (const product of requestedProducts) {
      const id = String(product?.product_master_id || '');
      const quantity = Number(product?.quantity);
      if (!id || !Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(`Loop ${loopNumber} Sand Filter quantities must be positive whole numbers.`);
      }
      if (quantities.has(id)) throw new Error(`Loop ${loopNumber} contains the same Sand Filter model more than once.`);
      productIds.push(id);
      quantities.set(id, quantity);
    }
    const catalog = productIds.length ? (await runner(
      `SELECT pm.id, pm.product_code, pm.product_name, pm.status, pm.standard_status, pd.diameter_mm
       FROM product_masters pm
       JOIN product_families pf ON pf.id=pm.product_family_id
       LEFT JOIN product_dimensions pd ON pd.product_master_id=pm.id
       WHERE pm.id = ANY($1::uuid[]) AND pf.product_family_code='PFM-SF'`,
      [productIds],
    )).rows : [];
    if (catalog.length !== productIds.length) {
      throw new Error(`Loop ${loopNumber} includes a product that is not an active AAT Sand Filter.`);
    }
    const products = productIds.map(id => {
      const product = catalog.find(item => String(item.id) === id);
      const snapshot = existingSnapshots.get(`${loopNumber}:${id}`);
      const isActive = (product?.status == null ||
        String(product.status).trim().toLowerCase() === 'active') &&
        String(product?.standard_status || '').trim().toLowerCase() === 'active';
      if (!snapshot && !isActive) {
        throw new Error(`Loop ${loopNumber} includes a product that is not an active AAT Sand Filter.`);
      }
      // An existing allocation is a historical snapshot. Keep its catalog
      // values when a later PIM edit changes the reusable Product Master.
      const source = snapshot || product;
      return {
        product_master_id: product.id, product_code: source.product_code,
        product_name: source.product_name,
        diameter_mm: source.diameter_mm == null ? null : Number(source.diameter_mm),
        quantity: quantities.get(id),
      };
    });
    const parentFlow = resolveLoopFlows(system)[loopNumber - 1]?.flow_m3h ?? null;
    const calculation = calculateSandFilterCapacity(parentFlow, rate, products);
    normalized.push({
      parent_loop_number: loopNumber, process_rate_ls_m2: rate, notes, products,
      calculation_status: calculation.match_status,
    });
  }
  return normalized;
}

async function normalizeFractionatorAllocations(
  value: unknown,
  system: any,
  runner: (text: string, params?: any[]) => Promise<{ rows: any[] }> = query,
) {
  if (!Array.isArray(value)) return null;
  const seenLoops = new Set<number>();
  const normalized = [];
  for (const [index, allocation] of value.entries()) {
    const loopNumber = Number(allocation?.parent_loop_number);
    if (!Number.isInteger(loopNumber) || loopNumber < 1 || loopNumber > 3 || seenLoops.has(loopNumber)) {
      throw new Error(`Fractionator allocation ${index + 1} must belong to one unique main loop.`);
    }
    seenLoops.add(loopNumber);
    if (String(system?.[`loop${loopNumber}_filtration`] || '') !== 'Foam Fractionation') {
      throw new Error(`Loop ${loopNumber} must use Foam Fractionation before equipment can be allocated.`);
    }
    const rate = allocation?.process_rate_ls_m2 == null || allocation.process_rate_ls_m2 === ''
      ? null : Number(allocation.process_rate_ls_m2);
    if (rate != null && (!Number.isFinite(rate) || rate <= 0)) {
      throw new Error(`Loop ${loopNumber} AAT process rate must be greater than zero.`);
    }
    const notes = allocation?.notes == null ? null : String(allocation.notes).trim() || null;
    if (notes && notes.length > 5000) throw new Error(`Loop ${loopNumber} fractionator notes are too long.`);
    const requestedProducts = Array.isArray(allocation?.products) ? allocation.products : [];
    const productIds: string[] = [];
    const quantities = new Map<string, number>();
    for (const product of requestedProducts) {
      const id = String(product?.product_master_id || '');
      const quantity = Number(product?.quantity);
      if (!id || !Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(`Loop ${loopNumber} fractionator quantities must be positive whole numbers.`);
      }
      if (quantities.has(id)) throw new Error(`Loop ${loopNumber} contains the same fractionator model more than once.`);
      productIds.push(id);
      quantities.set(id, quantity);
    }
    const catalog = productIds.length ? (await runner(
      `SELECT pm.id, pm.product_code, pm.product_name, pd.diameter_mm,
              ph.venturi_flow_m3h
       FROM product_masters pm
       JOIN product_families pf ON pf.id=pm.product_family_id
       LEFT JOIN product_dimensions pd ON pd.product_master_id=pm.id
       LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
       WHERE pm.id = ANY($1::uuid[]) AND pf.product_family_code='PFM-FF'`,
      [productIds],
    )).rows : [];
    if (catalog.length !== productIds.length) {
      throw new Error(`Loop ${loopNumber} includes a product that is not a Foam Fractionator.`);
    }
    const products = productIds.map(id => {
      const product = catalog.find(item => String(item.id) === id);
      return {
        product_master_id: product.id,
        product_code: product.product_code,
        product_name: product.product_name,
        diameter_mm: product.diameter_mm == null ? null : Number(product.diameter_mm),
        venturi_flow_m3h: product.venturi_flow_m3h == null ? null : Number(product.venturi_flow_m3h),
        quantity: quantities.get(id),
      };
    });
    const parentFlow = resolveLoopFlows(system)[loopNumber - 1]?.flow_m3h ?? null;
    const calculation = calculateFoamFractionatorCapacity(parentFlow, rate, products);
    normalized.push({
      parent_loop_number: loopNumber,
      process_rate_ls_m2: rate,
      notes,
      products,
      calculation_status: calculation.match_status,
    });
  }
  return normalized;
}

// PROJECTS
router.get('/projects', authenticate, async (req: AuthRequest, res: Response) => {
  const { page, page_size, offset } = paginate(req);
  const filters: string[] = [];
  const params: any[] = [];

  if (req.query.status) { params.push(req.query.status); filters.push(`project_status = $${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); filters.push(`(project_name ILIKE $${params.length} OR project_code ILIKE $${params.length})`); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const sort = buildSort(req.query.sort as string);

  const countRes = await query(`SELECT COUNT(*) FROM projects ${where}`, params);
  const total = parseInt(countRes.rows[0].count);

  params.push(page_size, offset);
  const result = await query(`SELECT * FROM projects ${where} ORDER BY ${sort} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

  res.json({ items: result.rows, pagination: { page, page_size, total } });
});

router.get('/projects/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  res.json(result.rows[0]);
});

router.post('/projects', authenticate, async (req: AuthRequest, res: Response) => {
  const { project_code, project_name, client_name, site_name, country, city, timezone, project_status, start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes, scopes } = req.body;
  if (!project_code || !project_name) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'project_code and project_name required' } });
  const toDate = (v: any) => (v === '' || v == null) ? null : v;
  const toStr  = (v: any) => (v === '' || v == null) ? null : String(v);
  const resolvedScopes = (Array.isArray(scopes) && scopes.length > 0) ? scopes : ['LSS', 'Tanks', 'Waterproofing', 'Theming', 'Acrylic'];
  const result = await query(
    `INSERT INTO projects (project_code, project_name, client_name, site_name, country, city, timezone, project_status, start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes, project_scopes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [project_code, project_name, toStr(client_name), toStr(site_name), toStr(country), toStr(city), toStr(timezone), project_status || 'Concept', toDate(start_date), toDate(target_completion_date), toStr(project_manager), toStr(engineering_manager), toStr(qa_owner), toStr(notes), resolvedScopes, req.user!.id]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/projects/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { project_name, client_name, site_name, country, city, latitude, longitude, project_status, start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes, project_scopes } = req.body;
  const toDate = (v: any) => (v === '' || v == null) ? null : v;
  const toNum  = (v: any) => (v === '' || v == null) ? null : Number(v);
  const toStr  = (v: any) => (v === '' || v == null) ? null : String(v);
  const result = await query(
    `UPDATE projects SET project_name=$1, client_name=$2, site_name=$3, country=$4, city=$5, latitude=$6, longitude=$7, project_status=$8, start_date=$9, target_completion_date=$10, project_manager=$11, engineering_manager=$12, qa_owner=$13, notes=$14, project_scopes=COALESCE($15, project_scopes), updated_at=NOW()
     WHERE id=$16 RETURNING *`,
    [toStr(project_name), toStr(client_name), toStr(site_name), toStr(country), toStr(city), toNum(latitude), toNum(longitude), project_status, toDate(start_date), toDate(target_completion_date), toStr(project_manager), toStr(engineering_manager), toStr(qa_owner), toStr(notes), Array.isArray(project_scopes) ? project_scopes : null, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  await logAudit(req.user!.id, 'project', result.rows[0].id, 'UPDATE', {
    summary: 'Project details updated',
    project_name: result.rows[0].project_name,
    project_status: result.rows[0].project_status,
  });
  res.json(result.rows[0]);
});

router.patch('/projects/:id/scopes', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { scopes } = req.body;
    if (!Array.isArray(scopes) || scopes.length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'scopes must be a non-empty array' } });
    }
    const result = await query(
      'UPDATE projects SET project_scopes=$1::text[], updated_at=NOW() WHERE id=$2 RETURNING id, project_scopes',
      [scopes, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

router.delete('/projects/:id', authenticate, async (req: AuthRequest, res: Response) => {
  await query('DELETE FROM projects WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

router.post('/projects/:id/logo', authenticate, uploadLogo.single('logo'), async (req: AuthRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ error: { code: 'NO_FILE', message: 'Image file required' } });
  const logoUrl = `/uploads/${req.file.filename}`;
  const result = await query(
    'UPDATE projects SET logo_url=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
    [logoUrl, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  res.json(result.rows[0]);
});

// AREAS
router.get('/projects/:id/areas', authenticate, async (req: AuthRequest, res: Response) => {
  const proj = await query('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
  if (!proj.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  const result = await query('SELECT * FROM areas WHERE project_id = $1 ORDER BY area_code', [proj.rows[0].id]);
  res.json({ items: result.rows });
});

router.get('/projects/:id/systems', authenticate, async (req: AuthRequest, res: Response) => {
  const proj = await query('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
  if (!proj.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  const result = await query(
    `SELECT s.*, a.area_name, e.exhibit_name,
      COALESCE(SUM(t.quantity), 0)::int AS tank_count,
      COALESCE(SUM(
        CASE
          WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
               AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
            THEN PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2)
                      * COALESCE(t.height_mm, pm.height_mm) / 1000000000.0 * COALESCE(t.quantity, 1)
          WHEN COALESCE(t.shape_type, pm.shape_type) NOT IN ('Cylindrical', 'Custom')
               AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
               AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
            THEN COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.height_mm,pm.height_mm)/1000000000.0 * COALESCE(t.quantity, 1)
          WHEN COALESCE(t.gross_volume_m3, pm.gross_volume_m3) IS NOT NULL
            THEN COALESCE(t.gross_volume_m3, pm.gross_volume_m3) * COALESCE(t.quantity, 1)
          ELSE 0
        END
      ), 0)::numeric AS total_volume_m3,
      COALESCE(SUM(
        COALESCE(t.operating_volume_m3, pm.operating_volume_m3, 0) * COALESCE(t.quantity, 1)
      ), 0)::numeric AS total_operating_volume_m3
     FROM systems s
     LEFT JOIN areas a ON s.area_id=a.id
     LEFT JOIN exhibits e ON s.exhibit_id=e.id
     LEFT JOIN tanks t ON t.system_id=s.id
     LEFT JOIN product_masters pm ON t.product_master_id=pm.id
     WHERE s.project_id = $1
       AND ($2::boolean OR s.status NOT IN ('Archived', 'Decommissioned', 'Superseded'))
     GROUP BY s.id, a.area_name, e.exhibit_name
     ORDER BY s.sort_order, s.system_code`,
    [proj.rows[0].id, req.query.include_historical === 'true']);
  res.json({ items: result.rows });
});

router.get('/projects/:id/equipment', authenticate, async (req: AuthRequest, res: Response) => {
  const proj = await query('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
  if (!proj.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  const result = await query(
    `SELECT pei.*, s.system_code, s.system_name, pm.product_code, pm.product_name
     FROM project_equipment_items pei
     LEFT JOIN systems s ON pei.system_id = s.id
     LEFT JOIN product_masters pm ON pei.product_master_id = pm.id
     WHERE pei.project_id = $1 ORDER BY pei.equip_code`, [proj.rows[0].id]);
  res.json({ items: result.rows });
});

router.get('/projects/:id/documents', authenticate, async (req: AuthRequest, res: Response) => {
  const proj = await query('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
  if (!proj.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  const result = await query(
    `SELECT d.*
     FROM documents d
     JOIN document_project_links dpl ON dpl.document_id = d.id
     WHERE dpl.project_id = $1
     ORDER BY d.document_code`,
    [proj.rows[0].id],
  );
  res.json({ items: result.rows });
});

router.get('/document-classifications', async (_req: AuthRequest, res: Response) => {
  const result = await query(
    'SELECT code, display_name FROM document_classifications WHERE is_active = true ORDER BY display_order, display_name',
  );
  res.json({ items: result.rows });
});

router.post(
  '/projects/:id/documents',
  requireRole('admin', 'engineer'),
  requireModuleManage('projects'),
  requireModuleManage('documents'),
  uploadProjectDocument.single('file'),
  async (req: AuthRequest, res: Response) => {
    const file = req.file;
    const documentCode = String(req.body.document_code || '').trim();
    const documentTitle = String(req.body.document_title || '').trim();
    const classification = String(req.body.classification || '').trim();

    try {
      if (!file || !documentCode || !documentTitle || !classification) {
        removeUploadedFile(file);
        return res.status(400).json({
          error: { code: 'INVALID_REQUEST', message: 'File, document title, document code, and classification are required' },
        });
      }

      const project = await query(
        'SELECT id FROM projects WHERE id::text = $1 OR project_code = $1',
        [req.params.id],
      );
      if (!project.rows[0]) {
        removeUploadedFile(file);
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
      }

      const allowedClassification = await query(
        'SELECT code FROM document_classifications WHERE code = $1 AND is_active = true',
        [classification],
      );
      if (!allowedClassification.rows[0]) {
        removeUploadedFile(file);
        return res.status(400).json({
          error: { code: 'INVALID_CLASSIFICATION', message: 'Select an active document classification' },
        });
      }

      const checksum = crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
      const created = await withTransaction(async client => {
        const document = await client.query(
          `INSERT INTO documents
             (document_code, document_title, classification, current_revision, status, created_by)
           VALUES ($1,$2,$3,'A','Draft',$4)
           RETURNING *`,
          [documentCode, documentTitle, classification, req.user!.id],
        );
        await client.query(
          `INSERT INTO document_revisions
             (document_id, revision_code, status, issued_by, file_path, file_name, file_size, mime_type, checksum, created_by)
           VALUES ($1,'A','Draft',$2,$3,$4,$5,$6,$7,$2)`,
          [
            document.rows[0].id,
            req.user!.id,
            `private-uploads/documents/${file.filename}`,
            file.originalname,
            file.size,
            file.mimetype,
            checksum,
          ],
        );
        await client.query(
          'INSERT INTO document_project_links (document_id, project_id, linked_by) VALUES ($1,$2,$3)',
          [document.rows[0].id, project.rows[0].id, req.user!.id],
        );
        await client.query(
          'INSERT INTO lifecycle_transitions (entity_type, entity_id, to_state, actor_id, comment) VALUES ($1,$2,$3,$4,$5)',
          ['document', document.rows[0].id, 'Draft', req.user!.id, 'Document uploaded from project'],
        );
        return document.rows[0];
      });

      res.status(201).json(created);
    } catch (error: any) {
      removeUploadedFile(file);
      if (error?.code === '23505') {
        return res.status(409).json({ error: { code: 'DOCUMENT_CODE_EXISTS', message: 'A document with this code already exists' } });
      }
      console.error('Project document upload failed', error);
      res.status(500).json({ error: { code: 'UPLOAD_FAILED', message: 'Document upload failed. No document was created.' } });
    }
  },
);

router.get('/projects/:id/change-requests', authenticate, async (req: AuthRequest, res: Response) => {
  const proj = await query('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
  if (!proj.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  const result = await query('SELECT cr.*, u.first_name || \' \' || u.last_name as requested_by_name FROM change_requests cr LEFT JOIN users u ON cr.requested_by=u.id WHERE cr.project_id = $1 ORDER BY cr.created_at DESC', [proj.rows[0].id]);
  res.json({ items: result.rows });
});

// AREAS standalone
router.get('/areas', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT a.*, p.project_code FROM areas a JOIN projects p ON a.project_id=p.id ORDER BY a.area_code');
  res.json({ items: result.rows });
});

router.get('/areas/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT a.*, p.project_code, p.project_name FROM areas a JOIN projects p ON a.project_id=p.id WHERE a.id = $1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Area not found' } });
  res.json(result.rows[0]);
});

router.post('/areas', authenticate, async (req: AuthRequest, res: Response) => {
  const { area_code, project_id, area_name, discipline_scope, notes } = req.body;
  const result = await query('INSERT INTO areas (area_code, project_id, area_name, discipline_scope, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *', [area_code, project_id, area_name, discipline_scope, notes]);
  res.status(201).json(result.rows[0]);
});

// EXHIBITS
router.get('/exhibits', authenticate, async (req: AuthRequest, res: Response) => {
  const filters: string[] = [], params: any[] = [];
  if (req.query.project_id) { params.push(req.query.project_id); filters.push(`e.project_id = $${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await query(`SELECT e.*, a.area_name, p.project_code FROM exhibits e LEFT JOIN areas a ON e.area_id=a.id JOIN projects p ON e.project_id=p.id ${where} ORDER BY e.exhibit_code`, params);
  res.json({ items: result.rows });
});

router.put('/exhibits/:id', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const { exhibit_code, exhibit_name, water_type, design_temperature_min, design_temperature_max, design_salinity, area_id, notes } = req.body;
  if (!exhibit_name) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'exhibit_name is required' } });
  const result = await query(
    `UPDATE exhibits SET exhibit_code=$1, exhibit_name=$2, water_type=$3, design_temperature_min=$4, design_temperature_max=$5, design_salinity=$6, area_id=$7, notes=$8, updated_at=NOW() WHERE id=$9 RETURNING *`,
    [exhibit_code, exhibit_name, water_type || null, design_temperature_min || null, design_temperature_max || null, design_salinity || null, area_id || null, notes || null, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Exhibit not found' } });
  res.json(result.rows[0]);
});

router.delete('/exhibits/:id', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const result = await query('DELETE FROM exhibits WHERE id=$1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Exhibit not found' } });
  res.json({ deleted: true });
});

router.get('/exhibits/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT e.*, a.area_name, p.project_code, p.project_name FROM exhibits e JOIN areas a ON e.area_id=a.id JOIN projects p ON e.project_id=p.id WHERE e.id=$1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Exhibit not found' } });
  res.json(result.rows[0]);
});

router.post('/exhibits', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const {
    exhibit_code, project_id, area_id, exhibit_name, water_type,
    design_temperature_min, design_temperature_max, design_salinity,
    inherit_from_exhibit_id,
  } = req.body;
  let inherited: {
    water_type: string | null;
    design_temperature_min: number | null;
    design_temperature_max: number | null;
  } | null = null;

  if (inherit_from_exhibit_id) {
    const source = await query(
      `SELECT water_type, design_temperature_min, design_temperature_max
       FROM exhibits WHERE id=$1 AND project_id=$2`,
      [inherit_from_exhibit_id, project_id],
    );
    if (!source.rows[0]) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REFERENCE',
          message: 'The selected previous exhibit must belong to this project.',
        },
      });
    }
    inherited = source.rows[0];
  }

  // Inheritance is a one-time copy at creation. An explicitly supplied value,
  // including null, always wins and no link is retained to the source exhibit.
  const resolvedWaterType = water_type == null ? inherited?.water_type ?? null : water_type;
  const resolvedTemperatureMin = design_temperature_min == null
    ? inherited?.design_temperature_min ?? null
    : design_temperature_min;
  const resolvedTemperatureMax = design_temperature_max == null
    ? inherited?.design_temperature_max ?? null
    : design_temperature_max;
  const result = await query('INSERT INTO exhibits (exhibit_code, project_id, area_id, exhibit_name, water_type, design_temperature_min, design_temperature_max, design_salinity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [exhibit_code, project_id, area_id, exhibit_name, resolvedWaterType, resolvedTemperatureMin, resolvedTemperatureMax, design_salinity]);
  res.status(201).json(result.rows[0]);
});

// TANKS
router.get('/tanks', authenticate, async (req: AuthRequest, res: Response) => {
  const filters: string[] = [], params: any[] = [];
  if (req.query.project_id) { params.push(req.query.project_id); filters.push(`t.project_id = $${params.length}`); }
  if (req.query.system_id) { params.push(req.query.system_id); filters.push(`t.system_id = $${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  // Auto-create missing tank_instances rows for multi-unit tanks (idempotent)
  const instanceFilters = ['t.quantity > 1', ...filters];
  await query(
    `INSERT INTO tank_instances (tank_id, instance_index, tag)
     SELECT t.id, gs.i,
       t.tank_code || '-' || LPAD(gs.i::text, CASE WHEN t.quantity > 99 THEN 3 WHEN t.quantity > 9 THEN 2 ELSE 1 END, '0')
     FROM tanks t
     CROSS JOIN LATERAL generate_series(1, t.quantity) AS gs(i)
     WHERE ${instanceFilters.join(' AND ')}
       AND NOT EXISTS (
         SELECT 1 FROM tank_instances ti WHERE ti.tank_id = t.id AND ti.instance_index = gs.i
       )
     ON CONFLICT (tank_id, instance_index) DO NOTHING`,
    params
  );

  const result = await query(
    `SELECT t.*, e.exhibit_name, p.project_code,
      s.system_code, s.system_name,
      pm.product_code, pm.product_name as product_name, pm.application_type as product_type,
      pm.primary_material_code as product_material,
      pm.product_code as pim_product_code,
      pm.product_name as pim_product_name,
      tf.name as pim_tank_family_name,
      COALESCE(t.tank_type, pm.application_type) as eff_tank_type,
      COALESCE(t.primary_material, pm.primary_material_code) as eff_primary_material,
      COALESCE(t.notes, pm.notes) as eff_notes,
      COALESCE(t.shape_type, pm.shape_type) as eff_shape,
      COALESCE(t.length_mm, pm.length_mm) as eff_length_mm,
      COALESCE(t.width_mm, pm.width_mm) as eff_width_mm,
      COALESCE(t.height_mm, pm.height_mm) as eff_height_mm,
      COALESCE(t.design_water_level_mm, pm.design_water_level_mm) as eff_water_level_mm,
      COALESCE(
        CASE
          WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
               AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
            THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) * COALESCE(t.height_mm, pm.height_mm) / 1000000000.0)::numeric, 4)
          WHEN COALESCE(t.shape_type, pm.shape_type) NOT IN ('Cylindrical', 'Custom')
               AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
               AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
            THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.height_mm,pm.height_mm)/1000000000.0)::numeric, 4)
          ELSE NULL
        END,
        t.gross_volume_m3, pm.gross_volume_m3
      ) as gross_volume_m3,
      COALESCE(
        CASE
          WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
               AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               AND COALESCE(t.design_water_level_mm, pm.design_water_level_mm) IS NOT NULL
            THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) * COALESCE(t.design_water_level_mm, pm.design_water_level_mm) / 1000000000.0)::numeric, 4)
          WHEN COALESCE(t.shape_type, pm.shape_type) NOT IN ('Cylindrical', 'Custom')
               AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
               AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               AND COALESCE(t.design_water_level_mm, pm.design_water_level_mm) IS NOT NULL
            THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.design_water_level_mm,pm.design_water_level_mm)/1000000000.0)::numeric, 4)
          ELSE NULL
        END,
        t.operating_volume_m3, pm.operating_volume_m3
      ) as design_volume_m3,
       COALESCE(
         t.surface_area_m2,
         pm.surface_area_m2,
         CASE
           WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
                AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
             THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) / 1000000.0)::numeric, 4)
            WHEN COALESCE(t.shape_type, pm.shape_type) NOT IN ('Cylindrical', 'Custom')
                AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
                AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
             THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)/1000000.0)::numeric, 4)
           ELSE NULL
          END
       ) as surface_area_m2,
      COALESCE(
        (SELECT json_agg(
          json_build_object(
            'id', ti.id, 'tank_id', ti.tank_id, 'instance_index', ti.instance_index,
            'tag', ti.tag, 'notes', ti.notes, 'display_name', ti.display_name,
            'exhibit_id', ti.exhibit_id, 'exhibit_name', ex.exhibit_name
          ) ORDER BY ti.instance_index
        ) FROM tank_instances ti LEFT JOIN exhibits ex ON ti.exhibit_id = ex.id WHERE ti.tank_id = t.id),
        '[]'::json
      ) AS instances
     FROM tanks t
     LEFT JOIN exhibits e ON t.exhibit_id=e.id
     JOIN projects p ON t.project_id=p.id
     LEFT JOIN systems s ON t.system_id=s.id
     LEFT JOIN product_masters pm ON t.product_master_id=pm.id
     LEFT JOIN tank_families tf ON tf.id=pm.tank_family_id
     ${where} ORDER BY t.sort_order, t.tank_code`, params);
  res.json({ items: result.rows });
});

router.get('/tanks/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT t.*, e.exhibit_name, p.project_code, p.project_name,
      pm.product_code, pm.product_name as product_name, pm.application_type as product_type,
      pm.primary_material_code as product_material,
      pm.product_code as pim_product_code,
      pm.product_name as pim_product_name,
      tf.name as pim_tank_family_name,
      COALESCE(t.tank_type, pm.application_type) as eff_tank_type,
      COALESCE(t.primary_material, pm.primary_material_code) as eff_primary_material,
      COALESCE(t.notes, pm.notes) as eff_notes,
      COALESCE(t.shape_type, pm.shape_type) as eff_shape,
      COALESCE(t.length_mm, pm.length_mm) as eff_length_mm,
      COALESCE(t.width_mm, pm.width_mm) as eff_width_mm,
      COALESCE(t.height_mm, pm.height_mm) as eff_height_mm,
      COALESCE(t.design_water_level_mm, pm.design_water_level_mm) as eff_water_level_mm,
      COALESCE(
        CASE
          WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
               AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
            THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) * COALESCE(t.height_mm, pm.height_mm) / 1000000000.0)::numeric, 4)
          WHEN COALESCE(t.shape_type, pm.shape_type) NOT IN ('Cylindrical', 'Custom')
               AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
               AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
            THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.height_mm,pm.height_mm)/1000000000.0)::numeric, 4)
          ELSE NULL
        END,
        t.gross_volume_m3, pm.gross_volume_m3
      ) as gross_volume_m3,
      COALESCE(
        CASE
          WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
               AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               AND COALESCE(t.design_water_level_mm, pm.design_water_level_mm) IS NOT NULL
            THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) * COALESCE(t.design_water_level_mm, pm.design_water_level_mm) / 1000000000.0)::numeric, 4)
          WHEN COALESCE(t.shape_type, pm.shape_type) NOT IN ('Cylindrical', 'Custom')
               AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
               AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               AND COALESCE(t.design_water_level_mm, pm.design_water_level_mm) IS NOT NULL
            THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.design_water_level_mm,pm.design_water_level_mm)/1000000000.0)::numeric, 4)
          ELSE NULL
        END,
        t.operating_volume_m3, pm.operating_volume_m3
       ) as design_volume_m3,
       COALESCE(
         t.surface_area_m2,
         CASE
           WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
                AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
             THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) / 1000000.0)::numeric, 4)
           WHEN COALESCE(t.shape_type, pm.shape_type) IS DISTINCT FROM 'Custom'
                AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
                AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
             THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)/1000000.0)::numeric, 4)
           ELSE NULL
         END,
         pm.surface_area_m2
       ) as surface_area_m2
     FROM tanks t LEFT JOIN exhibits e ON t.exhibit_id=e.id JOIN projects p ON t.project_id=p.id
     LEFT JOIN product_masters pm ON t.product_master_id=pm.id
     LEFT JOIN tank_families tf ON tf.id=pm.tank_family_id
     WHERE t.id=$1`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
  res.json(result.rows[0]);
});

const TANK_DESIGN_SHEET_QUERY_TIMEOUT_MS = 8_000;

class TankDesignSheetQueryTimeoutError extends Error {
  code = 'TANK_DESIGN_SHEET_QUERY_TIMEOUT';

  constructor() {
    super('Timed out while loading tank design-sheet evidence.');
  }
}

async function boundedTankDesignSheetQuery(text: string, params?: any[]) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      query(text, params),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TankDesignSheetQueryTimeoutError()), TANK_DESIGN_SHEET_QUERY_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function tankDesignSheetModel(projectIdentifier: string, tankId: string) {
  const tankResult = await boundedTankDesignSheetQuery(
    `SELECT t.*, p.project_code, p.project_name,
            COALESCE(t.shape_type, pm.shape_type) AS eff_shape,
            COALESCE(t.length_mm, pm.length_mm) AS eff_length_mm,
            COALESCE(t.width_mm, pm.width_mm) AS eff_width_mm,
            COALESCE(t.height_mm, pm.height_mm) AS eff_height_mm,
            COALESCE(t.gross_volume_m3, pm.gross_volume_m3) AS gross_volume_m3,
            COALESCE(t.operating_volume_m3, pm.operating_volume_m3) AS design_volume_m3,
            COALESCE(t.design_water_level_mm, pm.design_water_level_mm) AS eff_water_level_mm,
            e.id AS exhibit_id, e.exhibit_code, e.exhibit_name, e.water_type,
            e.design_temperature_min, e.design_temperature_max
     FROM tanks t
     JOIN projects p ON p.id=t.project_id
     LEFT JOIN product_masters pm ON pm.id=t.product_master_id
     LEFT JOIN exhibits e ON e.id=t.exhibit_id
     WHERE (p.id::text=$1 OR p.project_code=$1) AND t.id=$2`,
    [projectIdentifier, tankId],
  );
  const tank = tankResult.rows[0];
  if (!tank) return null;
  // Explicit active filter is important: superseded physical-property values
  // must never become a design basis.
  let chemicalParameters: any[] = [];
  try {
    chemicalParameters = (await boundedTankDesignSheetQuery('SELECT * FROM water_density_parameters WHERE is_active=true')).rows;
  } catch (error: any) {
    if (error?.code !== '42P01') throw error;
  }
  // A standalone tank has no system_id; its exhibit's linked LSS systems are
  // still legitimate Thermal sources.  Prefer the directly assigned system.
  const thermalCalculations = (await boundedTankDesignSheetQuery(
    `SELECT tc.*
     FROM design_book_thermal_calculations tc
     JOIN design_books db ON db.id=tc.design_book_id
     LEFT JOIN system_exhibit_links sel ON sel.system_id=tc.system_id
     WHERE db.project_id=$1
       AND ($2::uuid IS NOT NULL AND tc.system_id=$2
            OR $3::uuid IS NOT NULL AND sel.exhibit_id=$3)
       AND tc.status='Ready'
       AND tc.freshness='fresh'
     ORDER BY (tc.system_id=$2) DESC, tc.calculated_at DESC`,
    [tank.project_id, tank.system_id || null, tank.exhibit_id || null],
  )).rows;
  return buildTankDesignSheet({ tank, exhibit: tank, project: tank, chemicalParameters, thermalCalculations });
}

function sendTankDesignSheetLoadError(res: Response, error: any) {
  const timedOut = error?.code === 'TANK_DESIGN_SHEET_QUERY_TIMEOUT';
  console.error('[tank-design-sheet] Failed to load design-sheet evidence', error);
  return res.status(timedOut ? 503 : 500).json({
    error: {
      code: timedOut ? 'DESIGN_SHEET_SOURCE_TIMEOUT' : 'DESIGN_SHEET_LOAD_FAILED',
      message: timedOut
        ? 'Design-sheet evidence is temporarily busy. Please retry.'
        : 'Design-sheet evidence could not be loaded.',
    },
  });
}

export function renderTankDesignSheetPdf(model: any): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 36,
    bufferPages: true,
    info: {
      Title: 'Tank and Filter Design Data Sheet',
      Subject: 'Supplier request for quotation',
      Author: 'Advanced Aquarium Technologies',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', chunk => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // The reference sheet is intentionally a controlled data sheet: short rows,
  // explicit units and a traceable basis column are easier to review than prose.
  const navy = '#18324A';
  const ink = '#243746';
  const muted = '#5B6B78';
  const rule = '#AAB8C2';
  const pale = '#EAF1F4';
  const tbcFill = '#FFF3D6';
  const left = 36;
  const right = 559;
  const contentTop = 92;
  const contentBottom = 776;
  const value = (item: any) => item === null || item === undefined || item === '' ? 'TBC' : String(item);
  const basis = (item: any) => item === null || item === undefined || item === '' ? 'Open item — supplier / designer confirmation required' : String(item);
  const pages: number[] = [];

  const section = (title: string) => {
    ensure(28);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(navy)
      .text(title.toUpperCase(), left, doc.y, { width: right - left });
    doc.moveTo(left, doc.y + 4).lineTo(right, doc.y + 4).strokeColor(navy).lineWidth(1).stroke();
    doc.y += 10;
  };
  const ensure = (height: number) => {
    if (doc.y + height <= contentBottom) return;
    doc.addPage();
    doc.y = contentTop;
  };
  type Row = { no?: string; label: string; value: any; unit?: string; basis?: any };
  const table = (rows: Row[], widths = [34, 173, 112, 44, 160]) => {
    const x = left;
    const headers = ['No.', 'Design parameter', 'Designer input', 'Unit', 'Basis, source or supplier confirmation'];
    const total = widths.reduce((a, b) => a + b, 0);
    const drawRow = (cells: string[], header = false, fill?: string) => {
      const font = header ? 'Helvetica-Bold' : 'Helvetica';
      const size = header ? 7.2 : 7.5;
      const padding = 4;
      doc.font(font).fontSize(size);
      const heights = cells.map((cell, i) => doc.heightOfString(cell, { width: widths[i] - padding * 2 }));
      const h = Math.max(19, Math.min(58, Math.max(...heights) + padding * 2));
      ensure(h);
      const rowY = doc.y;
      if (fill) doc.rect(x, rowY, total, h).fill(fill);
      let cursor = x;
      cells.forEach((cell, i) => {
        doc.rect(cursor, rowY, widths[i], h).strokeColor(rule).lineWidth(0.35).stroke();
        doc.font(font).fontSize(size).fillColor(header ? navy : ink)
          .text(cell, cursor + padding, rowY + padding, {
            width: widths[i] - padding * 2,
            height: h - padding * 2,
            ellipsis: false,
            lineBreak: false,
          });
        cursor += widths[i];
      });
      doc.y = rowY + h;
    };
    drawRow(headers, true, pale);
    rows.forEach(row => {
      const v = value(row.value);
      drawRow([row.no || '', row.label, v, row.unit || '', basis(row.basis)], false, v === 'TBC' ? tbcFill : undefined);
    });
    doc.y += 8;
  };
  const note = (text: string, fill = '#F4F7F8') => {
    doc.font('Helvetica').fontSize(7.5);
    const h = Math.max(25, doc.heightOfString(text, { width: right - left - 18 }) + 14);
    ensure(h);
    const noteY = doc.y;
    doc.roundedRect(left, noteY, right - left, h, 2).fill(fill);
    doc.font('Helvetica').fontSize(7.5).fillColor(ink)
      .text(text, left + 9, noteY + 7, { width: right - left - 18, height: h - 14, lineBreak: false });
    doc.y = noteY + h + 9;
  };

  doc.y = contentTop;
  section('A. Document control');
  table([
    { label: 'Project', value: `${value(model.project.project_code)} — ${value(model.project.project_name)}`, basis: 'Project record' },
    { label: 'Exhibit', value: `${value(model.exhibit.exhibit_code)} — ${value(model.exhibit.exhibit_name)}`, basis: 'Exhibit record' },
    { label: 'Equipment tag', value: value(model.tank.tank_code), basis: 'Tank record' },
    { label: 'Equipment description', value: value(model.tank.tank_name), basis: 'Tank record' },
    { label: 'Document number', value: 'TBC', basis: 'To be allocated under project document control' },
    { label: 'Revision / issue purpose', value: 'TBC / For quotation', basis: 'Controlled issue information' },
    { label: 'Design status', value: 'TBC', basis: 'Concept / Tender / Detailed — confirm at issue' },
    { label: 'Prepared / checked / approved', value: 'TBC / TBC / TBC', basis: 'Signatures and dates required before issue' },
    { label: 'Generated', value: value(model.generated_at), basis: model.calculation_version },
  ], [100, 175, 116, 44, 88]);
  note('PURPOSE  Complete this sheet before requesting a supplier quotation. TBC means the design input is not governed or available in the current record; it is not an assumed value.', '#E8F1F5');

  section('B. Equipment classification and design basis');
  table([
    { no: 'B1', label: 'Equipment category', value: `${value(model.tank.shape_type)} tank`, basis: 'Tank geometry record' },
    { no: 'B2', label: 'Configuration', value: value(model.tank.shape_type), basis: 'Effective tank shape' },
    { no: 'B3', label: 'Required structural design life', value: model.design_basis.required_life_years, unit: 'years', basis: 'Governed design-sheet basis' },
    { no: 'B4', label: 'Atmosphere / external pressure', value: `${value(model.design_basis.atmosphere)} / ${value(model.design_basis.external_pressure)}`, basis: 'Design basis' },
    { no: 'B5', label: 'Vacuum case', value: value(model.design_basis.vacuum), basis: 'Design basis' },
    { no: 'B6', label: 'Calculation version', value: value(model.calculation_version), basis: 'Canonical model version' },
  ]);
  note('ISSUE GATE  Designer and checker must agree the load combinations, pressure cases, water-level datum and supplier scope before this document is issued for quotation.');

  section('1. Tank dimensions, volume and water levels');
  table([
    { no: '1', label: 'Internal plan shape', value: value(model.tank.shape_type), basis: 'Effective tank shape' },
    { no: '1', label: 'Internal length', value: model.tank.dimensions_mm.length, unit: 'mm', basis: 'Tank / product geometry' },
    { no: '1', label: 'Internal width', value: model.tank.dimensions_mm.width, unit: 'mm', basis: 'Tank / product geometry' },
    { no: '1', label: 'Internal height / shell height', value: model.tank.dimensions_mm.height, unit: 'mm', basis: 'Tank / product geometry' },
    { no: '2', label: 'Gross volume', value: model.tank.gross_volume_m3, unit: 'm³', basis: 'Tank / product geometry' },
    { no: '2', label: 'Normal working / operating volume', value: model.tank.operating_volume_m3, unit: 'm³', basis: 'Effective operating volume' },
    { no: '3', label: 'Maximum permitted water level', value: model.tank.maximum_water_level_mm, unit: 'mm', basis: 'Relative datum not recorded — confirm' },
    { no: '4', label: 'Overflow operating level', value: model.tank.overflow_level_mm, unit: 'mm', basis: 'Crest / pipe invert to be confirmed' },
    { label: '', value: 'TBC', unit: 'mm', basis: 'Freeboard above maximum water level — supplier to confirm adequacy' },
    { label: 'Water level datum', value: 'TBC', basis: 'Finished floor or tank internal base to be defined' },
  ]);

  section('2. Liquid and temperature design conditions');
  table([
    { no: '5', label: 'Liquid description', value: model.design_basis.water_type, basis: 'Exhibit water type / active parameter lookup' },
    { no: '5', label: 'Maximum design liquid density', value: model.design_basis.density_kg_m3, unit: 'kg/m³', basis: model.design_basis.density_provenance?.catalog_source || model.design_basis.density_provenance?.source },
    { no: '6', label: 'Water temperature range', value: `${value(model.exhibit.water_temperature_min_c)} to ${value(model.exhibit.water_temperature_max_c)}`, unit: '°C', basis: 'Exhibit design temperatures' },
    { no: '7', label: 'Ambient air temperature', value: model.design_basis.ambient_air_temperature_c, unit: '°C', basis: model.design_basis.ambient_temperature_source },
    { no: '7', label: 'Salinity / pH / humidity', value: 'TBC', basis: 'Not present in governed tank record' },
    { no: '7', label: 'Chemical exposure and cleaning', value: 'TBC', basis: 'Supplier / designer confirmation required' },
  ]);

  section('3. Hydrostatic load case');
  table([
    { no: '8', label: 'Maximum water depth', value: model.hydrostatic_pressure.maximum_water_depth_m, unit: 'm', basis: 'Maximum permitted water level' },
    { no: '8', label: 'Hydrostatic pressure at design level', value: model.hydrostatic_pressure.pressure_kpa, unit: 'kPa', basis: 'Calculated with 1.2 load factor' },
    { no: '8', label: 'Water density / gravity', value: `${value(model.design_basis.density_kg_m3)} / ${value(model.hydrostatic_pressure.gravity_m_s2)}`, unit: 'kg/m³ / m/s²', basis: model.hydrostatic_pressure.formula },
    { no: '8', label: 'Load factor', value: model.hydrostatic_pressure.load_factor, basis: 'Hydrostatic load factor' },
  ]);

  section('4. Openings, nozzles and access');
  table([
    { no: '9', label: 'Nozzle schedule, sizes and loads', value: 'TBC', basis: 'Supplier to confirm connection, rating, location and allowable loads' },
    { no: '10', label: 'Manways and access openings', value: 'TBC', basis: 'Supplier to confirm clear opening, cover, seal and safety requirements' },
    { no: '11', label: 'Lifting points / handling', value: 'TBC', basis: 'Supplier to confirm operating and empty handling arrangements' },
  ]);

  section('5. Supports and anchorage');
  table([
    { no: '12', label: 'Support arrangement and foundation', value: 'TBC', basis: 'Skirt / legs / saddle / flat base and supporting structure' },
    { no: '13', label: 'Anchor bolt arrangement', value: 'TBC', basis: 'Supplier to provide final anchor plan' },
    { no: '14', label: 'Required supplier reactions', value: 'TBC', unit: 'kN, kN·m', basis: 'Vertical, shear, uplift and moment for governing combinations' },
    { no: '15', label: 'Seismic and wind loads', value: 'TBC', basis: 'Not governed in current model' },
  ]);

  section('6. Materials and fabrication');
  table([
    { no: '16', label: 'Construction / material system', value: 'TBC', basis: 'FRP / steel / composite — supplier proposal and compliance review' },
    { no: '17', label: 'Coating, lining or corrosion protection', value: 'TBC', basis: 'Service and chemical exposure to be confirmed' },
    { no: '18', label: 'Inspection, testing and certification', value: 'TBC', basis: 'Supplier to submit proposed ITP and quality records' },
  ]);

  section('7. Required design life and operation');
  table([
    { no: '19', label: 'Structural design life', value: model.design_basis.required_life_years, unit: 'years', basis: 'Governed design-sheet basis' },
    { no: '20', label: 'Operating hours / fill-drain cycles', value: 'TBC', basis: 'Operating profile not present' },
    { no: '21', label: 'Inspection interval / component life', value: 'TBC', basis: 'Supplier recommendation and project maintenance basis' },
  ]);

  section('C. Required supplier response and deliverables');
  table([
    { no: '1', label: 'Completed confirmation column for every applicable item', value: 'TBC', basis: 'Supplier response required' },
    { no: '2', label: 'Pressure, vacuum, hydrostatic, seismic, wind and support calculations', value: 'TBC', basis: 'Supplier response required as applicable' },
    { no: '3', label: 'General arrangement drawing with levels, openings and supports', value: 'TBC', basis: 'Supplier response required' },
    { no: '4', label: 'Material, thickness, lining and corrosion protection schedule', value: 'TBC', basis: 'Supplier response required' },
    { no: '5', label: 'Anchor layout and governing support reactions', value: 'TBC', basis: 'For structural engineer coordination' },
    { no: '6', label: 'Fabrication, inspection, testing and certificates', value: 'TBC', basis: 'Supplier response required' },
    { no: '7', label: 'Exclusions, assumptions, clarifications and deviations', value: 'TBC', basis: 'Supplier response required' },
  ]);

  section('D. Open items, deviations and approval');
  table([
    { no: '1', label: 'Unresolved design inputs', value: `${model.tbcs.length} open items`, basis: model.tbcs.join(' ') },
    { no: '2', label: 'Prepared / checked / approved', value: 'TBC / TBC / TBC', basis: 'Name, signature and date required' },
    { no: '3', label: 'Release condition', value: 'TBC', basis: 'Resolve critical TBCs and accept supplier deviations before purchase order' },
  ]);
  note('CONTROLLED RELEASE  Do not issue the supplier purchase order until all critical TBC items have been resolved and supplier deviations have been reviewed and accepted by AAT Engineering.', '#FFF3D6');

  // Apply the same document-control header and footer to every generated page.
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i += 1) {
    doc.switchToPage(i);
    doc.save();
    doc.rect(left, 28, right - left, 42).fill(navy);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF')
      .text('ADVANCED AQUARIUM TECHNOLOGIES', left + 10, 39);
    doc.font('Helvetica').fontSize(7).fillColor('#DCE8ED')
      .text('TANK AND FILTER DESIGN DATA SHEET  |  SUPPLIER REQUEST FOR QUOTATION', left + 10, 53);
    doc.restore();
    doc.moveTo(left, 788).lineTo(right, 788).strokeColor(rule).lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(7).fillColor(muted)
      .text(`AAT controlled engineering deliverable  |  ${value(model.tank.tank_code)}  |  ${value(model.calculation_version)}`, left, 796, { width: 390, lineBreak: false })
      .text(`Page ${i + 1} of ${pageCount}`, 455, 796, { width: 104, align: 'right', lineBreak: false });
  }
  doc.end();
  return completed;
}

router.get('/projects/:projectId/tanks/:tankId/design-sheet', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const model = await tankDesignSheetModel(String(req.params.projectId), String(req.params.tankId));
    if (!model) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found in project.' } });
    res.json(model);
  } catch (error) {
    return sendTankDesignSheetLoadError(res, error);
  }
});

router.get('/projects/:projectId/tanks/:tankId/design-sheet.pdf', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const model = await tankDesignSheetModel(String(req.params.projectId), String(req.params.tankId));
    if (!model) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found in project.' } });
    if (!model.validation.valid) {
      return res.status(422).json({
        error: { code: 'DESIGN_SHEET_INCOMPLETE', message: 'Tank design sheet has required unresolved design inputs.', validation: model.validation },
        design_sheet: model,
      });
    }
    const pdf = await renderTankDesignSheetPdf(model);
    const safeCode = String(model.tank.tank_code || req.params.tankId).replace(/[^A-Za-z0-9._-]/g, '_');
    const filename = `${safeCode}-tank-design-sheet.pdf`;
    await logAudit(req.user!.id, 'tank', String(req.params.tankId), 'GENERATE_DESIGN_SHEET_PDF', {
      summary: `Generated tank design sheet PDF for ${safeCode}`,
      calculation_version: model.calculation_version,
      validation_valid: model.validation.valid,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (error) {
    return sendTankDesignSheetLoadError(res, error);
  }
});

router.post('/tanks', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  try {
  const { tank_code, project_id, tank_name, tank_type, product_master_id, system_id, exhibit_id, quantity, shape_type, gross_volume_m3, operating_volume_m3, length_mm, width_mm, height_mm, design_water_level_mm, overflow_level_mm, primary_material, status, notes, custom_footprint } = req.body;
  const tankCode = String(tank_code ?? '').trim();
  const tankName = String(tank_name ?? '').trim();
  if (!tankCode) return res.status(400).json({ error: { code: 'VALIDATION', field: 'tank_code', message: 'Tank code is required.' } });
  if (!project_id) return res.status(400).json({ error: { code: 'VALIDATION', field: 'project_id', message: 'Project is required.' } });
  if (!tankName) return res.status(400).json({ error: { code: 'VALIDATION', field: 'tank_name', message: 'Tank name is required.' } });
  if (tankCode.length > 50) return res.status(400).json({ error: { code: 'VALIDATION', field: 'tank_code', message: 'Tank code must be 50 characters or fewer.' } });
  if (tankName.length > 255) return res.status(400).json({ error: { code: 'VALIDATION', field: 'tank_name', message: 'Tank name must be 255 characters or fewer.' } });
  for (const field of Object.keys(tankNumericFields) as Array<keyof typeof tankNumericFields>) {
    const validationError = tankNumberError(req.body[field], field);
    if (validationError) return res.status(400).json({ error: validationError });
  }
  const overflowValidation = overflowLevelValidation(overflow_level_mm, design_water_level_mm);
  if (overflowValidation) return res.status(400).json({ error: overflowValidation });
  if (product_master_id && exhibit_id) {
    return res.status(400).json({
      error: {
        code: 'INVALID_PIM_ASSIGNMENT',
        field: 'product_master_id',
        message: 'Use the protected PIM tank assignment workflow to link a library tank to an exhibit.',
      },
    });
  }
  if (system_id) {
    const editable = await loadEditableSystem(query, String(system_id));
    if (!editable.system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    if (editable.error) return res.status(409).json({ error: editable.error });
  }
  if (product_master_id) {
    const access = await query(
      `SELECT rma.access_level
       FROM users u
       LEFT JOIN roles r ON r.name=u.role
       LEFT JOIN role_module_access rma ON rma.role_id=r.id AND rma.module_key='pim'
       WHERE u.id=$1`,
      [req.user!.id],
    );
    if (access.rows[0]?.access_level !== 'manage') {
      return res.status(403).json({
        error: { code: 'MODULE_READ_ONLY', message: 'PIM manage access is required to create a linked project tank.' },
      });
    }
    const product = await query(
      `SELECT id, design_water_level_mm FROM product_masters
       WHERE id=$1 AND product_category='Tank'`,
      [product_master_id],
    );
    if (!product.rows[0]) {
      return res.status(400).json({
        error: { code: 'INVALID_PIM_TANK', message: 'The selected item is not a valid PIM tank.' },
      });
    }
    const pimOverflowValidation = overflowLevelValidation(
      overflow_level_mm,
      design_water_level_mm === undefined || design_water_level_mm === null || design_water_level_mm === ''
        ? product.rows[0].design_water_level_mm : design_water_level_mm,
    );
    if (pimOverflowValidation) return res.status(400).json({ error: pimOverflowValidation });
  }
  const qty = Math.max(1, parseInt(quantity) || 1);
  const l = length_mm ? parseFloat(length_mm) : null;
  const w = width_mm ? parseFloat(width_mm) : null;
  const h = height_mm ? parseFloat(height_mm) : null;
  const wl = design_water_level_mm ? parseFloat(design_water_level_mm) : null;
  let normalizedFootprint: any = null;
  if (String(shape_type || '').toLowerCase() === 'custom' && custom_footprint != null) {
    try {
      normalizedFootprint = normalizeCustomFootprint(custom_footprint);
      const footprintSummary = summarizeCustomFootprint(normalizedFootprint);
      if (!footprintSummary.valid) {
        return res.status(400).json({ error: { code: 'INVALID_CUSTOM_FOOTPRINT', field: 'custom_footprint', message: footprintSummary.message, validation: footprintSummary } });
      }
    } catch (error: any) {
      if (error instanceof CustomFootprintValidationError) {
        return res.status(400).json({ error: { code: 'INVALID_CUSTOM_FOOTPRINT', field: 'custom_footprint', message: error.validation.message, validation: error.validation } });
      }
      throw error;
    }
  }
  // Auto-calculate volumes from dimensions when not explicitly provided
  const isCustom = (shape_type || '').toLowerCase() === 'custom';
  const isCyl = (shape_type || '').toLowerCase() === 'cylindrical';
  const calcGross = (gross_volume_m3 != null && gross_volume_m3 !== '')
    ? parseFloat(gross_volume_m3)
    : isCustom
      ? null
    : isCyl
      ? (w && h ? Math.round(Math.PI * (w / 2) * (w / 2) * h / 1e9 * 1e4) / 1e4 : null)
      : (l && w && h ? Math.round(l * w * h / 1e9 * 1e4) / 1e4 : null);
  const calcOp = (operating_volume_m3 != null && operating_volume_m3 !== '')
    ? parseFloat(operating_volume_m3)
    : isCustom
      ? null
    : isCyl
      ? (w && wl ? Math.round(Math.PI * (w / 2) * (w / 2) * wl / 1e9 * 1e4) / 1e4 : null)
      : (l && w && wl ? Math.round(l * w * wl / 1e9 * 1e4) / 1e4 : null);
  const surfaceAreaM2 = normalizedFootprint
    ? summarizeCustomFootprint(normalizedFootprint).area_m2
    : isCustom
      ? null
      : calculateWaterSurfaceAreaM2(shape_type, l, w);
  const result = await query(
    'INSERT INTO tanks (tank_code, project_id, exhibit_id, system_id, quantity, tank_name, tank_type, product_master_id, shape_type, gross_volume_m3, operating_volume_m3, surface_area_m2, length_mm, width_mm, height_mm, design_water_level_mm, overflow_level_mm, custom_footprint, primary_material, status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *',
     [tankCode, project_id, exhibit_id || null, system_id || null, qty, tankName, tank_type || null, product_master_id || null, shape_type || null, calcGross, calcOp, surfaceAreaM2, l, w, h, wl, overflow_level_mm === '' || overflow_level_mm == null ? null : Number(overflow_level_mm), normalizedFootprint, primary_material || null, status || 'Active', notes || null]);
  const tank = result.rows[0];
  if (qty > 1) {
    const pad = qty > 99 ? 3 : qty > 9 ? 2 : 1;
    const instanceRows = Array.from({ length: qty }, (_, i) => ({
      tank_id: tank.id,
      instance_index: i + 1,
      tag: `${tank_code.toUpperCase()}-${String(i + 1).padStart(pad, '0')}`,
    }));
    for (const inst of instanceRows) {
      await query(
        'INSERT INTO tank_instances (tank_id, instance_index, tag) VALUES ($1,$2,$3) ON CONFLICT (tank_id, instance_index) DO NOTHING',
        [inst.tank_id, inst.instance_index, inst.tag]);
    }
  }
  res.status(201).json(tank);
  } catch (error: any) {
    if (error?.code === '23505' && error?.constraint === 'idx_tanks_pim_assignment') {
      return res.status(409).json({
        error: { code: 'DUPLICATE_ASSIGNMENT', field: 'product_master_id', message: 'This PIM tank is already assigned to the exhibit.' },
      });
    }
    if (error?.code === '23505') {
      return res.status(409).json({
        error: { code: 'DUPLICATE_TANK', field: 'tank_code', message: 'A tank with this code already exists in the project.' },
      });
    }
    if (error?.code === '22P02' || error?.code === '23503') {
      return res.status(400).json({ error: tankDatabaseResponse(error) });
    }
    throw error;
  }
});

// CREATE A PROJECT TANK FROM A REUSABLE PIM TANK
// The PIM record remains library-owned; the new tank carries the relationship
// and uses COALESCE-based effective values when it has no project override.
router.post(
  '/tanks/from-pim',
  authenticate,
  requireRole('admin', 'engineer'),
  requireModuleManage('projects'),
  requireModuleManage('pim'),
  async (req: AuthRequest, res: Response) => {
    const projectId = String(req.body.project_id || '').trim();
    const exhibitId = String(req.body.exhibit_id || '').trim();
    const designBookId = String(req.body.design_book_id || '').trim();
    const productMasterId = String(req.body.product_master_id || '').trim();
    const replaceTankId = String(req.body.replace_tank_id || '').trim();
    const requestedCode = String(req.body.tank_code || '').trim().toUpperCase();
    const requestedName = String(req.body.tank_name || '').trim();

    if (!projectId || !exhibitId || !designBookId || !productMasterId) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'project_id, exhibit_id, design_book_id and product_master_id are required.' },
      });
    }
    if (requestedCode && (requestedCode.length > 50 || !/^[A-Z0-9][A-Z0-9._-]*$/.test(requestedCode))) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'Tank code may contain only letters, numbers, dots, underscores, and hyphens.' },
      });
    }
    if (requestedName.length > 255) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'Tank name must be 255 characters or fewer.' } });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const exhibitResult = await client.query(
        `SELECT e.id, e.project_id, e.exhibit_name, p.project_code
         FROM exhibits e
         JOIN projects p ON p.id=e.project_id
         WHERE e.id=$1
         FOR UPDATE`,
        [exhibitId],
      );
      const exhibit = exhibitResult.rows[0];
      if (!exhibit) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Exhibit not found.' } });
      }
      if (String(exhibit.project_id) !== projectId) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: { code: 'INVALID_PROJECT', message: 'The selected exhibit does not belong to the current project.' },
        });
      }

      const designBookResult = await client.query(
        `SELECT id, status
         FROM design_books
         WHERE id=$1 AND project_id=$2
         FOR SHARE`,
        [designBookId, projectId],
      );
      const designBook = designBookResult.rows[0];
      if (!designBook) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Linked Design Book not found.' } });
      }
      if (!['Draft', 'In Progress'].includes(designBook.status)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: { code: 'DESIGN_BOOK_READ_ONLY', message: 'Tanks can only be assigned while the Design Book is editable.' },
        });
      }

      const productResult = await client.query(
        `SELECT pm.*, tf.name AS tank_family_name
         FROM product_masters pm
         LEFT JOIN tank_families tf ON tf.id=pm.tank_family_id
         WHERE (pm.id::text=$1 OR pm.product_code=$1)
           AND pm.product_category='Tank'
         FOR SHARE OF pm`,
        [productMasterId],
      );
      const product = productResult.rows[0];
      if (!product) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: { code: 'INVALID_PIM_TANK', message: 'The selected item is not a valid PIM tank.' },
        });
      }

      const existingExhibitTank = await client.query(
        `SELECT id, tank_code, tank_name
         FROM tanks
         WHERE project_id=$1 AND exhibit_id=$2 AND product_master_id=$3
           AND ($4 = '' OR id::text <> $4)
         FOR UPDATE`,
        [projectId, exhibitId, product.id, replaceTankId],
      );
      if (existingExhibitTank.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_ASSIGNMENT',
            message: `PIM tank ${product.product_code} is already assigned to exhibit ${exhibit.exhibit_name} as ${existingExhibitTank.rows[0].tank_code}.`,
            existing_tank: existingExhibitTank.rows[0],
          },
        });
      }

      const tankName = requestedName || product.product_name;
      const surfaceAreaM2 = product.surface_area_m2 ?? calculateWaterSurfaceAreaM2(
        product.shape_type,
        product.length_mm,
        product.width_mm,
      );

      let tankResult;
      if (replaceTankId) {
        const replacement = await client.query(
          `SELECT id, tank_code
           FROM tanks
           WHERE id=$1 AND project_id=$2 AND exhibit_id=$3
           FOR UPDATE`,
          [replaceTankId, projectId, exhibitId],
        );
        if (!replacement.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            error: { code: 'REPLACEMENT_TANK_NOT_FOUND', message: 'The tank being replaced is no longer assigned to this exhibit.' },
          });
        }
        tankResult = await client.query(
          `UPDATE tanks SET
             tank_name=$1, tank_type=NULL, product_master_id=$2, shape_type=NULL,
             gross_volume_m3=NULL, operating_volume_m3=NULL, surface_area_m2=NULL,
             length_mm=NULL, width_mm=NULL, height_mm=NULL, design_water_level_mm=NULL,
             primary_material=NULL, material_id=NULL, wall_thickness_mm=NULL,
             inner_length_mm=NULL, inner_width_mm=NULL, inner_height_mm=NULL,
             status='Active', updated_at=NOW()
           WHERE id=$3
           RETURNING *`,
          [tankName, product.id, replaceTankId],
        );
      } else {
        const usedCodes = await client.query(
          'SELECT tank_code FROM tanks WHERE project_id=$1 FOR UPDATE',
          [projectId],
        );
        const used = new Set(usedCodes.rows.map((row: any) => String(row.tank_code).toUpperCase()));
        const baseCode = (requestedCode || `PIM-${product.product_code}`).slice(0, 50);
        let tankCode = baseCode;
        let suffix = 2;
        while (used.has(tankCode)) {
          const suffixText = `-${suffix++}`;
          tankCode = `${baseCode.slice(0, 50 - suffixText.length)}${suffixText}`;
        }
        tankResult = await client.query(
          `INSERT INTO tanks
            (tank_code, project_id, exhibit_id, quantity, tank_name, tank_type,
             product_master_id, shape_type, gross_volume_m3, operating_volume_m3,
             length_mm, width_mm, height_mm, design_water_level_mm,
             primary_material, status, notes)
           VALUES ($1,$2,$3,1,$4,NULL,$5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'Active',NULL)
           RETURNING *`,
          [
            tankCode,
            projectId,
            exhibitId,
            tankName,
            product.id,
          ],
        );
      }
      const tank = tankResult.rows[0];
      if (!tank) {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: { code: 'CREATE_FAILED', message: 'The linked project tank could not be created.' } });
      }
      await client.query('COMMIT');

      await logAudit(req.user!.id, 'tank', tank.id, replaceTankId ? 'REPLACE_FROM_PIM' : 'CREATE_FROM_PIM', {
        summary: replaceTankId
          ? `Project tank ${tank.tank_code} replaced from PIM tank ${product.product_code}`
          : `Project tank ${tank.tank_code} created from PIM tank ${product.product_code}`,
        project_id: projectId,
        exhibit_id: exhibitId,
        design_book_id: designBookId,
        product_master_id: product.id,
        product_code: product.product_code,
      }, req.ip || undefined);

      res.status(201).json({
        ...tank,
        pim_product_code: product.product_code,
        pim_product_name: product.product_name,
        pim_tank_family_name: product.tank_family_name,
        eff_tank_type: product.application_type,
        eff_shape: product.shape_type,
        eff_length_mm: product.length_mm,
        eff_width_mm: product.width_mm,
        eff_height_mm: product.height_mm,
        eff_water_level_mm: product.design_water_level_mm,
        eff_primary_material: product.primary_material_code,
        eff_notes: product.notes,
        gross_volume_m3: product.gross_volume_m3,
        design_volume_m3: product.operating_volume_m3,
        surface_area_m2: surfaceAreaM2,
      });
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        const assignmentConflict = error?.constraint === 'idx_tanks_pim_assignment';
        return res.status(409).json({
          error: {
            code: assignmentConflict ? 'DUPLICATE_ASSIGNMENT' : 'DUPLICATE_TANK',
            message: assignmentConflict
              ? 'This PIM tank is already assigned to the exhibit.'
              : 'A tank with this code already exists in the project.',
          },
        });
      }
      throw error;
    } finally {
      client.release();
    }
  },
);

// PROMOTE A PROJECT TANK INTO THE REUSABLE PIM TANK LIBRARY
router.post(
  '/tanks/:id/promote-to-pim',
  authenticate,
  requireRole('admin', 'engineer'),
  requireModuleManage('pim'),
  async (req: AuthRequest, res: Response) => {
    const productCode = String(req.body.product_code || '').trim().toUpperCase();
    const productName = String(req.body.product_name || '').trim();
    const requestedFamilyId = String(req.body.tank_family_id || req.body.family_id || '').trim();
    const newFamily = req.body.new_family && typeof req.body.new_family === 'object' ? req.body.new_family : null;
    const newFamilyCode = String(newFamily?.code || req.body.new_family_code || '').trim().toUpperCase();
    const newFamilyName = String(newFamily?.name || req.body.new_family_name || '').trim();
    const designBookId = String(req.body.design_book_id || '').trim();

    if (!productCode || !productName) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'A reusable product code and name are required.' },
      });
    }
    if (productCode.length > 50 || !/^[A-Z0-9][A-Z0-9._-]*$/.test(productCode)) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'Product code may contain only letters, numbers, dots, underscores, and hyphens.' },
      });
    }
    if (productName.length > 255) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'Product name must be 255 characters or fewer.' },
      });
    }
    if ((requestedFamilyId && (newFamilyCode || newFamilyName)) || (!!newFamilyCode !== !!newFamilyName)) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'Choose an existing tank family or provide both a new family code and name.' },
      });
    }
    if (!requestedFamilyId && !newFamilyCode) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'A tank family is required for a reusable PIM tank.' },
      });
    }
    if (!designBookId) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'The source Design Book is required for tank promotion.' },
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sourceResult = await client.query(
        `SELECT t.*, p.project_code, p.project_name
         FROM tanks t
         JOIN projects p ON p.id=t.project_id
         WHERE t.id=$1
         FOR UPDATE`,
        [req.params.id],
      );
      const source = sourceResult.rows[0];
      if (!source) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project tank not found' } });
      }

      const designBookResult = await client.query(
        `SELECT id, status
         FROM design_books
         WHERE id=$1 AND project_id=$2
         FOR SHARE`,
        [designBookId, source.project_id],
      );
      if (!designBookResult.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Linked Design Book not found' } });
      }
      if (!['Draft', 'In Progress'].includes(designBookResult.rows[0].status)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: { code: 'DESIGN_BOOK_READ_ONLY', message: 'Tanks can only be promoted while the Design Book is editable.' },
        });
      }

      const existing = await client.query(
        `SELECT pm.id, pm.product_code, pm.product_name
         FROM product_masters pm
         WHERE pm.source_tank_id=$1 OR pm.product_code=$2 OR pm.id=$3`,
        [source.id, productCode, source.product_master_id || null],
      );
      if (existing.rows[0]) {
        await client.query('ROLLBACK');
        const match = existing.rows[0];
        const isSourceLink = source.product_master_id && String(match.id) === String(source.product_master_id);
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_PROMOTION',
            message: isSourceLink
              ? `This project tank is already linked to PIM product ${match.product_code}.`
              : `PIM product code ${match.product_code} is already in use.`,
          },
          existing_product: match,
        });
      }

      let tankFamilyId = requestedFamilyId || null;
      if (newFamilyCode) {
        const familyResult = await client.query(
          `INSERT INTO tank_families (code, name, description, sort_order, is_system)
           VALUES ($1,$2,$3,0,false)
           RETURNING id, code, name, description`,
          [newFamilyCode, newFamilyName, newFamily?.description ? String(newFamily.description).trim() : null],
        );
        tankFamilyId = familyResult.rows[0].id;
      } else {
        const familyResult = await client.query(
          'SELECT id FROM tank_families WHERE id::text=$1 OR code=$1',
          [requestedFamilyId],
        );
        if (!familyResult.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'Selected tank family was not found.' } });
        }
        tankFamilyId = familyResult.rows[0].id;
      }

      const productResult = await client.query(
        `INSERT INTO product_masters
          (product_code, tank_family_id, product_name, product_category, application_type,
           primary_material_code, standard_status, notes, shape_type, length_mm, width_mm,
            height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3,
            surface_area_m2, manufacturer, model, source_tank_id, source_tank_snapshot)
         VALUES ($1,$2,$3,'Tank',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
         RETURNING *`,
        [
          productCode,
          tankFamilyId,
          productName,
          req.body.application_type || source.tank_type || null,
          req.body.primary_material_code || source.primary_material || null,
          req.body.standard_status || 'Concept',
          req.body.notes !== undefined ? String(req.body.notes).trim() || null : source.notes || null,
          source.shape_type || null,
          source.length_mm || null,
          source.width_mm || null,
          source.height_mm || null,
          source.design_water_level_mm || null,
          source.gross_volume_m3 || null,
          source.operating_volume_m3 || null,
           source.surface_area_m2 ?? calculateWaterSurfaceAreaM2(source.shape_type, source.length_mm, source.width_mm),
          req.body.manufacturer ? String(req.body.manufacturer).trim() : null,
          req.body.model ? String(req.body.model).trim() : null,
          source.id,
          JSON.stringify({
            design_book_id: designBookId,
            tank_id: source.id,
            tank_code: source.tank_code,
            tank_name: source.tank_name,
            project_id: source.project_id,
            project_code: source.project_code,
            project_name: source.project_name,
          }),
        ],
      );
      const product = productResult.rows[0];

      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details, ip_address)
         VALUES ('product',$1,'PROMOTE_FROM_PROJECT_TANK',$2,$3,$4)`,
        [
          product.id,
          req.user!.id,
          JSON.stringify({
            summary: `PIM tank ${productCode} promoted from project tank ${source.tank_code}`,
            product_code: productCode,
            source_tank_id: source.id,
            source_tank_code: source.tank_code,
            project_code: source.project_code,
            design_book_id: designBookId,
          }),
          req.ip || null,
        ],
      );
      await client.query('COMMIT');

      res.status(201).json({
        ...product,
        source_tank_id: source.id,
        source_tank_code: source.tank_code,
        source_project_code: source.project_code,
        source_project_name: source.project_name,
      });
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        return res.status(409).json({
          error: { code: 'DUPLICATE_PROMOTION', message: 'This tank or product code has already been promoted to the PIM library.' },
        });
      }
      throw error;
    } finally {
      client.release();
    }
  },
);

router.post('/tanks/:id/duplicate', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  const orig = await query('SELECT * FROM tanks WHERE id=$1', [req.params.id]);
  if (!orig.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
  const t = orig.rows[0];
  const existing = await query('SELECT tank_code FROM tanks WHERE project_id=$1', [t.project_id]);
  const usedCodes = new Set(existing.rows.map((r: any) => r.tank_code.toUpperCase()));
  let newCode = `${t.tank_code}-2`;
  let n = 2;
  while (usedCodes.has(newCode.toUpperCase())) { n++; newCode = `${t.tank_code}-${n}`; }
  const qty = t.quantity ?? 1;
  const result = await query(
    'INSERT INTO tanks (tank_code, project_id, system_id, quantity, tank_name, tank_type, product_master_id, shape_type, gross_volume_m3, operating_volume_m3, surface_area_m2, custom_footprint, length_mm, width_mm, height_mm, design_water_level_mm, overflow_level_mm, primary_material, status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *',
    [newCode.toUpperCase(), t.project_id, t.system_id, qty, `${t.tank_name} (Copy)`, t.tank_type, t.product_master_id, t.shape_type, t.gross_volume_m3, t.operating_volume_m3, t.surface_area_m2, t.custom_footprint, t.length_mm, t.width_mm, t.height_mm, t.design_water_level_mm, t.overflow_level_mm, t.primary_material, t.status || 'Active', t.notes]);
  const newTank = result.rows[0];
  if (qty > 1) {
    const pad = qty > 99 ? 3 : qty > 9 ? 2 : 1;
    for (let i = 1; i <= qty; i++) {
      await query('INSERT INTO tank_instances (tank_id, instance_index, tag) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [newTank.id, i, `${newCode.toUpperCase()}-${String(i).padStart(pad, '0')}`]);
    }
  }
  res.status(201).json(newTank);
});

router.patch('/systems/reorder', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'orderedIds must be an array' } });
  for (let i = 0; i < orderedIds.length; i++) {
    await query('UPDATE systems SET sort_order=$1 WHERE id=$2', [i, orderedIds[i]]);
  }
  res.json({ ok: true });
});

router.patch('/tanks/reorder', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'orderedIds must be an array' } });
  for (let i = 0; i < orderedIds.length; i++) {
    await query('UPDATE tanks SET sort_order=$1 WHERE id=$2', [i, orderedIds[i]]);
  }
  res.json({ ok: true });
});

router.patch('/tanks/:id', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  try {
    const { system_id, product_master_id } = req.body;
    const hasPM = 'product_master_id' in req.body;
    if (hasPM) {
      return res.status(400).json({
        error: {
          code: 'INVALID_PIM_ASSIGNMENT',
          message: 'Tank library relationships cannot be changed through the generic update endpoint.',
        },
      });
    }
    const result = await query(
      'UPDATE tanks SET system_id=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [system_id || null, req.params.id],
    );
    if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505' && err?.constraint === 'idx_tanks_pim_assignment') {
      return res.status(409).json({
        error: { code: 'DUPLICATE_ASSIGNMENT', message: 'This PIM tank is already assigned to the exhibit.' },
      });
    }
    throw err;
  }
});

router.put('/tanks/:id', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  try {
  const {
    tank_code, tank_name, tank_type, shape_type,
    length_mm, width_mm, height_mm, design_water_level_mm, overflow_level_mm,
    primary_material, status, notes, quantity,
    gross_volume_m3, operating_volume_m3, system_id, exhibit_id,
    product_master_id,
    material_id, wall_thickness_mm, inner_length_mm, inner_width_mm, inner_height_mm,
    surface_area_m2, custom_footprint,
  } = req.body;
  if (!String(tank_name ?? '').trim()) {
    return res.status(400).json({ error: { code: 'VALIDATION', field: 'tank_name', message: 'Tank name is required.' } });
  }
  if (tank_code != null && String(tank_code).trim().length > 50) {
    return res.status(400).json({ error: { code: 'VALIDATION', field: 'tank_code', message: 'Tank code must be 50 characters or fewer.' } });
  }
  if (String(tank_name).trim().length > 255) {
    return res.status(400).json({ error: { code: 'VALIDATION', field: 'tank_name', message: 'Tank name must be 255 characters or fewer.' } });
  }
  for (const field of Object.keys(tankNumericFields) as Array<keyof typeof tankNumericFields>) {
    const validationError = tankNumberError(req.body[field], field);
    if (validationError) return res.status(400).json({ error: validationError });
  }
  const hasExhibit = 'exhibit_id' in req.body;
  const hasProductMaster = 'product_master_id' in req.body;
  const hasOverflowLevel = Object.prototype.hasOwnProperty.call(req.body, 'overflow_level_mm');
  if (hasProductMaster && product_master_id) {
    return res.status(400).json({
      error: {
        code: 'INVALID_PIM_ASSIGNMENT',
        message: 'Use the protected PIM tank assignment workflow to assign a library-linked tank.',
      },
    });
  }
  if (hasExhibit && exhibit_id) {
    const currentTank = await query(
      'SELECT id, product_master_id FROM tanks WHERE id=$1',
      [req.params.id],
    );
    if (!currentTank.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
    if (currentTank.rows[0].product_master_id) {
      return res.status(400).json({
        error: {
          code: 'INVALID_PIM_ASSIGNMENT',
          message: 'Use the protected PIM tank assignment workflow to assign a library-linked tank to an exhibit.',
        },
      });
    }
  }
  const currentTankLevels = await query(
    `SELECT t.overflow_level_mm,
            COALESCE(t.design_water_level_mm, pm.design_water_level_mm) AS effective_water_level_mm
     FROM tanks t LEFT JOIN product_masters pm ON pm.id=t.product_master_id WHERE t.id=$1`,
    [req.params.id],
  );
  if (!currentTankLevels.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
  const overflowValidation = overflowLevelValidation(
    hasOverflowLevel ? overflow_level_mm : currentTankLevels.rows[0].overflow_level_mm,
    design_water_level_mm === undefined || design_water_level_mm === null || design_water_level_mm === ''
      ? currentTankLevels.rows[0].effective_water_level_mm
      : design_water_level_mm,
  );
  if (overflowValidation) return res.status(400).json({ error: overflowValidation });
  const currentSystemLink = await query('SELECT system_id FROM tanks WHERE id=$1', [req.params.id]);
  if (!currentSystemLink.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
  for (const linkedSystemId of new Set([currentSystemLink.rows[0].system_id, system_id].filter(Boolean))) {
    const editable = await loadEditableSystem(query, String(linkedSystemId));
    if (!editable.system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    if (editable.error) return res.status(409).json({ error: editable.error });
  }
  const l = length_mm ? parseFloat(length_mm) : null;
  const w = width_mm ? parseFloat(width_mm) : null;
  const h = height_mm ? parseFloat(height_mm) : null;
  const wl = design_water_level_mm ? parseFloat(design_water_level_mm) : null;
  const t  = wall_thickness_mm ? parseFloat(wall_thickness_mm) : 0;
  const isCustom = (shape_type || '').toLowerCase() === 'custom';
  const isCyl    = (shape_type || '').toLowerCase() === 'cylindrical';
  let normalizedFootprint: any = null;
  let customFootprintAreaM2: number | null = null;
  if (isCustom && custom_footprint != null) {
    try {
      normalizedFootprint = normalizeCustomFootprint(custom_footprint);
      const footprintSummary = summarizeCustomFootprint(normalizedFootprint);
      if (!footprintSummary.valid) {
        return res.status(400).json({ error: { code: 'INVALID_CUSTOM_FOOTPRINT', field: 'custom_footprint', message: footprintSummary.message, validation: footprintSummary } });
      }
      customFootprintAreaM2 = footprintSummary.area_m2;
    } catch (error: any) {
      if (error instanceof CustomFootprintValidationError) {
        return res.status(400).json({ error: { code: 'INVALID_CUSTOM_FOOTPRINT', field: 'custom_footprint', message: error.validation.message, validation: error.validation } });
      }
      throw error;
    }
  }
  const requestedSurfaceArea = surface_area_m2 != null && surface_area_m2 !== ''
    ? parseFloat(surface_area_m2)
    : null;
  if (requestedSurfaceArea != null && (!Number.isFinite(requestedSurfaceArea) || requestedSurfaceArea < 0)) {
    return res.status(400).json({
      error: { code: 'VALIDATION', field: 'surface_area_m2', message: 'Water-surface area must be a non-negative number.' },
    });
  }
  // Use inner dims when wall thickness is set (open-top: subtract one wall from height)
  const il = !isCyl && l && t ? l - 2 * t : l;
  const iw = w && t ? w - 2 * t : w;
  const ih = h && t ? h - t : h;
  const calcGross = isCustom
    ? (customFootprintAreaM2 && h
      ? Math.round(customFootprintAreaM2 * h / 1000 * 1e6) / 1e6
      : (gross_volume_m3 != null && gross_volume_m3 !== '' ? parseFloat(gross_volume_m3) : null))
    : isCyl
      ? (iw && ih ? Math.round(Math.PI * (iw / 2) * (iw / 2) * ih / 1e9 * 1e4) / 1e4 : null)
      : (il && iw && ih ? Math.round(il * iw * ih / 1e9 * 1e4) / 1e4 : null);
  const calcOp = isCustom
    ? (customFootprintAreaM2 && wl
      ? Math.round(customFootprintAreaM2 * wl / 1000 * 1e6) / 1e6
      : (operating_volume_m3 != null && operating_volume_m3 !== '' ? parseFloat(operating_volume_m3) : null))
    : isCyl
      ? (iw && wl ? Math.round(Math.PI * (iw / 2) * (iw / 2) * wl / 1e9 * 1e4) / 1e4 : null)
      : (il && iw && wl ? Math.round(il * iw * wl / 1e9 * 1e4) / 1e4 : null);
  const surfaceAreaM2 = normalizedFootprint
    ? customFootprintAreaM2
    : isCustom
      ? null
    : calculateWaterSurfaceAreaM2(shape_type, isCyl ? null : l, w);
  const qty = Math.max(1, parseInt(quantity) || 1);
  const result = await query(
    `UPDATE tanks SET
      tank_code=COALESCE($1, tank_code), tank_name=$2, tank_type=$3, shape_type=$4,
       length_mm=$5, width_mm=$6, height_mm=$7, design_water_level_mm=$8,
       overflow_level_mm=CASE WHEN $9 THEN $10 ELSE overflow_level_mm END,
       gross_volume_m3=$11, operating_volume_m3=$12, surface_area_m2=$13,
       custom_footprint=$14, primary_material=$15, status=$16, notes=$17, quantity=$18,
       system_id=$19, material_id=$20, wall_thickness_mm=$21,
       inner_length_mm=$22, inner_width_mm=$23, inner_height_mm=$24,
       product_master_id=CASE WHEN $25 THEN $26 ELSE product_master_id END,
       exhibit_id=CASE WHEN $27 THEN $28 ELSE exhibit_id END,
      updated_at=NOW()
    WHERE id=$29 RETURNING *`,
    [tank_code ? tank_code.trim().toUpperCase() : null, tank_name, tank_type || null, shape_type || null,
     l, w, h, wl, hasOverflowLevel, overflow_level_mm === '' || overflow_level_mm == null ? null : Number(overflow_level_mm), calcGross, calcOp, surfaceAreaM2, normalizedFootprint,
     primary_material || null, status || 'Active', notes || null, qty,
     system_id || null,
     material_id || null, wall_thickness_mm ?? null,
     inner_length_mm ?? null, inner_width_mm ?? null, inner_height_mm ?? null,
     hasProductMaster, product_master_id || null,
     hasExhibit, exhibit_id || null,
     req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
  res.json(result.rows[0]);
  } catch (error: any) {
    if (error?.code === '23505' && error?.constraint === 'idx_tanks_pim_assignment') {
      return res.status(409).json({
        error: { code: 'DUPLICATE_ASSIGNMENT', field: 'product_master_id', message: 'This PIM tank is already assigned to the exhibit.' },
      });
    }
    if (error?.code === '23505') {
      return res.status(409).json({
        error: { code: 'DUPLICATE_TANK', field: 'tank_code', message: 'A tank with this code already exists in the project.' },
      });
    }
    if (error?.code === '22P02' || error?.code === '23503') {
      return res.status(400).json({ error: tankDatabaseResponse(error) });
    }
    throw error;
  }
});

// Quick exhibit assignment for tanks
router.patch('/tanks/:id/exhibit', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  try {
    const { exhibit_id, replace_tank_id } = req.body;
    const currentTank = await query(
      'SELECT id, project_id, product_master_id FROM tanks WHERE id=$1',
      [req.params.id],
    );
    if (!currentTank.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
    if (exhibit_id && currentTank.rows[0].product_master_id) {
      return res.status(400).json({
        error: {
          code: 'INVALID_PIM_ASSIGNMENT',
          message: 'Use the protected PIM tank assignment workflow to assign a library-linked tank to an exhibit.',
        },
      });
    }
    if (exhibit_id) {
      const targetExhibit = await query(
        'SELECT id FROM exhibits WHERE id=$1 AND project_id=$2',
        [exhibit_id, currentTank.rows[0].project_id],
      );
      if (!targetExhibit.rows[0]) {
        return res.status(400).json({
          error: { code: 'INVALID_PROJECT', message: 'The selected exhibit does not belong to this tank project.' },
        });
      }
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (replace_tank_id) {
        if (String(replace_tank_id) === String(req.params.id)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: { code: 'INVALID_REPLACEMENT', message: 'A tank cannot replace itself.' },
          });
        }
        const replacement = await client.query(
          `SELECT id
           FROM tanks
           WHERE id=$1 AND project_id=$2 AND exhibit_id=$3
           FOR UPDATE`,
          [replace_tank_id, currentTank.rows[0].project_id, exhibit_id],
        );
        if (!replacement.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            error: { code: 'REPLACEMENT_TANK_NOT_FOUND', message: 'The tank being replaced is no longer assigned to this exhibit.' },
          });
        }
        await client.query(
          'UPDATE tanks SET exhibit_id=NULL, updated_at=NOW() WHERE id=$1',
          [replace_tank_id],
        );
      }
      const result = await client.query(
        'UPDATE tanks SET exhibit_id=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
        [exhibit_id || null, req.params.id],
      );
      if (!result.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
      }
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    if (error?.code === '23505' && error?.constraint === 'idx_tanks_pim_assignment') {
      return res.status(409).json({
        error: { code: 'DUPLICATE_ASSIGNMENT', message: 'This PIM tank is already assigned to the exhibit.' },
      });
    }
    throw error;
  }
});

router.delete('/tanks/:id', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  await query('DELETE FROM tank_instances WHERE tank_id=$1', [req.params.id]);
  const result = await query('DELETE FROM tanks WHERE id=$1 RETURNING id, tank_code', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
  res.json({ deleted: true });
});

router.patch('/tank-instances/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { tag, display_name, exhibit_id } = req.body;
  if (tag !== undefined && (!tag || !tag.trim())) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'tag cannot be empty' } });
  const result = await query(
    `UPDATE tank_instances SET
      tag = COALESCE($1, tag),
      display_name = $2,
      exhibit_id = $3
    WHERE id=$4 RETURNING *`,
    [tag ? tag.trim().toUpperCase() : null, display_name || null, exhibit_id || null, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank instance not found' } });
  res.json(result.rows[0]);
});

// SYSTEMS
router.get('/systems', authenticate, async (req: AuthRequest, res: Response) => {
  const { page, page_size, offset } = paginate(req);
  const filters: string[] = [];
  const params: any[] = [];
  if (req.query.project_id) { params.push(req.query.project_id); filters.push(`s.project_id = $${params.length}`); }
  if (req.query.status) { params.push(req.query.status); filters.push(`s.status = $${params.length}`); }
  if (req.query.include_historical !== 'true' && !req.query.status) {
    filters.push(`s.status NOT IN ('Archived', 'Decommissioned', 'Superseded')`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countRes = await query(`SELECT COUNT(*) FROM systems s ${where}`, params);
  params.push(page_size, offset);
  const result = await query(`SELECT s.*, a.area_name, e.exhibit_name, p.project_code FROM systems s LEFT JOIN areas a ON s.area_id=a.id LEFT JOIN exhibits e ON s.exhibit_id=e.id JOIN projects p ON s.project_id=p.id ${where} ORDER BY s.system_code LIMIT $${params.length-1} OFFSET $${params.length}`, params);
  res.json({
    items: result.rows.map(withoutStaleLinkedSystemFlow),
    pagination: { page, page_size, total: parseInt(countRes.rows[0].count) },
  });
});

router.get('/systems/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT s.*, a.area_name, e.exhibit_name, p.project_code, p.project_name,
            replacement.system_code AS replacement_system_code,
            replacement.system_name AS replacement_system_name,
            predecessor.system_code AS predecessor_system_code,
            predecessor.system_name AS predecessor_system_name,
            lifecycle_actor.first_name || ' ' || lifecycle_actor.last_name AS lifecycle_actor_name
     FROM systems s
     LEFT JOIN areas a ON s.area_id=a.id
     LEFT JOIN exhibits e ON s.exhibit_id=e.id
     JOIN projects p ON s.project_id=p.id
     LEFT JOIN systems replacement ON replacement.id=s.superseded_by_system_id
     LEFT JOIN systems predecessor ON predecessor.id=s.supersedes_system_id
     LEFT JOIN users lifecycle_actor ON lifecycle_actor.id=s.lifecycle_changed_by
     WHERE s.id::text=$1 OR s.system_code=$1`,
    [req.params.id],
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
  const sysId = result.rows[0].id;
  const [equipment, tanks, sideStreams, fractionatorAllocations, sandFilterAllocations] = await Promise.all([
    query(
      `SELECT pei.*, pm.product_code, pm.product_name, c.component_code, c.component_name,
              po.id   AS released_po_id,
              po.po_code AS released_po_code
       FROM project_equipment_items pei
       LEFT JOIN product_masters pm ON pei.product_master_id = pm.id
       LEFT JOIN components c ON pei.component_id = c.id
       LEFT JOIN LATERAL (
         SELECT po_id FROM po_items
         WHERE project_equipment_item_id = pei.id LIMIT 1
       ) poi ON true
       LEFT JOIN purchase_orders po ON po.id = poi.po_id
       WHERE pei.system_id = $1 ORDER BY pei.equip_code`, [sysId]),
    query(
      `SELECT t.id, t.tank_code, t.tank_name, t.tank_type, t.quantity,
              t.product_master_id,
              COALESCE(t.gross_volume_m3, pm.gross_volume_m3)       AS gross_volume_m3,
              COALESCE(t.operating_volume_m3, pm.operating_volume_m3) AS operating_volume_m3,
              t.length_mm, t.width_mm, t.height_mm,
              t.primary_material, t.status,
              pm.product_code, pm.product_name,
              po.id      AS released_po_id,
              po.po_code AS released_po_code
       FROM tanks t
       LEFT JOIN product_masters pm ON t.product_master_id = pm.id
       LEFT JOIN LATERAL (
         SELECT po_id FROM po_items WHERE tank_id = t.id LIMIT 1
       ) poi ON true
       LEFT JOIN purchase_orders po ON po.id = poi.po_id
       WHERE t.system_id = $1
       ORDER BY t.tank_code`, [sysId]),
    loadSystemSideStreams(sysId),
    loadSystemFractionatorAllocations(sysId),
    loadSystemSandFilterAllocations(sysId),
  ]);
  res.json({
    ...withoutStaleLinkedSystemFlow(result.rows[0]),
    equipment: equipment.rows,
    tanks: tanks.rows,
    side_streams: sideStreams,
    fractionator_allocations: fractionatorAllocations,
    sand_filter_allocations: sandFilterAllocations,
  });
});

router.get('/systems/:id/fractionator-products', authenticate, async (req: AuthRequest, res: Response) => {
  const system = await query('SELECT id FROM systems WHERE id=$1', [req.params.id]);
  if (!system.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
  const result = await query(
    `SELECT pm.id, pm.product_code, pm.product_name, pm.standard_status, pd.diameter_mm,
            ph.venturi_flow_m3h
     FROM product_masters pm
     JOIN product_families pf ON pf.id=pm.product_family_id
     LEFT JOIN product_dimensions pd ON pd.product_master_id=pm.id
     LEFT JOIN product_hydraulic ph ON ph.product_master_id=pm.id
     WHERE pf.product_family_code='PFM-FF' AND COALESCE(pm.status, 'Active')='Active'
     ORDER BY pm.product_code`,
  );
  res.json({ items: result.rows });
});

router.get('/systems/:id/sand-filter-products', authenticate, async (req: AuthRequest, res: Response) => {
  const system = await query('SELECT id FROM systems WHERE id=$1', [req.params.id]);
  if (!system.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
  const result = await query(
    `SELECT pm.id, pm.product_code, pm.product_name, pm.standard_status, pd.diameter_mm
     FROM product_masters pm
     JOIN product_families pf ON pf.id=pm.product_family_id
     LEFT JOIN product_dimensions pd ON pd.product_master_id=pm.id
     WHERE pf.product_family_code='PFM-SF'
       AND LOWER(BTRIM(COALESCE(pm.status, 'Active')))='active'
       AND LOWER(BTRIM(COALESCE(pm.standard_status, '')))='active'
     ORDER BY pm.product_code`,
  );
  res.json({ items: result.rows });
});

router.post('/systems', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const {
      system_code, project_id, area_id, exhibit_id, system_name, system_type,
      design_flow_m3h, turnover_rate_hr, design_flow_source, turnover_source,
      water_type, status, duty_description, redundancy_strategy,
    } = req.body;
    if (!system_code || !project_id || !system_name) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'system_code, project_id and system_name are required' } });
    }
    if (['Archived', 'Decommissioned', 'Superseded'].includes(status)) {
      return res.status(400).json({
        error: { code: 'INVALID_LIFECYCLE_STATUS', message: 'Create the LSS as a current record, then use the governed lifecycle actions when it is retired.' },
      });
    }
    await client.query('BEGIN');
    if (exhibit_id) {
      const exhibitResult = await client.query(
        'SELECT id, project_id, exhibit_code, water_type FROM exhibits WHERE id=$1 FOR SHARE',
        [exhibit_id],
      );
      const exhibit = exhibitResult.rows[0];
      if (!exhibit) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Selected exhibit not found.' } });
      }
      if (String(exhibit.project_id) !== String(project_id)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: { code: 'OWNERSHIP_MISMATCH', message: 'The exhibit and system must belong to the same project.' },
        });
      }
      if (!compatibleWaterTypes(water_type, exhibit.water_type)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: {
            code: 'INCOMPATIBLE_WATER_TYPE',
            message: `${exhibit.exhibit_code} uses ${exhibit.water_type} water and cannot be linked to a ${water_type} system.`,
          },
        });
      }
    }
    const resolvedDesignFlowSource = design_flow_source === 'linked_exhibits'
      ? 'linked_exhibits'
      : 'manual_override';
    const resolvedTurnoverSource = turnover_source === 'primary_exhibit'
      ? 'primary_exhibit'
      : 'manual_override';
    const result = await client.query(
      `INSERT INTO systems
         (system_code, project_id, area_id, exhibit_id, system_name, system_type,
          design_flow_m3h, turnover_rate_hr, water_type, status, duty_description,
          redundancy_strategy, system_config, calculation_version, last_calculated_at, calculation_inputs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,$13,NOW(),$14)
       RETURNING *`,
      [
        system_code, project_id, area_id || null, exhibit_id || null, system_name, system_type,
        resolvedDesignFlowSource === 'manual_override' ? design_flow_m3h || null : null,
        resolvedTurnoverSource === 'manual_override' ? turnover_rate_hr || null : null,
        water_type, status || 'Draft', duty_description || null, redundancy_strategy || null,
        AQUARIUM_CALCULATION_VERSION,
        JSON.stringify({
          design_flow_source: resolvedDesignFlowSource,
          turnover_source: resolvedTurnoverSource,
          turnover_unit: 'cycles_per_hour',
          flow_unit: 'm3_per_hour',
        }),
      ]);
    if (exhibit_id) {
      await client.query(
        `INSERT INTO system_exhibit_links
           (system_id, exhibit_id, link_type, flow_allocation_m3h, notes, sort_order, allocation_source, allocation_updated_at)
         VALUES ($1,$2,'Primary',NULL,NULL,0,'calculated',NOW())`,
        [result.rows[0].id, exhibit_id],
      );
    }
    await client.query('COMMIT');
    await logAudit(req.user!.id, 'system', result.rows[0].id, 'CREATE', {
      summary: `System ${system_code} created`,
      system_code,
      system_name,
      system_type,
      exhibit_id: exhibit_id || null,
    });
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: `System code "${req.body.system_code}" already exists in this project. Use a different code.` } });
    }
    throw err;
  } finally {
    client.release();
  }
});

router.put('/systems/:id', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  try {
    const {
      system_code, system_name, system_type, design_flow_m3h, turnover_rate_hr,
      design_flow_source, turnover_source,
      water_type, status, duty_description, redundancy_strategy,
      loop1_flow_source, loop1_filtration, loop1_flow_pct, loop1_bio_degas_pct, loop1_flow_mode, loop1_match_loop_number,
      loop1_bio_degas_m3h, loop1_link_bio_degas,
      loop2_flow_source, loop2_filtration, loop2_flow_pct, loop2_bio_degas_pct, loop2_flow_mode, loop2_match_loop_number,
      loop2_bio_degas_m3h, loop2_link_bio_degas,
      loop3_flow_source, loop3_filtration, loop3_flow_pct, loop3_bio_degas_pct, loop3_flow_mode, loop3_match_loop_number,
      loop3_bio_degas_m3h, loop3_link_bio_degas,
      loop1_name, loop2_name, loop3_name, side_streams,
      fractionator_allocations, sand_filter_allocations,
      system_config, compact_unit_id, design_book_id,
    } = req.body;
    let normalizedSideStreams: ReturnType<typeof normalizeSideStreams> = null;
    try {
      normalizedSideStreams = normalizeSideStreams(side_streams);
    } catch (error: any) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
    }
    for (const [loopNumber, name] of [[1, loop1_name], [2, loop2_name], [3, loop3_name]] as const) {
      if (name != null && !String(name).trim()) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: `Loop ${loopNumber} name is required.` } });
      }
      if (name != null && String(name).trim().length > 255) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: `Loop ${loopNumber} name must be 255 characters or fewer.` } });
      }
    }
    for (const [label, value] of [
      ['Design flow', design_flow_m3h],
      ['Turnover rate', turnover_rate_hr],
      ['Loop 1 bio/degas flow', loop1_bio_degas_m3h],
      ['Loop 2 bio/degas flow', loop2_bio_degas_m3h],
      ['Loop 3 bio/degas flow', loop3_bio_degas_m3h],
    ] as Array<[string, any]>) {
      if (value != null && value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: `${label} must be a non-negative number.` } });
      }
    }
    for (const [label, value] of [
      ['Loop 1 allocation', loop1_flow_pct],
      ['Loop 1 Bio/Degas allocation', loop1_bio_degas_pct],
      ['Loop 2 allocation', loop2_flow_pct],
      ['Loop 2 Bio/Degas allocation', loop2_bio_degas_pct],
      ['Loop 3 allocation', loop3_flow_pct],
      ['Loop 3 Bio/Degas allocation', loop3_bio_degas_pct],
    ] as Array<[string, any]>) {
      if (value != null && value !== '' && (
        !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100
      )) {
        return res.status(400).json({
          error: { code: 'VALIDATION', message: `${label} must be between 0% and 100%.` },
        });
      }
    }
    const currentResult = await query('SELECT * FROM systems WHERE id=$1', [req.params.id]);
    if (!currentResult.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    if (isRetiredSystem(currentResult.rows[0])) {
      return res.status(409).json({ error: systemLifecycleError(currentResult.rows[0]) });
    }
    if (['Archived', 'Decommissioned', 'Superseded'].includes(status)) {
      return res.status(400).json({
        error: { code: 'GOVERNED_LIFECYCLE_REQUIRED', message: 'Use Archive / Decommission LSS or Supersede LSS so a reason and audit evidence are recorded.' },
      });
    }
    const currentCalculationInputs = currentResult.rows[0].calculation_inputs &&
      typeof currentResult.rows[0].calculation_inputs === 'object'
      ? currentResult.rows[0].calculation_inputs
      : {};
    const resolvedDesignFlowSource = design_flow_source === 'linked_exhibits' ||
      design_flow_source === 'manual_override'
      ? design_flow_source
      : currentCalculationInputs.design_flow_source === 'linked_exhibits'
        ? 'linked_exhibits'
        : design_flow_m3h != null ? 'manual_override' : 'linked_exhibits';
    const resolvedTurnoverSource = turnover_source === 'primary_exhibit' ||
      turnover_source === 'manual_override'
      ? turnover_source
      : currentCalculationInputs.turnover_source === 'primary_exhibit'
        ? 'primary_exhibit'
        : turnover_rate_hr != null ? 'manual_override' : 'primary_exhibit';
    const currentSystem = currentResult.rows[0];
    const hasSystemConfig = Object.prototype.hasOwnProperty.call(req.body, 'system_config');
    const hasCompactUnitId = Object.prototype.hasOwnProperty.call(req.body, 'compact_unit_id');
    const resolvedSystemConfig = hasSystemConfig
      ? (system_config || null)
      : (currentSystem.system_config || null);
    const resolvedCompactUnitId = hasCompactUnitId
      ? (compact_unit_id || null)
      : hasSystemConfig && resolvedSystemConfig !== 'compact'
        ? null
        : (currentSystem.compact_unit_id || null);
    const resolvedFlowSources = [loop1_flow_source, loop2_flow_source, loop3_flow_source]
      .map((value, index) => Object.prototype.hasOwnProperty.call(req.body, `loop${index + 1}_flow_source`)
        ? (value || null)
        : (currentSystem[`loop${index + 1}_flow_source`] || null));
    const circulationSources = new Set(['Break Tank', 'Plenum Tank']);
    const resolvedPercentage = (field: string, value: any) =>
      Object.prototype.hasOwnProperty.call(req.body, field)
        ? (value === '' || value == null ? null : Number(value))
        : (currentSystem[field] == null ? null : Number(currentSystem[field]));
    const resolvedLoop1FlowPct = resolvedPercentage('loop1_flow_pct', loop1_flow_pct);
    const resolvedLoop1BioPct = resolvedPercentage('loop1_bio_degas_pct', loop1_bio_degas_pct);
    const resolvedLoop2FlowPct = resolvedPercentage('loop2_flow_pct', loop2_flow_pct);
    const resolvedLoop2BioPct = resolvedPercentage('loop2_bio_degas_pct', loop2_bio_degas_pct);
    const resolvedLoop3FlowPct = resolvedPercentage('loop3_flow_pct', loop3_flow_pct);
    const resolvedLoop3BioPct = resolvedPercentage('loop3_bio_degas_pct', loop3_bio_degas_pct);
    const resolvedLoopMode = (loopNumber: number, value: any) => {
      const field = `loop${loopNumber}_flow_mode`;
      const requestedMode = Object.prototype.hasOwnProperty.call(req.body, field)
        ? (value == null || value === '' ? 'allocated' : String(value))
        : (currentSystem[field] || 'allocated');
      const sourceIsCirculation = circulationSources.has(resolvedFlowSources[loopNumber - 1]);
      const mode = requestedMode;
      if (mode !== 'allocated' && mode !== 'matched') {
        throw new Error(`Loop ${loopNumber} flow mode must be allocated or matched.`);
      }
      if (mode === 'matched' && !sourceIsCirculation) {
        throw new Error(`Loop ${loopNumber} can only match another loop when its Flow Source is Break Tank or Plenum Tank.`);
      }
      return mode;
    };
    let resolvedLoop1FlowMode: string, resolvedLoop2FlowMode: string, resolvedLoop3FlowMode: string;
    try {
      resolvedLoop1FlowMode = resolvedLoopMode(1, loop1_flow_mode);
      resolvedLoop2FlowMode = resolvedLoopMode(2, loop2_flow_mode);
      resolvedLoop3FlowMode = resolvedLoopMode(3, loop3_flow_mode);
    } catch (error: any) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
    }
    const resolvedLoopModes = [resolvedLoop1FlowMode, resolvedLoop2FlowMode, resolvedLoop3FlowMode];
    let resolvedMatchTargets: Array<number | null> = [];
    try {
      resolvedMatchTargets = [loop1_match_loop_number, loop2_match_loop_number, loop3_match_loop_number]
        .map((value, index) => {
        const loopNumber = index + 1;
        const field = `loop${loopNumber}_match_loop_number`;
        const raw = Object.prototype.hasOwnProperty.call(req.body, field) ? value : currentSystem[field];
        if (resolvedLoopModes[index] !== 'matched') return null;
        const target = Number(raw);
        if (!Number.isInteger(target) || target < 1 || target > 3 || target === loopNumber) {
          throw new Error(`Loop ${loopNumber} must match a different configured loop (1–3).`);
        }
        return target;
        });
      const targetFor = (loop: number) => resolvedLoopModes[loop - 1] === 'matched'
        ? resolvedMatchTargets[loop - 1] : null;
      for (let loop = 1; loop <= 3; loop++) {
        const seen = new Set<number>();
        let cursor: number | null = loop;
        while (cursor != null && targetFor(cursor) != null) {
          if (seen.has(cursor)) throw new Error(`Loop ${loop} match target creates a circular flow match.`);
          seen.add(cursor);
          cursor = targetFor(cursor);
        }
      }
    } catch (error: any) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
    }
    const intendedSystem = {
      ...currentSystem,
      design_flow_m3h: Object.prototype.hasOwnProperty.call(req.body, 'design_flow_m3h')
        ? (design_flow_m3h === '' || design_flow_m3h == null ? null : Number(design_flow_m3h))
        : currentSystem.design_flow_m3h,
      loop1_flow_source: resolvedFlowSources[0],
      loop2_flow_source: resolvedFlowSources[1],
      loop3_flow_source: resolvedFlowSources[2],
      loop1_filtration: Object.prototype.hasOwnProperty.call(req.body, 'loop1_filtration') ? loop1_filtration : currentSystem.loop1_filtration,
      loop2_filtration: Object.prototype.hasOwnProperty.call(req.body, 'loop2_filtration') ? loop2_filtration : currentSystem.loop2_filtration,
      loop3_filtration: Object.prototype.hasOwnProperty.call(req.body, 'loop3_filtration') ? loop3_filtration : currentSystem.loop3_filtration,
      loop1_flow_pct: resolvedLoop1FlowPct,
      loop2_flow_pct: resolvedLoop2FlowPct,
      loop3_flow_pct: resolvedLoop3FlowPct,
      loop1_flow_mode: resolvedLoop1FlowMode,
      loop2_flow_mode: resolvedLoop2FlowMode,
      loop3_flow_mode: resolvedLoop3FlowMode,
      loop1_match_loop_number: resolvedMatchTargets[0],
      loop2_match_loop_number: resolvedMatchTargets[1],
      loop3_match_loop_number: resolvedMatchTargets[2],
    };
    const foamFractionationLoops = [1, 2, 3].filter(
      loopNumber => intendedSystem[`loop${loopNumber}_filtration`] === 'Foam Fractionation',
    );
    if (foamFractionationLoops.length > 1) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'Only one Flow Route loop may use Foam Fractionation.' },
      });
    }
    for (const [index, target] of resolvedMatchTargets.entries()) {
      if (target != null && !intendedSystem[`loop${target}_flow_source`] &&
          !intendedSystem[`loop${target}_filtration`]) {
        return res.status(400).json({
          error: { code: 'VALIDATION', message: `Loop ${index + 1} must match a configured Loop ${target}.` },
        });
      }
    }
    for (let loopNumber = 1; loopNumber <= 3; loopNumber++) {
      if (resolvedLoopModes[loopNumber - 1] === 'matched' &&
          !['Break Tank', 'Plenum Tank'].includes(String(intendedSystem[`loop${loopNumber}_flow_source`] || ''))) {
        return res.status(400).json({
          error: { code: 'VALIDATION', message: `Loop ${loopNumber} matched flow requires Break Tank or Plenum Tank as its flow source.` },
        });
      }
    }
    let normalizedFractionators: Awaited<ReturnType<typeof normalizeFractionatorAllocations>> = null;
    let normalizedSandFilters: Awaited<ReturnType<typeof normalizeSandFilterAllocations>> = null;
    try {
      normalizedFractionators = await normalizeFractionatorAllocations(
        fractionator_allocations, intendedSystem);
      const existingSandFilterAllocations = sand_filter_allocations
        ? await loadSystemSandFilterAllocations(String(req.params.id))
        : [];
      const existingSandFilterSnapshots = new Map<string, any>();
      for (const allocation of existingSandFilterAllocations) {
        for (const product of allocation.products || []) {
          existingSandFilterSnapshots.set(
            `${Number(allocation.parent_loop_number)}:${String(product.product_master_id)}`,
            product,
          );
        }
      }
      normalizedSandFilters = await normalizeSandFilterAllocations(
        sand_filter_allocations, intendedSystem, query, existingSandFilterSnapshots);
    } catch (error: any) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
    }
    const intendedWaterType = water_type || currentResult.rows[0].water_type;
    const foamLoops = [1, 2, 3].filter(
      loopNumber => intendedSystem[`loop${loopNumber}_filtration`] === 'Foam Fractionation');
    if (foamLoops.length && !['Marine', 'Salt Water'].includes(String(intendedWaterType))) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION',
          message: `Foam Fractionation is only available for Marine or Salt Water systems (Loop${foamLoops.length > 1 ? 's' : ''} ${foamLoops.join(', ')}).`,
        },
      });
    }
    const linkedWaterTypes = await query(
      `SELECT e.exhibit_code, e.water_type
       FROM system_exhibit_links sel
       JOIN exhibits e ON e.id=sel.exhibit_id
       WHERE sel.system_id=$1`,
      [req.params.id],
    );
    const incompatibleLink = linkedWaterTypes.rows.find((link: any) =>
      !compatibleWaterTypes(intendedWaterType, link.water_type));
    if (incompatibleLink) {
      return res.status(409).json({
        error: {
          code: 'INCOMPATIBLE_WATER_TYPE',
          message: `${incompatibleLink.exhibit_code} uses ${incompatibleLink.water_type} water and is incompatible with a ${intendedWaterType} system.`,
        },
      });
    }
    if (hasSystemConfig && resolvedSystemConfig === 'compact') {
      if (!resolvedCompactUnitId) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Select a compact unit before saving compact configuration.' } });
      }
      if (!design_book_id) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'A Design Book calculation context is required for compact-unit validation.' } });
      }
      const designBookResult = await query(
        'SELECT id FROM design_books WHERE id=$1 AND project_id=$2',
        [design_book_id, currentResult.rows[0].project_id],
      );
      if (!designBookResult.rows[0]) {
        return res.status(409).json({
          error: { code: 'DESIGN_BOOK_CONTEXT_MISMATCH', message: 'The Design Book must belong to the same project as the system.' },
        });
      }
      const unitResult = await query('SELECT * FROM lss_compact_units WHERE id=$1', [resolvedCompactUnitId]);
      const unit = unitResult.rows[0];
      if (!unit) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Compact unit not found.' } });
      if (unit.status !== 'Active') {
        return res.status(409).json({ error: { code: 'INCOMPATIBLE_COMPACT_UNIT', message: `Compact unit is ${unit.status.toLowerCase()} and cannot be selected.` } });
      }
      if (!compatibleWaterTypes(intendedWaterType, unit.water_type)) {
        return res.status(409).json({
          error: { code: 'INCOMPATIBLE_WATER_TYPE', message: `${unit.unit_code} is rated for ${unit.water_type}, not ${intendedWaterType}.` },
        });
      }
      const intendedFlow = Number(design_flow_m3h);
      if (Number.isFinite(intendedFlow) && unit.max_flow_m3h != null &&
          intendedFlow > Number(unit.max_flow_m3h)) {
        return res.status(409).json({
          error: { code: 'INCOMPATIBLE_COMPACT_UNIT', message: `Design flow exceeds ${unit.unit_code}'s ${unit.max_flow_m3h} m³/h catalog limit.` },
        });
      }
        const linkedExhibitsResult = await query(
          `SELECT e.*
           FROM system_exhibit_links sel
           JOIN exhibits e ON e.id=sel.exhibit_id
           WHERE sel.system_id=$1`,
          [req.params.id],
        );
        const linkedExhibits = linkedExhibitsResult.rows;
        const exhibitIds = linkedExhibits.map((item: any) => item.id);
        if (exhibitIds.length > 0) {
          const [tankResult, hydraulicResult, substrateResult] = await Promise.all([
            query('SELECT * FROM tanks WHERE exhibit_id = ANY($1::uuid[])', [exhibitIds]),
            query(
              'SELECT * FROM design_book_exhibit_hydraulics WHERE design_book_id=$1 AND exhibit_id = ANY($2::uuid[])',
              [design_book_id, exhibitIds],
            ),
            query(
              'SELECT * FROM design_book_exhibit_substrate WHERE design_book_id=$1 AND exhibit_id = ANY($2::uuid[])',
              [design_book_id, exhibitIds],
            ),
          ]);
          const calculations = linkedExhibits.map((linkedExhibit: any) =>
            calculateExhibitHydraulics(
              linkedExhibit,
              tankResult.rows.filter((item: any) => item.exhibit_id === linkedExhibit.id),
              hydraulicResult.rows.find((item: any) => item.exhibit_id === linkedExhibit.id),
              substrateResult.rows.find((item: any) => item.exhibit_id === linkedExhibit.id),
            ));
          const invalidCalculation = calculations.find((item: any) => item.status === 'invalid');
          if (invalidCalculation) {
            return res.status(409).json({
              error: { code: 'INVALID_ENGINEERING_INPUTS', message: invalidCalculation.reasons.join(' ') },
            });
          }
          const effectiveVolume = calculations.reduce(
            (sum: number, item: any) => sum + (item.results.operating_volume_m3 || 0), 0);
          const calculatedFlow = calculations.reduce(
            (sum: number, item: any) => sum + (item.results.total_return_flow_m3h || 0), 0);
          const suitability = evaluateCompactUnit(
            unit,
            intendedWaterType,
            effectiveVolume,
            Number.isFinite(intendedFlow) && intendedFlow > 0 ? intendedFlow : calculatedFlow,
          );
          if (!suitability.suitable) {
            return res.status(409).json({
              error: { code: 'INCOMPATIBLE_COMPACT_UNIT', message: suitability.reasons.join(' ') },
            });
          }
        }
    }
    const saveClient = await pool.connect();
    let result: { rows: any[] };
    let namedSystem: any;
    let existingSideStreams: any[] = [];
    let savedSideStreams: any[] = [];
    let savedFractionators: any[] = [];
    let savedSandFilters: any[] = [];
    try {
      await saveClient.query('BEGIN');
      result = await saveClient.query(
      `UPDATE systems SET
        system_code=COALESCE($1,system_code), system_name=$2, system_type=$3,
        design_flow_m3h=$4, turnover_rate_hr=$5, water_type=$6, status=$7,
        duty_description=$8, redundancy_strategy=$9,
        loop1_flow_source=$10, loop1_filtration=$11, loop1_flow_pct=$12, loop1_bio_degas_pct=$13,
        loop1_bio_degas_m3h=$14, loop1_link_bio_degas=$15,
        loop2_flow_source=$16, loop2_filtration=$17, loop2_flow_pct=$18, loop2_bio_degas_pct=$19,
        loop2_bio_degas_m3h=$20, loop2_link_bio_degas=$21,
        loop3_flow_source=$22, loop3_filtration=$23, loop3_flow_pct=$24, loop3_bio_degas_pct=$25,
        loop3_bio_degas_m3h=$26, loop3_link_bio_degas=$27,
        system_config=$28, compact_unit_id=$29,
        calculation_version=$30, last_calculated_at=NOW(), calculation_inputs=$31,
        updated_at=NOW()
       WHERE id=$32
         AND status NOT IN ('Archived','Decommissioned','Superseded')
       RETURNING *`,
      [
        system_code || null, system_name, system_type,
        resolvedDesignFlowSource === 'manual_override' ? design_flow_m3h || null : null,
        resolvedTurnoverSource === 'manual_override' ? turnover_rate_hr || null : null,
        water_type, status,
        duty_description, redundancy_strategy,
        loop1_flow_source || null, loop1_filtration || null,
        resolvedLoop1FlowPct, resolvedLoop1BioPct,
        loop1_bio_degas_m3h ?? null, loop1_link_bio_degas ?? false,
        loop2_flow_source || null, loop2_filtration || null,
        resolvedLoop2FlowPct, resolvedLoop2BioPct,
        loop2_bio_degas_m3h ?? null, loop2_link_bio_degas ?? false,
        loop3_flow_source || null, loop3_filtration || null,
        resolvedLoop3FlowPct, resolvedLoop3BioPct,
        loop3_bio_degas_m3h ?? null, loop3_link_bio_degas ?? false,
        resolvedSystemConfig, resolvedCompactUnitId,
        AQUARIUM_CALCULATION_VERSION,
        JSON.stringify({
          design_flow_m3h: design_flow_m3h ?? null,
          turnover_rate_hr: turnover_rate_hr ?? null,
          design_flow_source: resolvedDesignFlowSource,
          turnover_source: resolvedTurnoverSource,
          turnover_unit: 'cycles_per_hour',
          flow_unit: 'm3_per_hour',
          system_config: resolvedSystemConfig,
          compact_unit_id: resolvedCompactUnitId,
        }),
        req.params.id,
      ]);
      if (!result.rows[0]) {
        await saveClient.query('ROLLBACK');
        return res.status(409).json({ error: { code: 'SYSTEM_RETIRED', message: 'The LSS was retired while this edit was being saved. Refresh to view its historical record.' } });
      }
      namedSystem = result.rows[0];
       // Kept as a separate update so legacy SQL parameter positions remain
       // stable for integrations while persisting the new route semantics.
       const modeResult = await saveClient.query(
         `UPDATE systems SET
            loop1_flow_mode=$2, loop1_match_loop_number=$3,
            loop2_flow_mode=$4, loop2_match_loop_number=$5,
            loop3_flow_mode=$6, loop3_match_loop_number=$7
          WHERE id=$1 RETURNING *`,
         [req.params.id, resolvedLoop1FlowMode, resolvedMatchTargets[0],
           resolvedLoop2FlowMode, resolvedMatchTargets[1],
           resolvedLoop3FlowMode, resolvedMatchTargets[2]],
       );
       namedSystem = modeResult.rows[0] || namedSystem;
      const sideStreamQuery = saveClient.query.bind(saveClient);
      existingSideStreams = await loadSystemSideStreams(String(req.params.id), sideStreamQuery);
      const namedResult = await saveClient.query(
        `UPDATE systems SET
           loop1_name=$2, loop2_name=$3, loop3_name=$4, updated_at=NOW()
         WHERE id=$1
           AND status NOT IN ('Archived','Decommissioned','Superseded')
         RETURNING *`,
        [
          req.params.id,
          loop1_name == null ? (currentSystem.loop1_name || 'Loop 1') : String(loop1_name).trim(),
          loop2_name == null ? (currentSystem.loop2_name || 'Loop 2') : String(loop2_name).trim(),
          loop3_name == null ? (currentSystem.loop3_name || 'Loop 3') : String(loop3_name).trim(),
        ],
      );
      namedSystem = namedResult.rows[0] || namedSystem;
      if (normalizedSideStreams) {
        // Validate any UV revision assignments are Approved and from an eligible catalog.
        const uvRevisionIds = normalizedSideStreams
          .map(s => s.uv_revision_id)
          .filter(Boolean) as string[];
        if (uvRevisionIds.length > 0) {
          const eligibleCheck = await saveClient.query(
            `SELECT r.id FROM uv_engineering_revisions r
              JOIN uv_engineering_catalogs c ON c.id=r.catalog_id
              JOIN product_masters pm ON pm.id=c.product_master_id
              JOIN product_families pf ON pf.id=pm.product_family_id
             WHERE r.id = ANY($1::uuid[]) AND r.status='Approved'
               AND c.needs_review=false AND pm.status='Active'
               AND pf.product_family_code='PFM-UV'`,
            [uvRevisionIds],
          );
          const eligibleIds = new Set(eligibleCheck.rows.map((r: any) => r.id));
          const ineligible = uvRevisionIds.filter(id => !eligibleIds.has(id));
          if (ineligible.length > 0) {
            await saveClient.query('ROLLBACK');
            return res.status(400).json({
              error: {
                code: 'INELIGIBLE_UV_REVISION',
                message: 'One or more UV revisions are not Approved or eligible for assignment.',
              },
            });
          }
        }
        const existing = existingSideStreams;
        const existingIds = new Set(existing.map((stream: any) => String(stream.id)));
        const requestedIds = new Set(
          normalizedSideStreams.filter(stream => stream.id && existingIds.has(stream.id)).map(stream => stream.id as string),
        );
        for (const stream of existing) {
          if (!requestedIds.has(String(stream.id))) {
            await saveClient.query('DELETE FROM system_flow_side_streams WHERE id=$1 AND system_id=$2', [stream.id, req.params.id]);
          }
        }
        for (const stream of normalizedSideStreams) {
          if (stream.id && existingIds.has(stream.id)) {
            await saveClient.query(
              `UPDATE system_flow_side_streams
               SET parent_loop_number=$3, name=$4, preset=$5, flow_pct=$6, notes=$7,
                   sort_order=$8, uv_revision_id=$9, uv_unit_quantity=$10,
                   has_dedicated_pump=COALESCE($11,has_dedicated_pump), uvt_basis=$12, updated_at=NOW()
               WHERE id=$1 AND system_id=$2`,
              [stream.id, req.params.id, stream.parent_loop_number, stream.name, stream.preset,
                stream.flow_pct, stream.notes, stream.sort_order,
                stream.uv_revision_id ?? null, stream.uv_unit_quantity ?? null,
                stream.has_dedicated_pump, stream.uvt_basis],
            );
          } else {
            await saveClient.query(
              `INSERT INTO system_flow_side_streams
                 (system_id, parent_loop_number, name, preset, flow_pct, notes, sort_order,
                  uv_revision_id, uv_unit_quantity, has_dedicated_pump, uvt_basis)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
              [req.params.id, stream.parent_loop_number, stream.name, stream.preset,
                stream.flow_pct, stream.notes, stream.sort_order,
                stream.uv_revision_id ?? null, stream.uv_unit_quantity ?? null,
                stream.has_dedicated_pump ?? false, stream.uvt_basis],
            );
          }
        }
      }
      savedSideStreams = await loadSystemSideStreams(String(req.params.id), sideStreamQuery);
      if (normalizedFractionators) {
        await saveClient.query(
          'DELETE FROM system_flow_fractionator_allocations WHERE system_id=$1',
          [req.params.id],
        );
        for (const allocation of normalizedFractionators) {
          await saveClient.query(
            `INSERT INTO system_flow_fractionator_allocations
               (system_id, parent_loop_number, process_rate_ls_m2, notes, products, calculation_status)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
            [req.params.id, allocation.parent_loop_number, allocation.process_rate_ls_m2,
              allocation.notes, JSON.stringify(allocation.products), allocation.calculation_status],
          );
        }
      }
      if (normalizedSandFilters) {
        await saveClient.query(
          'DELETE FROM system_flow_sand_filter_allocations WHERE system_id=$1',
          [req.params.id],
        );
        for (const allocation of normalizedSandFilters) {
          await saveClient.query(
            `INSERT INTO system_flow_sand_filter_allocations
               (system_id, parent_loop_number, process_rate_ls_m2, notes, products, calculation_status)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
            [req.params.id, allocation.parent_loop_number, allocation.process_rate_ls_m2,
              allocation.notes, JSON.stringify(allocation.products), allocation.calculation_status],
          );
        }
      }
      savedFractionators = await loadSystemFractionatorAllocations(String(req.params.id), sideStreamQuery);
      savedSandFilters = await loadSystemSandFilterAllocations(String(req.params.id), sideStreamQuery);
      await saveClient.query('COMMIT');
    } catch (error) {
      await saveClient.query('ROLLBACK');
      throw error;
    } finally {
      saveClient.release();
    }
    const auditShape = (stream: any) => ({
      id: stream.id,
      parent_loop_number: Number(stream.parent_loop_number),
      name: stream.name,
      preset: stream.preset || null,
      flow_pct: Number(stream.flow_pct),
      has_dedicated_pump: stream.has_dedicated_pump !== false,
      notes: stream.notes || null,
      sort_order: Number(stream.sort_order || 0),
    });
    const existingById = new Map(existingSideStreams.map(stream => [String(stream.id), auditShape(stream)]));
    const savedById = new Map(savedSideStreams.map(stream => [String(stream.id), auditShape(stream)]));
    const sideStreamChanges = {
      added: savedSideStreams.filter(stream => !existingById.has(String(stream.id))).map(auditShape),
      updated: savedSideStreams
        .filter(stream => existingById.has(String(stream.id)) &&
          JSON.stringify(existingById.get(String(stream.id))) !== JSON.stringify(auditShape(stream)))
        .map(stream => ({ before: existingById.get(String(stream.id)), after: auditShape(stream) })),
      removed: existingSideStreams.filter(stream => !savedById.has(String(stream.id))).map(auditShape),
    };
    await logAudit(req.user!.id, 'system', String(req.params.id), 'UPDATE', {
      summary: normalizedSideStreams ? 'System details and flow-route hierarchy updated' : 'System details updated',
      system_name,
      system_type,
      status,
      design_flow_m3h,
      water_type,
      loop_names: [
        namedSystem.loop1_name || currentSystem.loop1_name || 'Loop 1',
        namedSystem.loop2_name || currentSystem.loop2_name || 'Loop 2',
        namedSystem.loop3_name || currentSystem.loop3_name || 'Loop 3',
      ],
       loop_flow_modes: [1, 2, 3].map(loopNumber => ({
         loop_number: loopNumber,
         flow_mode: namedSystem[`loop${loopNumber}_flow_mode`] || 'allocated',
         match_loop_number: namedSystem[`loop${loopNumber}_match_loop_number`] || null,
       })),
      side_stream_count: savedSideStreams.length,
      fractionator_allocation_count: savedFractionators.length,
      sand_filter_allocation_count: savedSandFilters.length,
      side_stream_changes: sideStreamChanges,
    });
    res.json({
      ...namedSystem,
      side_streams: savedSideStreams,
      fractionator_allocations: savedFractionators,
      sand_filter_allocations: savedSandFilters,
    });
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'A system with that code already exists in this project.' } });
    }
    throw err;
  }
});

// Reset contract: only LSS-owned inputs are cleared. Project tanks, exhibits,
// Design Book exhibit hydraulics/substrate, and reusable PIM records are never
// deleted or updated by this transaction.
router.post(
  '/systems/:id/configuration-reset',
  authenticate,
  requireRole('admin', 'engineer'),
  requireModuleManage('projects'),
  async (req: AuthRequest, res: Response) => {
  const designBookId = req.body?.design_book_id;
  if (!designBookId) {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'design_book_id is required.' },
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const systemResult = await client.query(
      'SELECT * FROM systems WHERE id=$1 FOR UPDATE',
      [req.params.id],
    );
    const lockedSystem = systemResult.rows[0];
    if (!lockedSystem) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'System not found.' },
      });
    }
    const designBookResult = await client.query(
      `SELECT id, status FROM design_books
       WHERE id=$1 AND project_id=$2
       FOR UPDATE`,
      [designBookId, lockedSystem.project_id],
    );
    const lockedDesignBook = designBookResult.rows[0];
    if (!lockedDesignBook) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: {
          code: 'DESIGN_BOOK_CONTEXT_MISMATCH',
          message: 'The Design Book must belong to the same project as the system.',
        },
      });
    }
    if (!['Draft', 'In Progress'].includes(lockedDesignBook.status)
        || ['For Review', 'Approved', 'Released'].includes(lockedSystem.status)
        || isRetiredSystem(lockedSystem)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: {
          code: 'DESIGN_BOOK_NOT_EDITABLE',
          message: 'Reviewed, approved, or released systems cannot be reconfigured.',
        },
      });
    }

    await client.query('DELETE FROM system_exhibit_links WHERE system_id=$1', [req.params.id]);
    await client.query('DELETE FROM system_flow_side_streams WHERE system_id=$1', [req.params.id]);
    await client.query('DELETE FROM system_flow_fractionator_allocations WHERE system_id=$1', [req.params.id]);
    await client.query('DELETE FROM system_flow_sand_filter_allocations WHERE system_id=$1', [req.params.id]);
    await client.query('DELETE FROM project_equipment_items WHERE system_id=$1', [req.params.id]);
    const resetResult = await client.query(
      `UPDATE systems SET
         exhibit_id=NULL,
         system_type=NULL,
         water_type=NULL,
         design_flow_m3h=NULL,
         turnover_rate_hr=NULL,
         duty_description=NULL,
         redundancy_strategy=NULL,
         design_basis_reference=NULL,
         system_config=NULL,
         compact_unit_id=NULL,
         calculation_version=NULL,
         last_calculated_at=NULL,
         calculation_inputs=NULL,
         loop1_name='Loop 1', loop1_flow_source=NULL, loop1_filtration=NULL,
         loop1_flow_pct=NULL, loop1_bio_degas_pct=NULL, loop1_bio_degas_m3h=NULL,
          loop1_link_bio_degas=false, loop1_flow_mode='allocated', loop1_match_loop_number=NULL,
         loop2_name='Loop 2', loop2_flow_source=NULL, loop2_filtration=NULL,
         loop2_flow_pct=NULL, loop2_bio_degas_pct=NULL, loop2_bio_degas_m3h=NULL,
          loop2_link_bio_degas=false, loop2_flow_mode='allocated', loop2_match_loop_number=NULL,
         loop3_name='Loop 3', loop3_flow_source=NULL, loop3_filtration=NULL,
         loop3_flow_pct=NULL, loop3_bio_degas_pct=NULL, loop3_bio_degas_m3h=NULL,
          loop3_link_bio_degas=false, loop3_flow_mode='allocated', loop3_match_loop_number=NULL,
         updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [req.params.id],
    );
    await client.query(
      `INSERT INTO audit_logs
         (entity_type, entity_id, action, actor_id, details, ip_address)
       VALUES ('system',$1,'RESET_CONFIGURATION',$2,$3,$4)`,
      [
        req.params.id,
        req.user!.id,
        {
          summary: `LSS configuration reset for ${lockedSystem.system_code}`,
          design_book_id: designBookId,
          preserved: ['project tanks', 'exhibits', 'tank hydraulics', 'PIM source data'],
        },
        req.ip || null,
      ],
    );
    await client.query('COMMIT');
    res.json({
      reset: true,
      system: {
        ...withoutStaleLinkedSystemFlow(resetResult.rows[0]),
        equipment: [],
        side_streams: [],
        fractionator_allocations: [],
        sand_filter_allocations: [],
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.get('/systems/:id/side-streams', authenticate, async (req: AuthRequest, res: Response) => {
  const system = await query('SELECT id FROM systems WHERE id=$1', [req.params.id]);
  if (!system.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
  res.json({ items: await loadSystemSideStreams(String(req.params.id)), presets: FLOW_SIDE_STREAM_PRESETS });
});

router.post('/systems/:id/side-streams', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  let stream;
  try {
    stream = normalizeSideStreams([req.body])?.[0];
  } catch (error: any) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
  }
  const client = await pool.connect();
  let created: any;
  try {
    await client.query('BEGIN');
    const system = await client.query('SELECT * FROM systems WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!system.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    }
    if (isRetiredSystem(system.rows[0])) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: systemLifecycleError(system.rows[0]) });
    }
    created = (await client.query(
      `INSERT INTO system_flow_side_streams
         (system_id, parent_loop_number, name, preset, flow_pct, notes, sort_order,
          has_dedicated_pump)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, stream!.parent_loop_number, stream!.name, stream!.preset,
        stream!.flow_pct, stream!.notes, stream!.sort_order,
        stream!.has_dedicated_pump ?? false],
    )).rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await logAudit(req.user!.id, 'system', String(req.params.id), 'ADD_SIDE_STREAM', {
    summary: `${stream!.name} side stream added to Loop ${stream!.parent_loop_number}`,
    side_stream: created,
  });
  res.status(201).json(created);
});

router.put('/systems/:id/side-streams/:sideStreamId', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  let stream;
  try {
    stream = normalizeSideStreams([req.body])?.[0];
  } catch (error: any) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
  }
  const client = await pool.connect();
  let previous: any;
  let updated: any;
  try {
    await client.query('BEGIN');
    const system = await client.query('SELECT * FROM systems WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!system.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    }
    if (isRetiredSystem(system.rows[0])) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: systemLifecycleError(system.rows[0]) });
    }
    const current = await client.query(
      'SELECT * FROM system_flow_side_streams WHERE id=$1 AND system_id=$2',
      [req.params.sideStreamId, req.params.id],
    );
    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Side stream not found' } });
    }
    previous = current.rows[0];
    // Validate UV revision is approved and from an eligible catalog if provided.
    if (stream!.uv_revision_id) {
      const revCheck = await client.query(
        `SELECT r.id FROM uv_engineering_revisions r
         JOIN uv_engineering_catalogs c ON c.id=r.catalog_id
         JOIN product_masters pm ON pm.id=c.product_master_id
         JOIN product_families pf ON pf.id=pm.product_family_id
         WHERE r.id=$1 AND r.status='Approved' AND c.needs_review=false
           AND pm.status='Active' AND pf.product_family_code='PFM-UV'`,
        [stream!.uv_revision_id],
      );
      if (!revCheck.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: {
            code: 'INVALID_UV_REVISION',
            message: 'The UV revision must be Approved and from an active, eligible PFM-UV product.',
          },
        });
      }
    }
    updated = (await client.query(
      `UPDATE system_flow_side_streams
       SET parent_loop_number=$3, name=$4, preset=$5, flow_pct=$6, notes=$7,
           sort_order=$8, uv_revision_id=$9, uv_unit_quantity=$10,
           has_dedicated_pump=COALESCE($11,has_dedicated_pump), uvt_basis=$12, updated_at=NOW()
       WHERE id=$1 AND system_id=$2 RETURNING *`,
      [req.params.sideStreamId, req.params.id, stream!.parent_loop_number, stream!.name,
        stream!.preset, stream!.flow_pct, stream!.notes, stream!.sort_order,
        stream!.uv_revision_id ?? null, stream!.uv_unit_quantity ?? null,
        stream!.has_dedicated_pump, stream!.uvt_basis],
    )).rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await logAudit(req.user!.id, 'system', String(req.params.id), 'UPDATE_SIDE_STREAM', {
    summary: `${stream!.name} side stream updated`,
    before: previous,
    after: updated,
  });
  res.json(updated);
});

router.delete('/systems/:id/side-streams/:sideStreamId', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  const editable = await loadEditableSystem(query, String(req.params.id));
  if (!editable.system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
  if (editable.error) return res.status(409).json({ error: editable.error });
  const result = await query(
    'DELETE FROM system_flow_side_streams WHERE id=$1 AND system_id=$2 RETURNING *',
    [req.params.sideStreamId, req.params.id],
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Side stream not found' } });
  await logAudit(req.user!.id, 'system', String(req.params.id), 'DELETE_SIDE_STREAM', {
    summary: `${result.rows[0].name} side stream removed`,
    side_stream_id: req.params.sideStreamId,
  });
  res.json({ deleted: true, id: req.params.sideStreamId });
});

router.delete('/systems/:id', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (_req: AuthRequest, res: Response) => {
  res.status(409).json({
    error: {
      code: 'PHYSICAL_DELETE_DISABLED',
      message: 'Life Support Systems are governed records. Archive/decommission or supersede the system instead.',
    },
  });
});

router.post(
  '/systems/:id/archive',
  authenticate,
  requireRole('admin', 'engineer'),
  requireModuleManage('projects'),
  async (req: AuthRequest, res: Response) => {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
      return res.status(400).json({ error: { code: 'REASON_REQUIRED', message: 'A reason is required to archive/decommission an LSS.' } });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM systems WHERE id=$1 FOR UPDATE', [req.params.id]);
      const system = current.rows[0];
      if (!system) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
      }
      if (!isLifeSupportSystem(system)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: { code: 'INVALID_SYSTEM_TYPE', message: 'Only a Life Support System can use the LSS lifecycle workflow.' } });
      }
      if (['Archived', 'Decommissioned'].includes(system.status)) {
        await client.query('COMMIT');
        return res.json(system);
      }
      if (system.status === 'Superseded') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: { code: 'INVALID_LIFECYCLE_TRANSITION', message: 'A superseded LSS cannot be archived without a governed restore workflow.' } });
      }
      const updated = await client.query(
        `UPDATE systems
         SET status='Decommissioned', lifecycle_reason=$2,
             lifecycle_changed_at=NOW(), lifecycle_changed_by=$3, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [req.params.id, reason, req.user!.id],
      );
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details, ip_address)
         VALUES ('system',$1,'ARCHIVE',$2,$3,$4)`,
        [req.params.id, req.user!.id, {
          summary: `LSS ${system.system_code} archived/decommissioned`,
          reason,
          previous_status: system.status,
          new_status: 'Decommissioned',
          replacement_system_id: null,
        }, req.ip || null],
      );
      await client.query('COMMIT');
      res.json(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
);

router.post(
  '/systems/:id/supersede',
  authenticate,
  requireRole('admin', 'engineer'),
  requireModuleManage('projects'),
  async (req: AuthRequest, res: Response) => {
    const reason = String(req.body?.reason || '').trim();
    const replacementSystemId = String(req.body?.replacement_system_id || '').trim();
    if (!reason) {
      return res.status(400).json({ error: { code: 'REASON_REQUIRED', message: 'A reason is required to supersede an LSS.' } });
    }
    if (!replacementSystemId) {
      return res.status(400).json({ error: { code: 'REPLACEMENT_REQUIRED', message: 'Select the replacement LSS.' } });
    }
    if (replacementSystemId === String(req.params.id)) {
      return res.status(400).json({ error: { code: 'INVALID_REPLACEMENT', message: 'An LSS cannot supersede itself.' } });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        'SELECT * FROM systems WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [[req.params.id, replacementSystemId]],
      );
      const system = locked.rows.find((row: any) => String(row.id) === String(req.params.id));
      const replacement = locked.rows.find((row: any) => String(row.id) === replacementSystemId);
      if (!system || !replacement) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: !system ? 'System not found' : 'Replacement LSS not found' } });
      }
      if (!isLifeSupportSystem(system)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: { code: 'INVALID_SYSTEM_TYPE', message: 'Only a Life Support System can use the LSS lifecycle workflow.' } });
      }
      if (system.status === 'Superseded' && String(system.superseded_by_system_id) === replacementSystemId) {
        await client.query('COMMIT');
        return res.json(system);
      }
      if (isRetiredSystem(system)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: { code: 'INVALID_LIFECYCLE_TRANSITION', message: 'A retired LSS cannot be superseded without a governed restore workflow.' } });
      }
      if (String(system.project_id) !== String(replacement.project_id)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: { code: 'REPLACEMENT_PROJECT_MISMATCH', message: 'The replacement LSS must belong to the same project.' } });
      }
      if (isRetiredSystem(replacement)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: { code: 'INVALID_REPLACEMENT', message: 'The replacement LSS must be active and current.' } });
      }
      if (!isLifeSupportSystem(replacement)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: { code: 'INVALID_REPLACEMENT_TYPE', message: 'The replacement must be a Life Support System.' } });
      }
      if (replacement.supersedes_system_id && String(replacement.supersedes_system_id) !== String(system.id)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: { code: 'REPLACEMENT_IN_USE', message: 'The replacement LSS already supersedes another system.' } });
      }
      const updated = await client.query(
        `UPDATE systems
         SET status='Superseded', superseded_by_system_id=$2,
             lifecycle_reason=$3, lifecycle_changed_at=NOW(),
             lifecycle_changed_by=$4, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [req.params.id, replacementSystemId, reason, req.user!.id],
      );
      await client.query(
        `UPDATE systems SET supersedes_system_id=$1, updated_at=NOW()
         WHERE id=$2`,
        [req.params.id, replacementSystemId],
      );
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details, ip_address)
         VALUES ('system',$1,'SUPERSEDE',$2,$3,$4)`,
        [req.params.id, req.user!.id, {
          summary: `LSS ${system.system_code} superseded by ${replacement.system_code}`,
          reason,
          previous_status: system.status,
          new_status: 'Superseded',
          replacement_system_id: replacementSystemId,
        }, req.ip || null],
      );
      await client.query('COMMIT');
      res.json({
        ...updated.rows[0],
        replacement_system_code: replacement.system_code,
        replacement_system_name: replacement.system_name,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
);

router.post('/systems/:id/duplicate', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  const src = await query('SELECT * FROM systems WHERE id=$1', [req.params.id]);
  if (!src.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
  const s = src.rows[0];
  if (isRetiredSystem(s)) {
    return res.status(409).json({ error: { code: 'SYSTEM_RETIRED', message: 'Retired LSS records cannot be duplicated as current systems.' } });
  }
  const newCode = `${s.system_code}-COPY`;
  const result = await query(
    `INSERT INTO systems (system_code, project_id, area_id, exhibit_id, system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type, duty_description, redundancy_strategy)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [newCode, s.project_id, s.area_id, s.exhibit_id, `${s.system_name} (Copy)`, s.system_type, s.design_flow_m3h, s.turnover_rate_hr, s.water_type, s.duty_description, s.redundancy_strategy]);
  res.status(201).json(result.rows[0]);
});

// SYSTEM ↔ EXHIBIT LINKS
router.get('/systems/:id/exhibit-links', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT sel.*, e.exhibit_code, e.exhibit_name, e.water_type as exhibit_water_type
     FROM system_exhibit_links sel
     JOIN exhibits e ON sel.exhibit_id = e.id
     WHERE sel.system_id = $1
     ORDER BY sel.sort_order, e.exhibit_code`,
    [req.params.id]
  );
  res.json(result.rows);
});

router.post('/systems/:id/exhibit-links', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  const editable = await loadEditableSystem(query, String(req.params.id));
  if (!editable.system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
  if (editable.error) return res.status(409).json({ error: editable.error });
  const { exhibit_id, link_type, flow_allocation_m3h, notes, sort_order } = req.body;
  if (!exhibit_id) return res.status(400).json({ error: { code: 'VALIDATION', message: 'exhibit_id is required' } });
  if (flow_allocation_m3h != null &&
      (!Number.isFinite(Number(flow_allocation_m3h)) || Number(flow_allocation_m3h) <= 0)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Flow allocation must be greater than zero, or left blank to use calculated exhibit flow.' } });
  }
  try {
    const ownership = await query(
      `SELECT s.project_id AS system_project_id, s.water_type AS system_water_type,
              e.project_id AS exhibit_project_id, e.water_type AS exhibit_water_type,
              e.exhibit_code
       FROM systems s CROSS JOIN exhibits e
       WHERE s.id=$1 AND e.id=$2`,
      [req.params.id, exhibit_id],
    );
    const candidate = ownership.rows[0];
    if (!candidate) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System or exhibit not found.' } });
    if (candidate.system_project_id !== candidate.exhibit_project_id) {
      return res.status(409).json({ error: { code: 'OWNERSHIP_MISMATCH', message: 'The exhibit and system must belong to the same project.' } });
    }
    if (!compatibleWaterTypes(candidate.system_water_type, candidate.exhibit_water_type)) {
      return res.status(409).json({
        error: {
          code: 'INCOMPATIBLE_WATER_TYPE',
          message: `${candidate.exhibit_code} uses ${candidate.exhibit_water_type} water and cannot be linked to a ${candidate.system_water_type} system.`,
        },
      });
    }
    const allocationSource = flow_allocation_m3h != null ? 'manual_override' : 'calculated';
    const result = await query(
      `INSERT INTO system_exhibit_links
         (system_id, exhibit_id, link_type, flow_allocation_m3h, notes, sort_order, allocation_source, allocation_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       RETURNING *`,
      [req.params.id, exhibit_id, link_type || 'Primary', flow_allocation_m3h ?? null, notes || null, sort_order ?? 0, allocationSource]
    );
    const enriched = await query(
      `SELECT sel.*, e.exhibit_code, e.exhibit_name, e.water_type as exhibit_water_type
       FROM system_exhibit_links sel JOIN exhibits e ON sel.exhibit_id = e.id WHERE sel.id = $1`,
      [result.rows[0].id]
    );
    res.status(201).json(enriched.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'This exhibit is already linked to the system.' } });
    throw err;
  }
});

router.put('/systems/:id/exhibit-links/:linkId', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  const editable = await loadEditableSystem(query, String(req.params.id));
  if (!editable.system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
  if (editable.error) return res.status(409).json({ error: editable.error });
  const { link_type, flow_allocation_m3h, notes } = req.body;
  if (flow_allocation_m3h != null &&
      (!Number.isFinite(Number(flow_allocation_m3h)) || Number(flow_allocation_m3h) <= 0)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Flow allocation must be greater than zero, or left blank to use calculated exhibit flow.' } });
  }
  const result = await query(
    `UPDATE system_exhibit_links
     SET link_type=$1, flow_allocation_m3h=$2, notes=$3,
         allocation_source=$4, allocation_updated_at=NOW()
     WHERE id=$5 AND system_id=$6 RETURNING *`,
    [link_type || 'Primary', flow_allocation_m3h ?? null, notes || null,
     flow_allocation_m3h != null ? 'manual_override' : 'calculated',
     req.params.linkId, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Link not found' } });
  const enriched = await query(
    `SELECT sel.*, e.exhibit_code, e.exhibit_name, e.water_type as exhibit_water_type
     FROM system_exhibit_links sel JOIN exhibits e ON sel.exhibit_id = e.id WHERE sel.id = $1`,
    [result.rows[0].id]
  );
  res.json(enriched.rows[0]);
});

router.delete('/systems/:id/exhibit-links/:linkId', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  const editable = await loadEditableSystem(query, String(req.params.id));
  if (!editable.system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
  if (editable.error) return res.status(409).json({ error: editable.error });
  const result = await query(
    'DELETE FROM system_exhibit_links WHERE id=$1 AND system_id=$2 RETURNING id',
    [req.params.linkId, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Link not found' } });
  res.json({ deleted: true });
});

// EQUIPMENT ITEMS (direct product-to-project/system relationship)
router.post('/equipment-items', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  const { equip_code, project_id, system_id, product_master_id, component_id, description, quantity, unit, notes, status } = req.body;
  if (!equip_code || !project_id) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'equip_code and project_id are required' } });
  if (system_id) {
    const editable = await loadEditableSystem(query, String(system_id));
    if (!editable.system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    if (editable.error) return res.status(409).json({ error: editable.error });
  }
  try {
    const result = await query(
      `INSERT INTO project_equipment_items (equip_code, project_id, system_id, product_master_id, component_id, description, quantity, unit, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [equip_code.trim().toUpperCase(), project_id, system_id || null, product_master_id || null,
       component_id || null, description || null, quantity || 1, unit || 'EA', notes || null, status || 'Design']);
    if (system_id) await logAudit(req.user!.id, 'system', system_id, 'ADD_EQUIPMENT', {
      summary: `Equipment ${equip_code.trim().toUpperCase()} added to system`,
      equip_code: equip_code.trim().toUpperCase(),
      description,
      quantity,
      unit,
    });
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'Equipment code already exists in this project' } });
    throw err;
  }
});

router.put('/equipment-items/:id', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  const { equip_code, system_id, product_master_id, component_id, description, quantity, unit, notes, status } = req.body;
  const current = await query('SELECT system_id FROM project_equipment_items WHERE id=$1', [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment item not found' } });
  if (current.rows[0].system_id) {
    const editable = await loadEditableSystem(query, String(current.rows[0].system_id));
    if (editable.error) return res.status(409).json({ error: editable.error });
  }
  if (system_id) {
    const editable = await loadEditableSystem(query, String(system_id));
    if (!editable.system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    if (editable.error) return res.status(409).json({ error: editable.error });
  }
  const result = await query(
    `UPDATE project_equipment_items SET equip_code=COALESCE($1,equip_code), system_id=$2, product_master_id=$3,
     component_id=$4, description=$5, quantity=$6, unit=$7, notes=$8, status=$9, updated_at=NOW()
     WHERE id=$10 RETURNING *`,
    [equip_code ? equip_code.trim().toUpperCase() : null, system_id || null, product_master_id || null,
     component_id || null, description || null, quantity || 1, unit || 'EA', notes || null, status || 'Design', req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment item not found' } });
  if (system_id) await logAudit(req.user!.id, 'system', system_id, 'UPDATE_EQUIPMENT', {
    summary: `Equipment ${result.rows[0].equip_code} updated`,
    equip_code: result.rows[0].equip_code,
    description,
    quantity,
    status,
  });
  res.json(result.rows[0]);
});

router.delete('/equipment-items/:id', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  const existing = await query('SELECT * FROM project_equipment_items WHERE id=$1', [req.params.id]);
  const item = existing.rows[0];
  if (item?.system_id) {
    const editable = await loadEditableSystem(query, String(item.system_id));
    if (editable.error) return res.status(409).json({ error: editable.error });
  }
  const result = await query('DELETE FROM project_equipment_items WHERE id=$1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment item not found' } });
  if (item?.system_id) await logAudit(req.user!.id, 'system', item.system_id, 'REMOVE_EQUIPMENT', {
    summary: `Equipment ${item.equip_code} removed from system`,
    equip_code: item.equip_code,
    description: item.description,
  });
  res.json({ success: true });
});

// EQUIPMENT INSTANCES (legacy - kept for reference only)
router.get('/equipment-instances', authenticate, async (req: AuthRequest, res: Response) => {
  const { page, page_size, offset } = paginate(req);
  const filters: string[] = [];
  const params: any[] = [];
  if (req.query.project_id) { params.push(req.query.project_id); filters.push(`ei.project_id = $${params.length}`); }
  if (req.query.system_id) { params.push(req.query.system_id); filters.push(`ei.system_id = $${params.length}`); }
  if (req.query.status) { params.push(req.query.status); filters.push(`ei.status = $${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); filters.push(`(ei.equipment_code ILIKE $${params.length} OR ei.equipment_name ILIKE $${params.length})`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countRes = await query(`SELECT COUNT(*) FROM equipment_instances ei ${where}`, params);
  params.push(page_size, offset);
  const result = await query(
    `SELECT ei.*, s.system_code, s.system_name, pm.product_code, pm.product_name, p.project_code
     FROM equipment_instances ei LEFT JOIN systems s ON ei.system_id=s.id LEFT JOIN product_usages pu ON pu.equipment_instance_id=ei.id LEFT JOIN product_masters pm ON pu.product_master_id=pm.id JOIN projects p ON ei.project_id=p.id
     ${where} ORDER BY ei.equipment_code LIMIT $${params.length-1} OFFSET $${params.length}`, params);
  res.json({ items: result.rows, pagination: { page, page_size, total: parseInt(countRes.rows[0].count) } });
});

router.get('/equipment-instances/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT ei.*, s.system_code, s.system_name, pm.product_code, pm.product_name, p.project_code, p.project_name, m.material_name
     FROM equipment_instances ei LEFT JOIN systems s ON ei.system_id=s.id LEFT JOIN product_usages pu ON pu.equipment_instance_id=ei.id LEFT JOIN product_masters pm ON pu.product_master_id=pm.id JOIN projects p ON ei.project_id=p.id LEFT JOIN materials m ON ei.material_code=m.material_code
     WHERE ei.id::text=$1 OR ei.equipment_code=$1`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment not found' } });
  const documents = await query(
    `SELECT d.*, u.first_name || ' ' || u.last_name as created_by_name FROM documents d LEFT JOIN users u ON d.created_by=u.id WHERE d.equipment_id=$1 ORDER BY d.document_type, d.document_code`,
    [result.rows[0].id]);
  res.json({ ...result.rows[0], documents: documents.rows });
});

router.post('/equipment-instances', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  const { equipment_code, project_id, system_id, equipment_type, equipment_name, design_flow_m3h, design_head_m, power_kw, material_code, operational_duty, location_reference, product_master_id } = req.body;
  if (system_id) {
    const editable = await loadEditableSystem(query, String(system_id));
    if (!editable.system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    if (editable.error) return res.status(409).json({ error: editable.error });
  }
  const result = await query(
    'INSERT INTO equipment_instances (equipment_code, project_id, system_id, equipment_type, equipment_name, design_flow_m3h, design_head_m, power_kw, material_code, operational_duty, location_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
    [equipment_code, project_id, system_id, equipment_type, equipment_name, design_flow_m3h, design_head_m, power_kw, material_code, operational_duty, location_reference]);
  const eq = result.rows[0];
  if (product_master_id && eq?.id) {
    await query(
      'INSERT INTO product_usages (product_master_id, equipment_instance_id, project_id) VALUES ($1,$2,$3)',
      [product_master_id, eq.id, project_id]
    );
  }
  await logAudit(req.user!.id, 'equipment', eq.id, 'CREATE', {
    summary: `Equipment ${equipment_code} created`,
    equipment_code,
    equipment_name,
    equipment_type,
  });
  res.status(201).json(eq);
});

router.put('/equipment-instances/:id', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  const { equipment_name, equipment_type, design_flow_m3h, design_head_m, power_kw, material_code, status, operational_duty, serial_number, installation_date, commissioning_date } = req.body;
  const current = await query('SELECT system_id FROM equipment_instances WHERE id=$1', [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment not found' } });
  if (current.rows[0].system_id) {
    const editable = await loadEditableSystem(query, String(current.rows[0].system_id));
    if (editable.error) return res.status(409).json({ error: editable.error });
  }
  const result = await query(
    'UPDATE equipment_instances SET equipment_name=$1, equipment_type=$2, design_flow_m3h=$3, design_head_m=$4, power_kw=$5, material_code=$6, status=$7, operational_duty=$8, serial_number=$9, installation_date=$10, commissioning_date=$11, updated_at=NOW() WHERE id=$12 RETURNING *',
    [equipment_name, equipment_type, design_flow_m3h, design_head_m, power_kw, material_code, status, operational_duty, serial_number, installation_date, commissioning_date, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment not found' } });
  await logAudit(req.user!.id, 'equipment', String(req.params.id), 'UPDATE', {
    summary: 'Equipment details updated',
    equipment_name,
    equipment_type,
    status,
    serial_number,
  });
  res.json(result.rows[0]);
});

// LIFECYCLE TRANSITIONS
router.post('/lifecycle/transition', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const { entity_type, entity_id, to_state, comment } = req.body;
  if (!entity_type || !entity_id || !to_state) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'entity_type, entity_id, to_state required' } });

  const table = entity_type === 'system' ? 'systems' : entity_type === 'equipment' ? 'equipment_instances' : entity_type === 'document' ? 'documents' : null;

  let from_state = null;
  if (table) {
    const current = await query(`SELECT status FROM ${table} WHERE id=$1`, [entity_id]);
    from_state = current.rows[0]?.status;
    await query(`UPDATE ${table} SET status=$1, updated_at=NOW() WHERE id=$2`, [to_state, entity_id]);
  }

  await query('INSERT INTO lifecycle_transitions (entity_type, entity_id, from_state, to_state, actor_id, comment) VALUES ($1,$2,$3,$4,$5,$6)',
    [entity_type, entity_id, from_state, to_state, req.user!.id, comment]);

  await logAudit(req.user!.id, entity_type, entity_id, 'STATE_TRANSITION', {
    summary: `Status changed from ${from_state || 'Unknown'} → ${to_state}`,
    from: from_state,
    to: to_state,
    comment,
  });

  res.json({ success: true, from_state, to_state });
});

router.get('/lifecycle/:entity_type/:entity_id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    'SELECT lt.*, u.first_name || \' \' || u.last_name as actor_name FROM lifecycle_transitions lt LEFT JOIN users u ON lt.actor_id=u.id WHERE lt.entity_type=$1 AND lt.entity_id=$2::uuid ORDER BY lt.transitioned_at ASC',
    [req.params.entity_type, req.params.entity_id]);
  res.json({ items: result.rows });
});

router.get('/audit/:entity_type/:entity_id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT al.*, u.first_name || ' ' || u.last_name as actor_name, u.email as actor_email
     FROM audit_logs al LEFT JOIN users u ON al.actor_id=u.id
     WHERE al.entity_type=$1 AND al.entity_id=$2
     ORDER BY al.created_at DESC LIMIT 200`,
    [req.params.entity_type, req.params.entity_id]);
  res.json({ items: result.rows });
});

// CHANGE REQUESTS
router.get('/change-requests', authenticate, async (req: AuthRequest, res: Response) => {
  let where = '', params: any[] = [];
  if (req.query.project_id) { params.push(req.query.project_id); where = `WHERE cr.project_id=$1`; }
  const result = await query(`SELECT cr.*, u.first_name || ' ' || u.last_name as requested_by_name FROM change_requests cr LEFT JOIN users u ON cr.requested_by=u.id ${where} ORDER BY cr.created_at DESC`, params);
  res.json({ items: result.rows });
});

router.post('/change-requests', authenticate, async (req: AuthRequest, res: Response) => {
  const { project_id, title, change_reason, risk_level, affected_entities } = req.body;
  const change_code = `CR-${Date.now().toString(36).toUpperCase()}`;
  const result = await query(
    'INSERT INTO change_requests (change_code, project_id, title, change_reason, risk_level, affected_entities, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [change_code, project_id, title, change_reason, risk_level || 'Medium', JSON.stringify(affected_entities || []), req.user!.id]);
  res.status(201).json(result.rows[0]);
});

router.put('/change-requests/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { status, title, change_reason, risk_level } = req.body;
  const result = await query('UPDATE change_requests SET status=$1, title=$2, change_reason=$3, risk_level=$4, updated_at=NOW() WHERE id=$5 RETURNING *',
    [status, title, change_reason, risk_level, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Change request not found' } });
  res.json(result.rows[0]);
});

// PROJECT PIPING ITEMS
router.get('/projects/:id/piping', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT ppi.*, pm.product_code, pm.product_name, pm.application_type,
            s.system_code, s.system_name
     FROM project_piping_items ppi
     LEFT JOIN product_masters pm ON ppi.product_master_id = pm.id
     LEFT JOIN systems s ON ppi.system_id = s.id
     WHERE ppi.project_id = $1
     ORDER BY ppi.piping_code`,
    [req.params.id]);
  res.json({ items: result.rows });
});

router.post('/piping-items', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  const { piping_code, project_id, system_id, product_master_id, description, quantity, unit, notes, status } = req.body;
  if (!piping_code || !project_id) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'piping_code and project_id are required' } });
  if (system_id) {
    const editable = await loadEditableSystem(query, String(system_id));
    if (!editable.system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    if (editable.error) return res.status(409).json({ error: editable.error });
  }
  const result = await query(
    `INSERT INTO project_piping_items (piping_code, project_id, system_id, product_master_id, description, quantity, unit, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [piping_code.trim().toUpperCase(), project_id, system_id || null, product_master_id || null,
     description || null, quantity || 1, unit || 'EA', notes || null, status || 'Design']);
  res.status(201).json(result.rows[0]);
});

router.put('/piping-items/:id', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  const { description, quantity, unit, notes, status, system_id } = req.body;
  const current = await query('SELECT system_id FROM project_piping_items WHERE id=$1', [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Piping item not found' } });
  if (current.rows[0].system_id) {
    const editable = await loadEditableSystem(query, String(current.rows[0].system_id));
    if (editable.error) return res.status(409).json({ error: editable.error });
  }
  if (system_id) {
    const editable = await loadEditableSystem(query, String(system_id));
    if (!editable.system) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    if (editable.error) return res.status(409).json({ error: editable.error });
  }
  const result = await query(
    `UPDATE project_piping_items SET description=$1, quantity=$2, unit=$3, notes=$4, status=$5, system_id=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [description || null, quantity || 1, unit || 'EA', notes || null, status, system_id || null, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Piping item not found' } });
  res.json(result.rows[0]);
});

router.delete('/piping-items/:id', authenticate, requireRole('admin', 'engineer'), requireModuleManage('projects'), async (req: AuthRequest, res: Response) => {
  const current = await query('SELECT system_id FROM project_piping_items WHERE id=$1', [req.params.id]);
  if (current.rows[0]?.system_id) {
    const editable = await loadEditableSystem(query, String(current.rows[0].system_id));
    if (editable.error) return res.status(409).json({ error: editable.error });
  }
  await query('DELETE FROM project_piping_items WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// BOM RELEASES
router.get('/projects/:id/bom-releases', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT br.*, u.first_name || ' ' || u.last_name as created_by_name,
            (SELECT COUNT(*) FROM bom_release_lines WHERE bom_release_id = br.id) as line_count
     FROM bom_releases br
     LEFT JOIN users u ON br.created_by = u.id
     WHERE br.project_id = $1
     ORDER BY br.created_at DESC`,
    [req.params.id]);
  res.json({ items: result.rows });
});

router.get('/bom-releases/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const release = await query(
    `SELECT br.*, u.first_name || ' ' || u.last_name as created_by_name
     FROM bom_releases br LEFT JOIN users u ON br.created_by=u.id
     WHERE br.id=$1`, [req.params.id]);
  if (!release.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'BOM Release not found' } });
  const lines = await query(
    'SELECT * FROM bom_release_lines WHERE bom_release_id=$1 ORDER BY section, line_number',
    [req.params.id]);
  res.json({ ...release.rows[0], lines: lines.rows });
});

router.post('/bom-releases', authenticate, async (req: AuthRequest, res: Response) => {
  const { project_id, title, revision, notes, include_sections } = req.body;
  if (!project_id) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'project_id is required' } });

  const sections: string[] = Array.isArray(include_sections) && include_sections.length > 0
    ? include_sections
    : ['Products', 'Tank', 'Piping'];

  const countResult = await query('SELECT COUNT(*) FROM bom_releases WHERE project_id=$1', [project_id]);
  const num = (parseInt(countResult.rows[0].count) + 1).toString().padStart(3, '0');
  const projResult = await query('SELECT project_code FROM projects WHERE id=$1', [project_id]);
  const projectCode = projResult.rows[0]?.project_code || 'PRJ';
  const release_code = `BOM-${projectCode}-${num}`;
  const result = await query(
    `INSERT INTO bom_releases (release_code, project_id, title, revision, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [release_code, project_id, title || `BOM Release ${num}`, revision || 'A', notes || null, req.user!.id]);
  const releaseId = result.rows[0].id;

  let lineNum = 1;

  if (sections.includes('Products')) {
    const equipment = await query(
      `SELECT pei.equip_code as tag_code,
              COALESCE(pei.description, pm.product_name) as description,
              pm.product_code, pm.product_name, pei.quantity, pei.unit,
              s.system_code as system_ref, NULL as area_ref
       FROM project_equipment_items pei
       LEFT JOIN product_masters pm ON pei.product_master_id = pm.id
       LEFT JOIN systems s ON pei.system_id = s.id
       WHERE pei.project_id = $1
       ORDER BY pei.equip_code`,
      [project_id]);
    for (const row of equipment.rows) {
      await query(
        `INSERT INTO bom_release_lines (bom_release_id, section, line_number, tag_code, description, product_code, product_name, quantity, unit, system_ref, area_ref)
         VALUES ($1,'Products',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [releaseId, lineNum++, row.tag_code, row.description, row.product_code, row.product_name, row.quantity, row.unit, row.system_ref, row.area_ref]);
    }
  }

  if (sections.includes('Tank')) {
    const tanks = await query(
      `SELECT t.tank_code as tag_code, t.tank_name as description,
              pm.product_code, pm.product_name, 1 as quantity, 'EA' as unit,
              NULL as system_ref, a.area_name as area_ref
       FROM tanks t
       LEFT JOIN product_masters pm ON t.product_master_id = pm.id
       LEFT JOIN areas a ON t.area_id = a.id
       WHERE t.project_id = $1
       ORDER BY t.tank_code`,
      [project_id]);
    for (const row of tanks.rows) {
      await query(
        `INSERT INTO bom_release_lines (bom_release_id, section, line_number, tag_code, description, product_code, product_name, quantity, unit, system_ref, area_ref)
         VALUES ($1,'Tank',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [releaseId, lineNum++, row.tag_code, row.description, row.product_code, row.product_name, row.quantity, row.unit, row.system_ref, row.area_ref]);
    }
  }

  if (sections.includes('Piping')) {
    const piping = await query(
      `SELECT ppi.piping_code as tag_code, COALESCE(ppi.description, pm.product_name) as description,
              pm.product_code, pm.product_name, ppi.quantity, ppi.unit,
              s.system_code as system_ref, NULL as area_ref
       FROM project_piping_items ppi
       LEFT JOIN product_masters pm ON ppi.product_master_id = pm.id
       LEFT JOIN systems s ON ppi.system_id = s.id
       WHERE ppi.project_id = $1
       ORDER BY ppi.piping_code`,
      [project_id]);
    for (const row of piping.rows) {
      await query(
        `INSERT INTO bom_release_lines (bom_release_id, section, line_number, tag_code, description, product_code, product_name, quantity, unit, system_ref, area_ref)
         VALUES ($1,'Piping',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [releaseId, lineNum++, row.tag_code, row.description, row.product_code, row.product_name, row.quantity, row.unit, row.system_ref, row.area_ref]);
    }
  }

  const final = await query('SELECT * FROM bom_releases WHERE id=$1', [releaseId]);
  res.status(201).json(final.rows[0]);
});

router.get('/projects/:id/items-for-po', authenticate, async (req: AuthRequest, res: Response) => {
  const proj = await query('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
  if (!proj.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  const projectId = proj.rows[0].id;

  const equipment = await query(
    `WITH released_eq AS (
       SELECT DISTINCT ON (pi.project_equipment_item_id)
         pi.project_equipment_item_id, pi.po_id, po.po_code
       FROM po_items pi
       JOIN purchase_orders po ON pi.po_id = po.id
       WHERE pi.project_equipment_item_id IS NOT NULL
       ORDER BY pi.project_equipment_item_id, pi.created_at DESC
     )
     SELECT pei.id, pei.equip_code AS tag_code,
            COALESCE(pei.description, pm.product_name) AS description,
            pm.id AS product_master_id, pm.product_code, pm.product_name,
            pm.cost, pm.sell_price,
            pei.quantity, pei.unit,
            s.id AS system_id, s.system_code, s.system_name,
            r.po_id AS released_po_id, r.po_code AS released_po_code
     FROM project_equipment_items pei
     LEFT JOIN product_masters pm ON pei.product_master_id = pm.id
     LEFT JOIN systems s ON pei.system_id = s.id
     LEFT JOIN released_eq r ON r.project_equipment_item_id = pei.id
     WHERE pei.project_id = $1 AND pei.product_master_id IS NOT NULL
     ORDER BY s.system_code NULLS LAST, pei.equip_code`,
    [projectId]);

  const tanks = await query(
    `WITH released_tanks AS (
       SELECT DISTINCT ON (pi.tank_id)
         pi.tank_id, pi.po_id, po.po_code
       FROM po_items pi
       JOIN purchase_orders po ON pi.po_id = po.id
       WHERE pi.tank_id IS NOT NULL
       ORDER BY pi.tank_id, pi.created_at DESC
     )
     SELECT t.id, t.tank_code AS tag_code, t.tank_name AS description,
            pm.id AS product_master_id, pm.product_code, pm.product_name,
            pm.cost, pm.sell_price,
            COALESCE(t.quantity, 1) AS quantity, 'EA' AS unit,
            NULL::uuid AS system_id, NULL AS system_code, NULL AS system_name,
            r.po_id AS released_po_id, r.po_code AS released_po_code
     FROM tanks t
     LEFT JOIN product_masters pm ON t.product_master_id = pm.id
     LEFT JOIN released_tanks r ON r.tank_id = t.id
     WHERE t.project_id = $1 AND t.product_master_id IS NOT NULL
     ORDER BY t.tank_code`,
    [projectId]);

  res.json({ equipment: equipment.rows, tanks: tanks.rows });
});

router.post('/bom-releases/:id/issue', authenticate, async (req: AuthRequest, res: Response) => {
  const { issued_date } = req.body;
  const result = await query(
    `UPDATE bom_releases SET status='Issued', issued_date=COALESCE($1::date, CURRENT_DATE), updated_at=NOW()
     WHERE id=$2 AND status='Draft' RETURNING *`,
    [issued_date || null, req.params.id]);
  if (!result.rows[0]) return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'Release not found or already issued' } });
  res.json(result.rows[0]);
});

router.delete('/bom-releases/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const check = await query('SELECT status FROM bom_releases WHERE id=$1', [req.params.id]);
  if (!check.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'BOM Release not found' } });
  if (check.rows[0].status === 'Issued') return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'Cannot delete an issued release' } });
  await query('DELETE FROM bom_releases WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

export default router;
