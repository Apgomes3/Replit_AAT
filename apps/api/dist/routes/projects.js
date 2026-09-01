"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importStar(require("../db"));
const auth_1 = require("../middleware/auth");
const audit_1 = require("../db/audit");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const aquariumCalculations_1 = require("../lib/aquariumCalculations");
const tankCalculations_1 = require("../lib/tankCalculations");
const customFootprint_1 = require("../lib/customFootprint");
const systemLifecycle_1 = require("../lib/systemLifecycle");
const lssSystems_1 = require("../lib/lssSystems");
const uploadsDir = path_1.default.join(__dirname, '../../uploads');
if (!fs_1.default.existsSync(uploadsDir))
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
const logoStorage = multer_1.default.diskStorage({
    destination: uploadsDir,
    filename: (_, file, cb) => {
        const unique = `${Date.now()}-${crypto_1.default.randomBytes(6).toString('hex')}`;
        cb(null, `logo-${unique}${path_1.default.extname(file.originalname)}`);
    },
});
const uploadLogo = (0, multer_1.default)({
    storage: logoStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
});
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.use((req, res, next) => {
    // Lifecycle and audit feeds are shared platform services used by other
    // modules such as Design Books and Documents.
    if (req.path.startsWith('/lifecycle/') || req.path.startsWith('/audit/'))
        return next();
    return (0, auth_1.requireModuleAccess)('projects')(req, res, next);
});
const paginate = (req) => {
    const page = parseInt(req.query.page) || 1;
    const page_size = Math.min(parseInt(req.query.page_size) || 25, 200);
    const offset = (page - 1) * page_size;
    return { page, page_size, offset };
};
const buildSort = (sort, allowed = ['project_code', 'project_name', 'project_status', 'created_at']) => {
    if (!sort)
        return 'created_at DESC';
    const dir = sort.startsWith('-') ? 'DESC' : 'ASC';
    const col = sort.replace(/^-/, '');
    return allowed.includes(col) ? `${col} ${dir}` : 'created_at DESC';
};
const tankNumericFields = {
    length_mm: 'Length',
    width_mm: 'Width',
    height_mm: 'Height',
    design_water_level_mm: 'Water level',
    gross_volume_m3: 'Gross volume',
    operating_volume_m3: 'Operating volume',
    surface_area_m2: 'Water-surface area',
};
function tankNumberError(value, field) {
    if (value === undefined || value === null || value === '')
        return null;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0)
        return null;
    return {
        code: 'VALIDATION',
        field,
        message: `${tankNumericFields[field]} must be a non-negative number.`,
    };
}
function tankDatabaseField(error) {
    const source = `${error?.constraint || ''} ${error?.column || ''}`.toLowerCase();
    const fields = [
        'tank_code', 'tank_name', 'project_id', 'exhibit_id', 'system_id',
        'product_master_id', 'material_id', ...Object.keys(tankNumericFields),
    ];
    return fields.find(field => source.includes(field));
}
function tankDatabaseResponse(error) {
    const field = tankDatabaseField(error);
    return {
        code: error?.code === '23503' ? 'INVALID_REFERENCE' : 'INVALID_REQUEST',
        message: field
            ? `The selected ${field.replace(/_mm$/, '').replace(/_/g, ' ')} is no longer valid.`
            : 'The tank could not be saved. Check the tank details and try again.',
        ...(field ? { field } : {}),
    };
}
const FLOW_SIDE_STREAM_PRESETS = ['Thermal', 'UV', 'Custom'];
function withoutStaleLinkedSystemFlow(system) {
    const source = system?.calculation_inputs?.design_flow_source === 'manual_override'
        ? 'manual_override'
        : 'linked_exhibits';
    return {
        ...system,
        design_flow_m3h: source === 'manual_override' ? system.design_flow_m3h : null,
        design_flow_source: source,
    };
}
function normalizeSideStreams(value) {
    if (!Array.isArray(value))
        return null;
    const normalized = value.map((stream, index) => {
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
        if (!name)
            throw new Error(`Side stream ${index + 1} requires a name.`);
        if (name.length > 255)
            throw new Error(`Side stream ${index + 1} name must be 255 characters or fewer.`);
        if (!Number.isFinite(flowPct) || flowPct < 0 || flowPct > 100) {
            throw new Error(`${name} allocation must be between 0% and 100%.`);
        }
        if (preset && !FLOW_SIDE_STREAM_PRESETS.includes(preset)) {
            throw new Error(`${name} has an unsupported preset.`);
        }
        const uvRevisionId = stream?.uv_revision_id == null || stream.uv_revision_id === ''
            ? null : String(stream.uv_revision_id);
        const uvUnitQuantity = stream?.uv_unit_quantity == null || stream.uv_unit_quantity === ''
            ? null : Number(stream.uv_unit_quantity);
        if (uvUnitQuantity != null && (!Number.isInteger(uvUnitQuantity) || uvUnitQuantity < 1)) {
            throw new Error(`${name} UV unit quantity must be a positive integer.`);
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
            has_dedicated_pump: hasDedicatedPump,
        };
    });
    return normalized;
}
async function loadSystemSideStreams(systemId, runner = db_1.query) {
    return (await runner(`SELECT * FROM system_flow_side_streams
     WHERE system_id=$1
     ORDER BY parent_loop_number, sort_order, created_at, id`, [systemId])).rows;
}
async function loadSystemFractionatorAllocations(systemId, runner = db_1.query) {
    return (await runner(`SELECT * FROM system_flow_fractionator_allocations
     WHERE system_id=$1 ORDER BY parent_loop_number`, [systemId])).rows;
}
async function loadSystemSandFilterAllocations(systemId, runner = db_1.query) {
    return (await runner(`SELECT * FROM system_flow_sand_filter_allocations
     WHERE system_id=$1 ORDER BY parent_loop_number`, [systemId])).rows;
}
async function normalizeSandFilterAllocations(value, system, runner = db_1.query) {
    if (!Array.isArray(value))
        return null;
    const seenLoops = new Set();
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
        if (notes && notes.length > 5000)
            throw new Error(`Loop ${loopNumber} Sand Filter notes are too long.`);
        const requestedProducts = Array.isArray(allocation?.products) ? allocation.products : [];
        const productIds = [];
        const quantities = new Map();
        for (const product of requestedProducts) {
            const id = String(product?.product_master_id || '');
            const quantity = Number(product?.quantity);
            if (!id || !Number.isInteger(quantity) || quantity <= 0) {
                throw new Error(`Loop ${loopNumber} Sand Filter quantities must be positive whole numbers.`);
            }
            if (quantities.has(id))
                throw new Error(`Loop ${loopNumber} contains the same Sand Filter model more than once.`);
            productIds.push(id);
            quantities.set(id, quantity);
        }
        const catalog = productIds.length ? (await runner(`SELECT pm.id, pm.product_code, pm.product_name, pd.diameter_mm
       FROM product_masters pm
       JOIN product_families pf ON pf.id=pm.product_family_id
       LEFT JOIN product_dimensions pd ON pd.product_master_id=pm.id
       WHERE pm.id = ANY($1::uuid[]) AND pf.product_family_code='PFM-SF'
         AND COALESCE(pm.status, 'Active')='Active'`, [productIds])).rows : [];
        if (catalog.length !== productIds.length) {
            throw new Error(`Loop ${loopNumber} includes a product that is not an active AAT Sand Filter.`);
        }
        const products = productIds.map(id => {
            const product = catalog.find(item => String(item.id) === id);
            return {
                product_master_id: product.id, product_code: product.product_code,
                product_name: product.product_name,
                diameter_mm: product.diameter_mm == null ? null : Number(product.diameter_mm),
                quantity: quantities.get(id),
            };
        });
        const flowPct = system?.[`loop${loopNumber}_flow_pct`];
        const parentFlow = flowPct == null || system?.design_flow_m3h == null
            ? null : Number(system.design_flow_m3h) * Number(flowPct) / 100;
        const calculation = (0, aquariumCalculations_1.calculateSandFilterCapacity)(parentFlow, rate, products);
        normalized.push({
            parent_loop_number: loopNumber, process_rate_ls_m2: rate, notes, products,
            calculation_status: calculation.match_status,
        });
    }
    return normalized;
}
async function normalizeFractionatorAllocations(value, system, runner = db_1.query) {
    if (!Array.isArray(value))
        return null;
    const seenLoops = new Set();
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
        if (notes && notes.length > 5000)
            throw new Error(`Loop ${loopNumber} fractionator notes are too long.`);
        const requestedProducts = Array.isArray(allocation?.products) ? allocation.products : [];
        const productIds = [];
        const quantities = new Map();
        for (const product of requestedProducts) {
            const id = String(product?.product_master_id || '');
            const quantity = Number(product?.quantity);
            if (!id || !Number.isInteger(quantity) || quantity <= 0) {
                throw new Error(`Loop ${loopNumber} fractionator quantities must be positive whole numbers.`);
            }
            if (quantities.has(id))
                throw new Error(`Loop ${loopNumber} contains the same fractionator model more than once.`);
            productIds.push(id);
            quantities.set(id, quantity);
        }
        const catalog = productIds.length ? (await runner(`SELECT pm.id, pm.product_code, pm.product_name, pd.diameter_mm
       FROM product_masters pm
       JOIN product_families pf ON pf.id=pm.product_family_id
       LEFT JOIN product_dimensions pd ON pd.product_master_id=pm.id
       WHERE pm.id = ANY($1::uuid[]) AND pf.product_family_code='PFM-FF'`, [productIds])).rows : [];
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
                quantity: quantities.get(id),
            };
        });
        const flowPct = system?.[`loop${loopNumber}_flow_pct`];
        const parentFlow = flowPct == null || system?.design_flow_m3h == null
            ? null : Number(system.design_flow_m3h) * Number(flowPct) / 100;
        const calculation = (0, aquariumCalculations_1.calculateFoamFractionatorCapacity)(parentFlow, rate, products);
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
router.get('/projects', auth_1.authenticate, async (req, res) => {
    const { page, page_size, offset } = paginate(req);
    const filters = [];
    const params = [];
    if (req.query.status) {
        params.push(req.query.status);
        filters.push(`project_status = $${params.length}`);
    }
    if (req.query.q) {
        params.push(`%${req.query.q}%`);
        filters.push(`(project_name ILIKE $${params.length} OR project_code ILIKE $${params.length})`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const sort = buildSort(req.query.sort);
    const countRes = await (0, db_1.query)(`SELECT COUNT(*) FROM projects ${where}`, params);
    const total = parseInt(countRes.rows[0].count);
    params.push(page_size, offset);
    const result = await (0, db_1.query)(`SELECT * FROM projects ${where} ORDER BY ${sort} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ items: result.rows, pagination: { page, page_size, total } });
});
router.get('/projects/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT * FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    res.json(result.rows[0]);
});
router.post('/projects', auth_1.authenticate, async (req, res) => {
    const { project_code, project_name, client_name, site_name, country, city, timezone, project_status, start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes, scopes } = req.body;
    if (!project_code || !project_name)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'project_code and project_name required' } });
    const toDate = (v) => (v === '' || v == null) ? null : v;
    const toStr = (v) => (v === '' || v == null) ? null : String(v);
    const resolvedScopes = (Array.isArray(scopes) && scopes.length > 0) ? scopes : ['LSS', 'Tanks', 'Waterproofing', 'Theming', 'Acrylic'];
    const result = await (0, db_1.query)(`INSERT INTO projects (project_code, project_name, client_name, site_name, country, city, timezone, project_status, start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes, project_scopes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [project_code, project_name, toStr(client_name), toStr(site_name), toStr(country), toStr(city), toStr(timezone), project_status || 'Concept', toDate(start_date), toDate(target_completion_date), toStr(project_manager), toStr(engineering_manager), toStr(qa_owner), toStr(notes), resolvedScopes, req.user.id]);
    res.status(201).json(result.rows[0]);
});
router.put('/projects/:id', auth_1.authenticate, async (req, res) => {
    const { project_name, client_name, site_name, country, city, latitude, longitude, project_status, start_date, target_completion_date, project_manager, engineering_manager, qa_owner, notes, project_scopes } = req.body;
    const toDate = (v) => (v === '' || v == null) ? null : v;
    const toNum = (v) => (v === '' || v == null) ? null : Number(v);
    const toStr = (v) => (v === '' || v == null) ? null : String(v);
    const result = await (0, db_1.query)(`UPDATE projects SET project_name=$1, client_name=$2, site_name=$3, country=$4, city=$5, latitude=$6, longitude=$7, project_status=$8, start_date=$9, target_completion_date=$10, project_manager=$11, engineering_manager=$12, qa_owner=$13, notes=$14, project_scopes=COALESCE($15, project_scopes), updated_at=NOW()
     WHERE id=$16 RETURNING *`, [toStr(project_name), toStr(client_name), toStr(site_name), toStr(country), toStr(city), toNum(latitude), toNum(longitude), project_status, toDate(start_date), toDate(target_completion_date), toStr(project_manager), toStr(engineering_manager), toStr(qa_owner), toStr(notes), Array.isArray(project_scopes) ? project_scopes : null, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    await (0, audit_1.logAudit)(req.user.id, 'project', result.rows[0].id, 'UPDATE', {
        summary: 'Project details updated',
        project_name: result.rows[0].project_name,
        project_status: result.rows[0].project_status,
    });
    res.json(result.rows[0]);
});
router.patch('/projects/:id/scopes', auth_1.authenticate, async (req, res) => {
    try {
        const { scopes } = req.body;
        if (!Array.isArray(scopes) || scopes.length === 0) {
            return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'scopes must be a non-empty array' } });
        }
        const result = await (0, db_1.query)('UPDATE projects SET project_scopes=$1::text[], updated_at=NOW() WHERE id=$2 RETURNING id, project_scopes', [scopes, req.params.id]);
        if (!result.rows[0])
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
        res.json(result.rows[0]);
    }
    catch (err) {
        res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
    }
});
router.delete('/projects/:id', auth_1.authenticate, async (req, res) => {
    await (0, db_1.query)('DELETE FROM projects WHERE id = $1', [req.params.id]);
    res.status(204).end();
});
router.post('/projects/:id/logo', auth_1.authenticate, uploadLogo.single('logo'), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: { code: 'NO_FILE', message: 'Image file required' } });
    const logoUrl = `/uploads/${req.file.filename}`;
    const result = await (0, db_1.query)('UPDATE projects SET logo_url=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [logoUrl, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    res.json(result.rows[0]);
});
// AREAS
router.get('/projects/:id/areas', auth_1.authenticate, async (req, res) => {
    const proj = await (0, db_1.query)('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
    if (!proj.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    const result = await (0, db_1.query)('SELECT * FROM areas WHERE project_id = $1 ORDER BY area_code', [proj.rows[0].id]);
    res.json({ items: result.rows });
});
router.get('/projects/:id/systems', auth_1.authenticate, async (req, res) => {
    const proj = await (0, db_1.query)('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
    if (!proj.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    const result = await (0, db_1.query)(`SELECT s.*, a.area_name, e.exhibit_name,
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
     ORDER BY s.sort_order, s.system_code`, [proj.rows[0].id, req.query.include_historical === 'true']);
    res.json({ items: result.rows });
});
router.get('/projects/:id/equipment', auth_1.authenticate, async (req, res) => {
    const proj = await (0, db_1.query)('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
    if (!proj.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    const result = await (0, db_1.query)(`SELECT pei.*, s.system_code, s.system_name, pm.product_code, pm.product_name
     FROM project_equipment_items pei
     LEFT JOIN systems s ON pei.system_id = s.id
     LEFT JOIN product_masters pm ON pei.product_master_id = pm.id
     WHERE pei.project_id = $1 ORDER BY pei.equip_code`, [proj.rows[0].id]);
    res.json({ items: result.rows });
});
router.get('/projects/:id/documents', auth_1.authenticate, async (req, res) => {
    const proj = await (0, db_1.query)('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
    if (!proj.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    const result = await (0, db_1.query)('SELECT * FROM documents WHERE project_id = $1 ORDER BY document_code', [proj.rows[0].id]);
    res.json({ items: result.rows });
});
router.get('/projects/:id/change-requests', auth_1.authenticate, async (req, res) => {
    const proj = await (0, db_1.query)('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
    if (!proj.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    const result = await (0, db_1.query)('SELECT cr.*, u.first_name || \' \' || u.last_name as requested_by_name FROM change_requests cr LEFT JOIN users u ON cr.requested_by=u.id WHERE cr.project_id = $1 ORDER BY cr.created_at DESC', [proj.rows[0].id]);
    res.json({ items: result.rows });
});
// AREAS standalone
router.get('/areas', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT a.*, p.project_code FROM areas a JOIN projects p ON a.project_id=p.id ORDER BY a.area_code');
    res.json({ items: result.rows });
});
router.get('/areas/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT a.*, p.project_code, p.project_name FROM areas a JOIN projects p ON a.project_id=p.id WHERE a.id = $1', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Area not found' } });
    res.json(result.rows[0]);
});
router.post('/areas', auth_1.authenticate, async (req, res) => {
    const { area_code, project_id, area_name, discipline_scope, notes } = req.body;
    const result = await (0, db_1.query)('INSERT INTO areas (area_code, project_id, area_name, discipline_scope, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *', [area_code, project_id, area_name, discipline_scope, notes]);
    res.status(201).json(result.rows[0]);
});
// EXHIBITS
router.get('/exhibits', auth_1.authenticate, async (req, res) => {
    const filters = [], params = [];
    if (req.query.project_id) {
        params.push(req.query.project_id);
        filters.push(`e.project_id = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const result = await (0, db_1.query)(`SELECT e.*, a.area_name, p.project_code FROM exhibits e LEFT JOIN areas a ON e.area_id=a.id JOIN projects p ON e.project_id=p.id ${where} ORDER BY e.exhibit_code`, params);
    res.json({ items: result.rows });
});
router.put('/exhibits/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const { exhibit_code, exhibit_name, water_type, design_temperature_min, design_temperature_max, design_salinity, area_id, notes } = req.body;
    if (!exhibit_name)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'exhibit_name is required' } });
    const result = await (0, db_1.query)(`UPDATE exhibits SET exhibit_code=$1, exhibit_name=$2, water_type=$3, design_temperature_min=$4, design_temperature_max=$5, design_salinity=$6, area_id=$7, notes=$8, updated_at=NOW() WHERE id=$9 RETURNING *`, [exhibit_code, exhibit_name, water_type || null, design_temperature_min || null, design_temperature_max || null, design_salinity || null, area_id || null, notes || null, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Exhibit not found' } });
    res.json(result.rows[0]);
});
router.delete('/exhibits/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const result = await (0, db_1.query)('DELETE FROM exhibits WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Exhibit not found' } });
    res.json({ deleted: true });
});
router.get('/exhibits/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT e.*, a.area_name, p.project_code, p.project_name FROM exhibits e JOIN areas a ON e.area_id=a.id JOIN projects p ON e.project_id=p.id WHERE e.id=$1', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Exhibit not found' } });
    res.json(result.rows[0]);
});
router.post('/exhibits', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const { exhibit_code, project_id, area_id, exhibit_name, water_type, design_temperature_min, design_temperature_max, design_salinity } = req.body;
    const result = await (0, db_1.query)('INSERT INTO exhibits (exhibit_code, project_id, area_id, exhibit_name, water_type, design_temperature_min, design_temperature_max, design_salinity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [exhibit_code, project_id, area_id, exhibit_name, water_type, design_temperature_min, design_temperature_max, design_salinity]);
    res.status(201).json(result.rows[0]);
});
// TANKS
router.get('/tanks', auth_1.authenticate, async (req, res) => {
    const filters = [], params = [];
    if (req.query.project_id) {
        params.push(req.query.project_id);
        filters.push(`t.project_id = $${params.length}`);
    }
    if (req.query.system_id) {
        params.push(req.query.system_id);
        filters.push(`t.system_id = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    // Auto-create missing tank_instances rows for multi-unit tanks (idempotent)
    const instanceFilters = ['t.quantity > 1', ...filters];
    await (0, db_1.query)(`INSERT INTO tank_instances (tank_id, instance_index, tag)
     SELECT t.id, gs.i,
       t.tank_code || '-' || LPAD(gs.i::text, CASE WHEN t.quantity > 99 THEN 3 WHEN t.quantity > 9 THEN 2 ELSE 1 END, '0')
     FROM tanks t
     CROSS JOIN LATERAL generate_series(1, t.quantity) AS gs(i)
     WHERE ${instanceFilters.join(' AND ')}
       AND NOT EXISTS (
         SELECT 1 FROM tank_instances ti WHERE ti.tank_id = t.id AND ti.instance_index = gs.i
       )
     ON CONFLICT (tank_id, instance_index) DO NOTHING`, params);
    const result = await (0, db_1.query)(`SELECT t.*, e.exhibit_name, p.project_code,
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
router.get('/tanks/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT t.*, e.exhibit_name, p.project_code, p.project_name,
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
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
    res.json(result.rows[0]);
});
router.post('/tanks', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    try {
        const { tank_code, project_id, tank_name, tank_type, product_master_id, system_id, exhibit_id, quantity, shape_type, gross_volume_m3, operating_volume_m3, length_mm, width_mm, height_mm, design_water_level_mm, primary_material, status, notes, custom_footprint } = req.body;
        const tankCode = String(tank_code ?? '').trim();
        const tankName = String(tank_name ?? '').trim();
        if (!tankCode)
            return res.status(400).json({ error: { code: 'VALIDATION', field: 'tank_code', message: 'Tank code is required.' } });
        if (!project_id)
            return res.status(400).json({ error: { code: 'VALIDATION', field: 'project_id', message: 'Project is required.' } });
        if (!tankName)
            return res.status(400).json({ error: { code: 'VALIDATION', field: 'tank_name', message: 'Tank name is required.' } });
        if (tankCode.length > 50)
            return res.status(400).json({ error: { code: 'VALIDATION', field: 'tank_code', message: 'Tank code must be 50 characters or fewer.' } });
        if (tankName.length > 255)
            return res.status(400).json({ error: { code: 'VALIDATION', field: 'tank_name', message: 'Tank name must be 255 characters or fewer.' } });
        for (const field of Object.keys(tankNumericFields)) {
            const validationError = tankNumberError(req.body[field], field);
            if (validationError)
                return res.status(400).json({ error: validationError });
        }
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
            const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(system_id));
            if (!editable.system)
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
            if (editable.error)
                return res.status(409).json({ error: editable.error });
        }
        if (product_master_id) {
            const access = await (0, db_1.query)(`SELECT rma.access_level
       FROM users u
       LEFT JOIN roles r ON r.name=u.role
       LEFT JOIN role_module_access rma ON rma.role_id=r.id AND rma.module_key='pim'
       WHERE u.id=$1`, [req.user.id]);
            if (access.rows[0]?.access_level !== 'manage') {
                return res.status(403).json({
                    error: { code: 'MODULE_READ_ONLY', message: 'PIM manage access is required to create a linked project tank.' },
                });
            }
            const product = await (0, db_1.query)(`SELECT id FROM product_masters
       WHERE id=$1 AND product_category='Tank'`, [product_master_id]);
            if (!product.rows[0]) {
                return res.status(400).json({
                    error: { code: 'INVALID_PIM_TANK', message: 'The selected item is not a valid PIM tank.' },
                });
            }
        }
        const qty = Math.max(1, parseInt(quantity) || 1);
        const l = length_mm ? parseFloat(length_mm) : null;
        const w = width_mm ? parseFloat(width_mm) : null;
        const h = height_mm ? parseFloat(height_mm) : null;
        const wl = design_water_level_mm ? parseFloat(design_water_level_mm) : null;
        let normalizedFootprint = null;
        if (String(shape_type || '').toLowerCase() === 'custom' && custom_footprint != null) {
            try {
                normalizedFootprint = (0, customFootprint_1.normalizeCustomFootprint)(custom_footprint);
                const footprintSummary = (0, customFootprint_1.summarizeCustomFootprint)(normalizedFootprint);
                if (!footprintSummary.valid) {
                    return res.status(400).json({ error: { code: 'INVALID_CUSTOM_FOOTPRINT', field: 'custom_footprint', message: footprintSummary.message, validation: footprintSummary } });
                }
            }
            catch (error) {
                if (error instanceof customFootprint_1.CustomFootprintValidationError) {
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
            ? (0, customFootprint_1.summarizeCustomFootprint)(normalizedFootprint).area_m2
            : isCustom
                ? null
                : (0, tankCalculations_1.calculateWaterSurfaceAreaM2)(shape_type, l, w);
        const result = await (0, db_1.query)('INSERT INTO tanks (tank_code, project_id, exhibit_id, system_id, quantity, tank_name, tank_type, product_master_id, shape_type, gross_volume_m3, operating_volume_m3, surface_area_m2, length_mm, width_mm, height_mm, design_water_level_mm, custom_footprint, primary_material, status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *', [tankCode, project_id, exhibit_id || null, system_id || null, qty, tankName, tank_type || null, product_master_id || null, shape_type || null, calcGross, calcOp, surfaceAreaM2, l, w, h, wl, normalizedFootprint, primary_material || null, status || 'Active', notes || null]);
        const tank = result.rows[0];
        if (qty > 1) {
            const pad = qty > 99 ? 3 : qty > 9 ? 2 : 1;
            const instanceRows = Array.from({ length: qty }, (_, i) => ({
                tank_id: tank.id,
                instance_index: i + 1,
                tag: `${tank_code.toUpperCase()}-${String(i + 1).padStart(pad, '0')}`,
            }));
            for (const inst of instanceRows) {
                await (0, db_1.query)('INSERT INTO tank_instances (tank_id, instance_index, tag) VALUES ($1,$2,$3) ON CONFLICT (tank_id, instance_index) DO NOTHING', [inst.tank_id, inst.instance_index, inst.tag]);
            }
        }
        res.status(201).json(tank);
    }
    catch (error) {
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
router.post('/tanks/from-pim', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), (0, auth_1.requireModuleManage)('pim'), async (req, res) => {
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
    const client = await db_1.default.connect();
    try {
        await client.query('BEGIN');
        const exhibitResult = await client.query(`SELECT e.id, e.project_id, e.exhibit_name, p.project_code
         FROM exhibits e
         JOIN projects p ON p.id=e.project_id
         WHERE e.id=$1
         FOR UPDATE`, [exhibitId]);
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
        const designBookResult = await client.query(`SELECT id, status
         FROM design_books
         WHERE id=$1 AND project_id=$2
         FOR SHARE`, [designBookId, projectId]);
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
        const productResult = await client.query(`SELECT pm.*, tf.name AS tank_family_name
         FROM product_masters pm
         LEFT JOIN tank_families tf ON tf.id=pm.tank_family_id
         WHERE (pm.id::text=$1 OR pm.product_code=$1)
           AND pm.product_category='Tank'
         FOR SHARE`, [productMasterId]);
        const product = productResult.rows[0];
        if (!product) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: { code: 'INVALID_PIM_TANK', message: 'The selected item is not a valid PIM tank.' },
            });
        }
        const existingExhibitTank = await client.query(`SELECT id, tank_code, tank_name
         FROM tanks
         WHERE project_id=$1 AND exhibit_id=$2 AND product_master_id=$3
           AND ($4 = '' OR id::text <> $4)
         FOR UPDATE`, [projectId, exhibitId, product.id, replaceTankId]);
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
        const surfaceAreaM2 = product.surface_area_m2 ?? (0, tankCalculations_1.calculateWaterSurfaceAreaM2)(product.shape_type, product.length_mm, product.width_mm);
        let tankResult;
        if (replaceTankId) {
            const replacement = await client.query(`SELECT id, tank_code
           FROM tanks
           WHERE id=$1 AND project_id=$2 AND exhibit_id=$3
           FOR UPDATE`, [replaceTankId, projectId, exhibitId]);
            if (!replacement.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    error: { code: 'REPLACEMENT_TANK_NOT_FOUND', message: 'The tank being replaced is no longer assigned to this exhibit.' },
                });
            }
            tankResult = await client.query(`UPDATE tanks SET
             tank_name=$1, tank_type=NULL, product_master_id=$2, shape_type=NULL,
             gross_volume_m3=NULL, operating_volume_m3=NULL, surface_area_m2=NULL,
             length_mm=NULL, width_mm=NULL, height_mm=NULL, design_water_level_mm=NULL,
             primary_material=NULL, material_id=NULL, wall_thickness_mm=NULL,
             inner_length_mm=NULL, inner_width_mm=NULL, inner_height_mm=NULL,
             status='Active', updated_at=NOW()
           WHERE id=$3
           RETURNING *`, [tankName, product.id, replaceTankId]);
        }
        else {
            const usedCodes = await client.query('SELECT tank_code FROM tanks WHERE project_id=$1 FOR UPDATE', [projectId]);
            const used = new Set(usedCodes.rows.map((row) => String(row.tank_code).toUpperCase()));
            const baseCode = (requestedCode || `PIM-${product.product_code}`).slice(0, 50);
            let tankCode = baseCode;
            let suffix = 2;
            while (used.has(tankCode)) {
                const suffixText = `-${suffix++}`;
                tankCode = `${baseCode.slice(0, 50 - suffixText.length)}${suffixText}`;
            }
            tankResult = await client.query(`INSERT INTO tanks
            (tank_code, project_id, exhibit_id, quantity, tank_name, tank_type,
             product_master_id, shape_type, gross_volume_m3, operating_volume_m3,
             length_mm, width_mm, height_mm, design_water_level_mm,
             primary_material, status, notes)
           VALUES ($1,$2,$3,1,$4,NULL,$5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'Active',NULL)
           RETURNING *`, [
                tankCode,
                projectId,
                exhibitId,
                tankName,
                product.id,
            ]);
        }
        const tank = tankResult.rows[0];
        if (!tank) {
            await client.query('ROLLBACK');
            return res.status(500).json({ error: { code: 'CREATE_FAILED', message: 'The linked project tank could not be created.' } });
        }
        await client.query('COMMIT');
        await (0, audit_1.logAudit)(req.user.id, 'tank', tank.id, replaceTankId ? 'REPLACE_FROM_PIM' : 'CREATE_FROM_PIM', {
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
    }
    catch (error) {
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
    }
    finally {
        client.release();
    }
});
// PROMOTE A PROJECT TANK INTO THE REUSABLE PIM TANK LIBRARY
router.post('/tanks/:id/promote-to-pim', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('pim'), async (req, res) => {
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
    const client = await db_1.default.connect();
    try {
        await client.query('BEGIN');
        const sourceResult = await client.query(`SELECT t.*, p.project_code, p.project_name
         FROM tanks t
         JOIN projects p ON p.id=t.project_id
         WHERE t.id=$1
         FOR UPDATE`, [req.params.id]);
        const source = sourceResult.rows[0];
        if (!source) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project tank not found' } });
        }
        const designBookResult = await client.query(`SELECT id, status
         FROM design_books
         WHERE id=$1 AND project_id=$2
         FOR SHARE`, [designBookId, source.project_id]);
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
        const existing = await client.query(`SELECT pm.id, pm.product_code, pm.product_name
         FROM product_masters pm
         WHERE pm.source_tank_id=$1 OR pm.product_code=$2 OR pm.id=$3`, [source.id, productCode, source.product_master_id || null]);
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
            const familyResult = await client.query(`INSERT INTO tank_families (code, name, description, sort_order, is_system)
           VALUES ($1,$2,$3,0,false)
           RETURNING id, code, name, description`, [newFamilyCode, newFamilyName, newFamily?.description ? String(newFamily.description).trim() : null]);
            tankFamilyId = familyResult.rows[0].id;
        }
        else {
            const familyResult = await client.query('SELECT id FROM tank_families WHERE id::text=$1 OR code=$1', [requestedFamilyId]);
            if (!familyResult.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: { code: 'VALIDATION', message: 'Selected tank family was not found.' } });
            }
            tankFamilyId = familyResult.rows[0].id;
        }
        const productResult = await client.query(`INSERT INTO product_masters
          (product_code, tank_family_id, product_name, product_category, application_type,
           primary_material_code, standard_status, notes, shape_type, length_mm, width_mm,
            height_mm, design_water_level_mm, gross_volume_m3, operating_volume_m3,
            surface_area_m2, manufacturer, model, source_tank_id, source_tank_snapshot)
         VALUES ($1,$2,$3,'Tank',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
         RETURNING *`, [
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
            source.surface_area_m2 ?? (0, tankCalculations_1.calculateWaterSurfaceAreaM2)(source.shape_type, source.length_mm, source.width_mm),
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
        ]);
        const product = productResult.rows[0];
        await client.query(`INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details, ip_address)
         VALUES ('product',$1,'PROMOTE_FROM_PROJECT_TANK',$2,$3,$4)`, [
            product.id,
            req.user.id,
            JSON.stringify({
                summary: `PIM tank ${productCode} promoted from project tank ${source.tank_code}`,
                product_code: productCode,
                source_tank_id: source.id,
                source_tank_code: source.tank_code,
                project_code: source.project_code,
                design_book_id: designBookId,
            }),
            req.ip || null,
        ]);
        await client.query('COMMIT');
        res.status(201).json({
            ...product,
            source_tank_id: source.id,
            source_tank_code: source.tank_code,
            source_project_code: source.project_code,
            source_project_name: source.project_name,
        });
    }
    catch (error) {
        await client.query('ROLLBACK');
        if (error?.code === '23505') {
            return res.status(409).json({
                error: { code: 'DUPLICATE_PROMOTION', message: 'This tank or product code has already been promoted to the PIM library.' },
            });
        }
        throw error;
    }
    finally {
        client.release();
    }
});
router.post('/tanks/:id/duplicate', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const orig = await (0, db_1.query)('SELECT * FROM tanks WHERE id=$1', [req.params.id]);
    if (!orig.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
    const t = orig.rows[0];
    const existing = await (0, db_1.query)('SELECT tank_code FROM tanks WHERE project_id=$1', [t.project_id]);
    const usedCodes = new Set(existing.rows.map((r) => r.tank_code.toUpperCase()));
    let newCode = `${t.tank_code}-2`;
    let n = 2;
    while (usedCodes.has(newCode.toUpperCase())) {
        n++;
        newCode = `${t.tank_code}-${n}`;
    }
    const qty = t.quantity ?? 1;
    const result = await (0, db_1.query)('INSERT INTO tanks (tank_code, project_id, system_id, quantity, tank_name, tank_type, product_master_id, shape_type, gross_volume_m3, operating_volume_m3, surface_area_m2, custom_footprint, length_mm, width_mm, height_mm, design_water_level_mm, primary_material, status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *', [newCode.toUpperCase(), t.project_id, t.system_id, qty, `${t.tank_name} (Copy)`, t.tank_type, t.product_master_id, t.shape_type, t.gross_volume_m3, t.operating_volume_m3, t.surface_area_m2, t.custom_footprint, t.length_mm, t.width_mm, t.height_mm, t.design_water_level_mm, t.primary_material, t.status || 'Active', t.notes]);
    const newTank = result.rows[0];
    if (qty > 1) {
        const pad = qty > 99 ? 3 : qty > 9 ? 2 : 1;
        for (let i = 1; i <= qty; i++) {
            await (0, db_1.query)('INSERT INTO tank_instances (tank_id, instance_index, tag) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [newTank.id, i, `${newCode.toUpperCase()}-${String(i).padStart(pad, '0')}`]);
        }
    }
    res.status(201).json(newTank);
});
router.patch('/systems/reorder', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds))
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'orderedIds must be an array' } });
    for (let i = 0; i < orderedIds.length; i++) {
        await (0, db_1.query)('UPDATE systems SET sort_order=$1 WHERE id=$2', [i, orderedIds[i]]);
    }
    res.json({ ok: true });
});
router.patch('/tanks/reorder', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds))
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'orderedIds must be an array' } });
    for (let i = 0; i < orderedIds.length; i++) {
        await (0, db_1.query)('UPDATE tanks SET sort_order=$1 WHERE id=$2', [i, orderedIds[i]]);
    }
    res.json({ ok: true });
});
router.patch('/tanks/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
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
        const result = await (0, db_1.query)('UPDATE tanks SET system_id=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [system_id || null, req.params.id]);
        if (!result.rows[0])
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
        res.json(result.rows[0]);
    }
    catch (err) {
        if (err?.code === '23505' && err?.constraint === 'idx_tanks_pim_assignment') {
            return res.status(409).json({
                error: { code: 'DUPLICATE_ASSIGNMENT', message: 'This PIM tank is already assigned to the exhibit.' },
            });
        }
        throw err;
    }
});
router.put('/tanks/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    try {
        const { tank_code, tank_name, tank_type, shape_type, length_mm, width_mm, height_mm, design_water_level_mm, primary_material, status, notes, quantity, gross_volume_m3, operating_volume_m3, system_id, exhibit_id, product_master_id, material_id, wall_thickness_mm, inner_length_mm, inner_width_mm, inner_height_mm, surface_area_m2, custom_footprint, } = req.body;
        if (!String(tank_name ?? '').trim()) {
            return res.status(400).json({ error: { code: 'VALIDATION', field: 'tank_name', message: 'Tank name is required.' } });
        }
        if (tank_code != null && String(tank_code).trim().length > 50) {
            return res.status(400).json({ error: { code: 'VALIDATION', field: 'tank_code', message: 'Tank code must be 50 characters or fewer.' } });
        }
        if (String(tank_name).trim().length > 255) {
            return res.status(400).json({ error: { code: 'VALIDATION', field: 'tank_name', message: 'Tank name must be 255 characters or fewer.' } });
        }
        for (const field of Object.keys(tankNumericFields)) {
            const validationError = tankNumberError(req.body[field], field);
            if (validationError)
                return res.status(400).json({ error: validationError });
        }
        const hasExhibit = 'exhibit_id' in req.body;
        const hasProductMaster = 'product_master_id' in req.body;
        if (hasProductMaster && product_master_id) {
            return res.status(400).json({
                error: {
                    code: 'INVALID_PIM_ASSIGNMENT',
                    message: 'Use the protected PIM tank assignment workflow to assign a library-linked tank.',
                },
            });
        }
        if (hasExhibit && exhibit_id) {
            const currentTank = await (0, db_1.query)('SELECT id, product_master_id FROM tanks WHERE id=$1', [req.params.id]);
            if (!currentTank.rows[0])
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
            if (currentTank.rows[0].product_master_id) {
                return res.status(400).json({
                    error: {
                        code: 'INVALID_PIM_ASSIGNMENT',
                        message: 'Use the protected PIM tank assignment workflow to assign a library-linked tank to an exhibit.',
                    },
                });
            }
        }
        const currentSystemLink = await (0, db_1.query)('SELECT system_id FROM tanks WHERE id=$1', [req.params.id]);
        if (!currentSystemLink.rows[0])
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
        for (const linkedSystemId of new Set([currentSystemLink.rows[0].system_id, system_id].filter(Boolean))) {
            const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(linkedSystemId));
            if (!editable.system)
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
            if (editable.error)
                return res.status(409).json({ error: editable.error });
        }
        const l = length_mm ? parseFloat(length_mm) : null;
        const w = width_mm ? parseFloat(width_mm) : null;
        const h = height_mm ? parseFloat(height_mm) : null;
        const wl = design_water_level_mm ? parseFloat(design_water_level_mm) : null;
        const t = wall_thickness_mm ? parseFloat(wall_thickness_mm) : 0;
        const isCustom = (shape_type || '').toLowerCase() === 'custom';
        const isCyl = (shape_type || '').toLowerCase() === 'cylindrical';
        let normalizedFootprint = null;
        if (isCustom && custom_footprint != null) {
            try {
                normalizedFootprint = (0, customFootprint_1.normalizeCustomFootprint)(custom_footprint);
                const footprintSummary = (0, customFootprint_1.summarizeCustomFootprint)(normalizedFootprint);
                if (!footprintSummary.valid) {
                    return res.status(400).json({ error: { code: 'INVALID_CUSTOM_FOOTPRINT', field: 'custom_footprint', message: footprintSummary.message, validation: footprintSummary } });
                }
            }
            catch (error) {
                if (error instanceof customFootprint_1.CustomFootprintValidationError) {
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
            ? (gross_volume_m3 != null && gross_volume_m3 !== '' ? parseFloat(gross_volume_m3) : null)
            : isCyl
                ? (iw && ih ? Math.round(Math.PI * (iw / 2) * (iw / 2) * ih / 1e9 * 1e4) / 1e4 : null)
                : (il && iw && ih ? Math.round(il * iw * ih / 1e9 * 1e4) / 1e4 : null);
        const calcOp = isCustom
            ? (operating_volume_m3 != null && operating_volume_m3 !== '' ? parseFloat(operating_volume_m3) : null)
            : isCyl
                ? (iw && wl ? Math.round(Math.PI * (iw / 2) * (iw / 2) * wl / 1e9 * 1e4) / 1e4 : null)
                : (il && iw && wl ? Math.round(il * iw * wl / 1e9 * 1e4) / 1e4 : null);
        const surfaceAreaM2 = normalizedFootprint
            ? (0, customFootprint_1.summarizeCustomFootprint)(normalizedFootprint).area_m2
            : isCustom
                ? null
                : (0, tankCalculations_1.calculateWaterSurfaceAreaM2)(shape_type, isCyl ? null : l, w);
        const qty = Math.max(1, parseInt(quantity) || 1);
        const result = await (0, db_1.query)(`UPDATE tanks SET
      tank_code=COALESCE($1, tank_code), tank_name=$2, tank_type=$3, shape_type=$4,
      length_mm=$5, width_mm=$6, height_mm=$7, design_water_level_mm=$8,
      gross_volume_m3=$9, operating_volume_m3=$10, surface_area_m2=$11,
      custom_footprint=$12, primary_material=$13, status=$14, notes=$15, quantity=$16,
      system_id=$17, material_id=$18, wall_thickness_mm=$19,
      inner_length_mm=$20, inner_width_mm=$21, inner_height_mm=$22,
      product_master_id=CASE WHEN $23 THEN $24 ELSE product_master_id END,
      exhibit_id=CASE WHEN $25 THEN $26 ELSE exhibit_id END,
      updated_at=NOW()
    WHERE id=$27 RETURNING *`, [tank_code ? tank_code.trim().toUpperCase() : null, tank_name, tank_type || null, shape_type || null,
            l, w, h, wl, calcGross, calcOp, surfaceAreaM2, normalizedFootprint,
            primary_material || null, status || 'Active', notes || null, qty,
            system_id || null,
            material_id || null, wall_thickness_mm ?? null,
            inner_length_mm ?? null, inner_width_mm ?? null, inner_height_mm ?? null,
            hasProductMaster, product_master_id || null,
            hasExhibit, exhibit_id || null,
            req.params.id]);
        if (!result.rows[0])
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
        res.json(result.rows[0]);
    }
    catch (error) {
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
router.patch('/tanks/:id/exhibit', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    try {
        const { exhibit_id, replace_tank_id } = req.body;
        const currentTank = await (0, db_1.query)('SELECT id, project_id, product_master_id FROM tanks WHERE id=$1', [req.params.id]);
        if (!currentTank.rows[0])
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
        if (exhibit_id && currentTank.rows[0].product_master_id) {
            return res.status(400).json({
                error: {
                    code: 'INVALID_PIM_ASSIGNMENT',
                    message: 'Use the protected PIM tank assignment workflow to assign a library-linked tank to an exhibit.',
                },
            });
        }
        if (exhibit_id) {
            const targetExhibit = await (0, db_1.query)('SELECT id FROM exhibits WHERE id=$1 AND project_id=$2', [exhibit_id, currentTank.rows[0].project_id]);
            if (!targetExhibit.rows[0]) {
                return res.status(400).json({
                    error: { code: 'INVALID_PROJECT', message: 'The selected exhibit does not belong to this tank project.' },
                });
            }
        }
        const client = await db_1.default.connect();
        try {
            await client.query('BEGIN');
            if (replace_tank_id) {
                if (String(replace_tank_id) === String(req.params.id)) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        error: { code: 'INVALID_REPLACEMENT', message: 'A tank cannot replace itself.' },
                    });
                }
                const replacement = await client.query(`SELECT id
           FROM tanks
           WHERE id=$1 AND project_id=$2 AND exhibit_id=$3
           FOR UPDATE`, [replace_tank_id, currentTank.rows[0].project_id, exhibit_id]);
                if (!replacement.rows[0]) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({
                        error: { code: 'REPLACEMENT_TANK_NOT_FOUND', message: 'The tank being replaced is no longer assigned to this exhibit.' },
                    });
                }
                await client.query('UPDATE tanks SET exhibit_id=NULL, updated_at=NOW() WHERE id=$1', [replace_tank_id]);
            }
            const result = await client.query('UPDATE tanks SET exhibit_id=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [exhibit_id || null, req.params.id]);
            if (!result.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
            }
            await client.query('COMMIT');
            res.json(result.rows[0]);
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    catch (error) {
        if (error?.code === '23505' && error?.constraint === 'idx_tanks_pim_assignment') {
            return res.status(409).json({
                error: { code: 'DUPLICATE_ASSIGNMENT', message: 'This PIM tank is already assigned to the exhibit.' },
            });
        }
        throw error;
    }
});
router.delete('/tanks/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    await (0, db_1.query)('DELETE FROM tank_instances WHERE tank_id=$1', [req.params.id]);
    const result = await (0, db_1.query)('DELETE FROM tanks WHERE id=$1 RETURNING id, tank_code', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank not found' } });
    res.json({ deleted: true });
});
router.patch('/tank-instances/:id', auth_1.authenticate, async (req, res) => {
    const { tag, display_name, exhibit_id } = req.body;
    if (tag !== undefined && (!tag || !tag.trim()))
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'tag cannot be empty' } });
    const result = await (0, db_1.query)(`UPDATE tank_instances SET
      tag = COALESCE($1, tag),
      display_name = $2,
      exhibit_id = $3
    WHERE id=$4 RETURNING *`, [tag ? tag.trim().toUpperCase() : null, display_name || null, exhibit_id || null, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank instance not found' } });
    res.json(result.rows[0]);
});
// SYSTEMS
router.get('/systems', auth_1.authenticate, async (req, res) => {
    const { page, page_size, offset } = paginate(req);
    const filters = [];
    const params = [];
    if (req.query.project_id) {
        params.push(req.query.project_id);
        filters.push(`s.project_id = $${params.length}`);
    }
    if (req.query.status) {
        params.push(req.query.status);
        filters.push(`s.status = $${params.length}`);
    }
    if (req.query.include_historical !== 'true' && !req.query.status) {
        filters.push(`s.status NOT IN ('Archived', 'Decommissioned', 'Superseded')`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countRes = await (0, db_1.query)(`SELECT COUNT(*) FROM systems s ${where}`, params);
    params.push(page_size, offset);
    const result = await (0, db_1.query)(`SELECT s.*, a.area_name, e.exhibit_name, p.project_code FROM systems s LEFT JOIN areas a ON s.area_id=a.id LEFT JOIN exhibits e ON s.exhibit_id=e.id JOIN projects p ON s.project_id=p.id ${where} ORDER BY s.system_code LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({
        items: result.rows.map(withoutStaleLinkedSystemFlow),
        pagination: { page, page_size, total: parseInt(countRes.rows[0].count) },
    });
});
router.get('/systems/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT s.*, a.area_name, e.exhibit_name, p.project_code, p.project_name,
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
     WHERE s.id::text=$1 OR s.system_code=$1`, [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    const sysId = result.rows[0].id;
    const [equipment, tanks, sideStreams, fractionatorAllocations, sandFilterAllocations] = await Promise.all([
        (0, db_1.query)(`SELECT pei.*, pm.product_code, pm.product_name, c.component_code, c.component_name,
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
        (0, db_1.query)(`SELECT t.id, t.tank_code, t.tank_name, t.tank_type, t.quantity,
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
router.get('/systems/:id/fractionator-products', auth_1.authenticate, async (req, res) => {
    const system = await (0, db_1.query)('SELECT id FROM systems WHERE id=$1', [req.params.id]);
    if (!system.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    const result = await (0, db_1.query)(`SELECT pm.id, pm.product_code, pm.product_name, pm.standard_status, pd.diameter_mm
     FROM product_masters pm
     JOIN product_families pf ON pf.id=pm.product_family_id
     LEFT JOIN product_dimensions pd ON pd.product_master_id=pm.id
     WHERE pf.product_family_code='PFM-FF' AND COALESCE(pm.status, 'Active')='Active'
     ORDER BY pm.product_code`);
    res.json({ items: result.rows });
});
router.get('/systems/:id/sand-filter-products', auth_1.authenticate, async (req, res) => {
    const system = await (0, db_1.query)('SELECT id FROM systems WHERE id=$1', [req.params.id]);
    if (!system.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    const result = await (0, db_1.query)(`SELECT pm.id, pm.product_code, pm.product_name, pm.standard_status, pd.diameter_mm
     FROM product_masters pm
     JOIN product_families pf ON pf.id=pm.product_family_id
     LEFT JOIN product_dimensions pd ON pd.product_master_id=pm.id
     WHERE pf.product_family_code='PFM-SF' AND COALESCE(pm.status, 'Active')='Active'
     ORDER BY pm.product_code`);
    res.json({ items: result.rows });
});
router.post('/systems', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const client = await db_1.default.connect();
    try {
        const { system_code, project_id, area_id, exhibit_id, system_name, system_type, design_flow_m3h, turnover_rate_hr, design_flow_source, turnover_source, water_type, status, duty_description, redundancy_strategy, } = req.body;
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
            const exhibitResult = await client.query('SELECT id, project_id, exhibit_code, water_type FROM exhibits WHERE id=$1 FOR SHARE', [exhibit_id]);
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
            if (!(0, aquariumCalculations_1.compatibleWaterTypes)(water_type, exhibit.water_type)) {
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
        const result = await client.query(`INSERT INTO systems
         (system_code, project_id, area_id, exhibit_id, system_name, system_type,
          design_flow_m3h, turnover_rate_hr, water_type, status, duty_description,
          redundancy_strategy, system_config, calculation_version, last_calculated_at, calculation_inputs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,$13,NOW(),$14)
       RETURNING *`, [
            system_code, project_id, area_id || null, exhibit_id || null, system_name, system_type,
            resolvedDesignFlowSource === 'manual_override' ? design_flow_m3h || null : null,
            resolvedTurnoverSource === 'manual_override' ? turnover_rate_hr || null : null,
            water_type, status || 'Draft', duty_description || null, redundancy_strategy || null,
            aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION,
            JSON.stringify({
                design_flow_source: resolvedDesignFlowSource,
                turnover_source: resolvedTurnoverSource,
                turnover_unit: 'cycles_per_hour',
                flow_unit: 'm3_per_hour',
            }),
        ]);
        if (exhibit_id) {
            await client.query(`INSERT INTO system_exhibit_links
           (system_id, exhibit_id, link_type, flow_allocation_m3h, notes, sort_order, allocation_source, allocation_updated_at)
         VALUES ($1,$2,'Primary',NULL,NULL,0,'calculated',NOW())`, [result.rows[0].id, exhibit_id]);
        }
        await client.query('COMMIT');
        await (0, audit_1.logAudit)(req.user.id, 'system', result.rows[0].id, 'CREATE', {
            summary: `System ${system_code} created`,
            system_code,
            system_name,
            system_type,
            exhibit_id: exhibit_id || null,
        });
        res.status(201).json(result.rows[0]);
    }
    catch (err) {
        await client.query('ROLLBACK');
        if (err.code === '23505') {
            return res.status(409).json({ error: { code: 'CONFLICT', message: `System code "${req.body.system_code}" already exists in this project. Use a different code.` } });
        }
        throw err;
    }
    finally {
        client.release();
    }
});
router.put('/systems/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    try {
        const { system_code, system_name, system_type, design_flow_m3h, turnover_rate_hr, design_flow_source, turnover_source, water_type, status, duty_description, redundancy_strategy, loop1_flow_source, loop1_filtration, loop1_flow_pct, loop1_bio_degas_pct, loop1_bio_degas_m3h, loop1_link_bio_degas, loop2_flow_source, loop2_filtration, loop2_flow_pct, loop2_bio_degas_pct, loop2_bio_degas_m3h, loop2_link_bio_degas, loop3_flow_source, loop3_filtration, loop3_flow_pct, loop3_bio_degas_pct, loop3_bio_degas_m3h, loop3_link_bio_degas, loop1_name, loop2_name, loop3_name, side_streams, fractionator_allocations, sand_filter_allocations, system_config, compact_unit_id, design_book_id, } = req.body;
        let normalizedSideStreams = null;
        try {
            normalizedSideStreams = normalizeSideStreams(side_streams);
        }
        catch (error) {
            return res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
        }
        for (const [loopNumber, name] of [[1, loop1_name], [2, loop2_name], [3, loop3_name]]) {
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
        ]) {
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
        ]) {
            if (value != null && value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) {
                return res.status(400).json({
                    error: { code: 'VALIDATION', message: `${label} must be between 0% and 100%.` },
                });
            }
        }
        const currentResult = await (0, db_1.query)('SELECT * FROM systems WHERE id=$1', [req.params.id]);
        if (!currentResult.rows[0])
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
        if ((0, systemLifecycle_1.isRetiredSystem)(currentResult.rows[0])) {
            return res.status(409).json({ error: (0, systemLifecycle_1.systemLifecycleError)(currentResult.rows[0]) });
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
        const resolvedPercentage = (field, value) => Object.prototype.hasOwnProperty.call(req.body, field)
            ? (value === '' || value == null ? null : Number(value))
            : (currentSystem[field] == null ? null : Number(currentSystem[field]));
        const resolvedLoop1FlowPct = resolvedPercentage('loop1_flow_pct', loop1_flow_pct);
        const resolvedLoop1BioPct = resolvedPercentage('loop1_bio_degas_pct', loop1_bio_degas_pct);
        const resolvedLoop2FlowPct = resolvedPercentage('loop2_flow_pct', loop2_flow_pct);
        const resolvedLoop2BioPct = resolvedPercentage('loop2_bio_degas_pct', loop2_bio_degas_pct);
        const resolvedLoop3FlowPct = resolvedPercentage('loop3_flow_pct', loop3_flow_pct);
        const resolvedLoop3BioPct = resolvedPercentage('loop3_bio_degas_pct', loop3_bio_degas_pct);
        const intendedSystem = {
            ...currentSystem,
            design_flow_m3h: Object.prototype.hasOwnProperty.call(req.body, 'design_flow_m3h')
                ? (design_flow_m3h === '' || design_flow_m3h == null ? null : Number(design_flow_m3h))
                : currentSystem.design_flow_m3h,
            loop1_filtration: Object.prototype.hasOwnProperty.call(req.body, 'loop1_filtration') ? loop1_filtration : currentSystem.loop1_filtration,
            loop2_filtration: Object.prototype.hasOwnProperty.call(req.body, 'loop2_filtration') ? loop2_filtration : currentSystem.loop2_filtration,
            loop3_filtration: Object.prototype.hasOwnProperty.call(req.body, 'loop3_filtration') ? loop3_filtration : currentSystem.loop3_filtration,
            loop1_flow_pct: resolvedLoop1FlowPct,
            loop2_flow_pct: resolvedLoop2FlowPct,
            loop3_flow_pct: resolvedLoop3FlowPct,
        };
        let normalizedFractionators = null;
        let normalizedSandFilters = null;
        try {
            normalizedFractionators = await normalizeFractionatorAllocations(fractionator_allocations, intendedSystem);
            normalizedSandFilters = await normalizeSandFilterAllocations(sand_filter_allocations, intendedSystem);
        }
        catch (error) {
            return res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
        }
        const loopAllocationTotal = [
            resolvedLoop1FlowPct,
            resolvedLoop2FlowPct,
            resolvedLoop3FlowPct,
        ].reduce((sum, value) => sum + (value ?? 0), 0);
        if (loopAllocationTotal > 100.000001) {
            return res.status(400).json({
                error: {
                    code: 'FLOW_ALLOCATION_EXCEEDS_100',
                    message: `Active loop allocations total ${loopAllocationTotal.toFixed(1)}%. Reduce them to 100% or less before saving.`,
                },
            });
        }
        const intendedWaterType = water_type || currentResult.rows[0].water_type;
        const foamLoops = [1, 2, 3].filter(loopNumber => intendedSystem[`loop${loopNumber}_filtration`] === 'Foam Fractionation');
        if (foamLoops.length && !['Marine', 'Salt Water'].includes(String(intendedWaterType))) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION',
                    message: `Foam Fractionation is only available for Marine or Salt Water systems (Loop${foamLoops.length > 1 ? 's' : ''} ${foamLoops.join(', ')}).`,
                },
            });
        }
        const linkedWaterTypes = await (0, db_1.query)(`SELECT e.exhibit_code, e.water_type
       FROM system_exhibit_links sel
       JOIN exhibits e ON e.id=sel.exhibit_id
       WHERE sel.system_id=$1`, [req.params.id]);
        const incompatibleLink = linkedWaterTypes.rows.find((link) => !(0, aquariumCalculations_1.compatibleWaterTypes)(intendedWaterType, link.water_type));
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
            const designBookResult = await (0, db_1.query)('SELECT id FROM design_books WHERE id=$1 AND project_id=$2', [design_book_id, currentResult.rows[0].project_id]);
            if (!designBookResult.rows[0]) {
                return res.status(409).json({
                    error: { code: 'DESIGN_BOOK_CONTEXT_MISMATCH', message: 'The Design Book must belong to the same project as the system.' },
                });
            }
            const unitResult = await (0, db_1.query)('SELECT * FROM lss_compact_units WHERE id=$1', [resolvedCompactUnitId]);
            const unit = unitResult.rows[0];
            if (!unit)
                return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Compact unit not found.' } });
            if (unit.status !== 'Active') {
                return res.status(409).json({ error: { code: 'INCOMPATIBLE_COMPACT_UNIT', message: `Compact unit is ${unit.status.toLowerCase()} and cannot be selected.` } });
            }
            if (!(0, aquariumCalculations_1.compatibleWaterTypes)(intendedWaterType, unit.water_type)) {
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
            const linkedExhibitsResult = await (0, db_1.query)(`SELECT e.*
           FROM system_exhibit_links sel
           JOIN exhibits e ON e.id=sel.exhibit_id
           WHERE sel.system_id=$1`, [req.params.id]);
            const linkedExhibits = linkedExhibitsResult.rows;
            const exhibitIds = linkedExhibits.map((item) => item.id);
            if (exhibitIds.length > 0) {
                const [tankResult, hydraulicResult, substrateResult] = await Promise.all([
                    (0, db_1.query)('SELECT * FROM tanks WHERE exhibit_id = ANY($1::uuid[])', [exhibitIds]),
                    (0, db_1.query)('SELECT * FROM design_book_exhibit_hydraulics WHERE design_book_id=$1 AND exhibit_id = ANY($2::uuid[])', [design_book_id, exhibitIds]),
                    (0, db_1.query)('SELECT * FROM design_book_exhibit_substrate WHERE design_book_id=$1 AND exhibit_id = ANY($2::uuid[])', [design_book_id, exhibitIds]),
                ]);
                const calculations = linkedExhibits.map((linkedExhibit) => (0, aquariumCalculations_1.calculateExhibitHydraulics)(linkedExhibit, tankResult.rows.filter((item) => item.exhibit_id === linkedExhibit.id), hydraulicResult.rows.find((item) => item.exhibit_id === linkedExhibit.id), substrateResult.rows.find((item) => item.exhibit_id === linkedExhibit.id)));
                const invalidCalculation = calculations.find((item) => item.status === 'invalid');
                if (invalidCalculation) {
                    return res.status(409).json({
                        error: { code: 'INVALID_ENGINEERING_INPUTS', message: invalidCalculation.reasons.join(' ') },
                    });
                }
                const effectiveVolume = calculations.reduce((sum, item) => sum + (item.results.operating_volume_m3 || 0), 0);
                const calculatedFlow = calculations.reduce((sum, item) => sum + (item.results.total_return_flow_m3h || 0), 0);
                const suitability = (0, aquariumCalculations_1.evaluateCompactUnit)(unit, intendedWaterType, effectiveVolume, Number.isFinite(intendedFlow) && intendedFlow > 0 ? intendedFlow : calculatedFlow);
                if (!suitability.suitable) {
                    return res.status(409).json({
                        error: { code: 'INCOMPATIBLE_COMPACT_UNIT', message: suitability.reasons.join(' ') },
                    });
                }
            }
        }
        const saveClient = await db_1.default.connect();
        let result;
        let namedSystem;
        let existingSideStreams = [];
        let savedSideStreams = [];
        let savedFractionators = [];
        let savedSandFilters = [];
        try {
            await saveClient.query('BEGIN');
            result = await saveClient.query(`UPDATE systems SET
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
       RETURNING *`, [
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
                aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION,
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
            const sideStreamQuery = saveClient.query.bind(saveClient);
            existingSideStreams = await loadSystemSideStreams(String(req.params.id), sideStreamQuery);
            const namedResult = await saveClient.query(`UPDATE systems SET
           loop1_name=$2, loop2_name=$3, loop3_name=$4, updated_at=NOW()
         WHERE id=$1
           AND status NOT IN ('Archived','Decommissioned','Superseded')
         RETURNING *`, [
                req.params.id,
                loop1_name == null ? (currentSystem.loop1_name || 'Loop 1') : String(loop1_name).trim(),
                loop2_name == null ? (currentSystem.loop2_name || 'Loop 2') : String(loop2_name).trim(),
                loop3_name == null ? (currentSystem.loop3_name || 'Loop 3') : String(loop3_name).trim(),
            ]);
            namedSystem = namedResult.rows[0] || namedSystem;
            if (normalizedSideStreams) {
                // Validate any UV revision assignments are Approved and from an eligible catalog.
                const uvRevisionIds = normalizedSideStreams
                    .map(s => s.uv_revision_id)
                    .filter(Boolean);
                if (uvRevisionIds.length > 0) {
                    const eligibleCheck = await saveClient.query(`SELECT r.id FROM uv_engineering_revisions r
              JOIN uv_engineering_catalogs c ON c.id=r.catalog_id
              JOIN product_masters pm ON pm.id=c.product_master_id
              JOIN product_families pf ON pf.id=pm.product_family_id
             WHERE r.id = ANY($1::uuid[]) AND r.status='Approved'
               AND c.needs_review=false AND pm.status='Active'
               AND pf.product_family_code='PFM-UV'`, [uvRevisionIds]);
                    const eligibleIds = new Set(eligibleCheck.rows.map((r) => r.id));
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
                const existingIds = new Set(existing.map((stream) => String(stream.id)));
                const requestedIds = new Set(normalizedSideStreams.filter(stream => stream.id && existingIds.has(stream.id)).map(stream => stream.id));
                for (const stream of existing) {
                    if (!requestedIds.has(String(stream.id))) {
                        await saveClient.query('DELETE FROM system_flow_side_streams WHERE id=$1 AND system_id=$2', [stream.id, req.params.id]);
                    }
                }
                for (const stream of normalizedSideStreams) {
                    if (stream.id && existingIds.has(stream.id)) {
                        await saveClient.query(`UPDATE system_flow_side_streams
               SET parent_loop_number=$3, name=$4, preset=$5, flow_pct=$6, notes=$7,
                   sort_order=$8, uv_revision_id=$9, uv_unit_quantity=$10,
                   has_dedicated_pump=COALESCE($11,has_dedicated_pump), updated_at=NOW()
               WHERE id=$1 AND system_id=$2`, [stream.id, req.params.id, stream.parent_loop_number, stream.name, stream.preset,
                            stream.flow_pct, stream.notes, stream.sort_order,
                            stream.uv_revision_id ?? null, stream.uv_unit_quantity ?? null,
                            stream.has_dedicated_pump]);
                    }
                    else {
                        await saveClient.query(`INSERT INTO system_flow_side_streams
                 (system_id, parent_loop_number, name, preset, flow_pct, notes, sort_order,
                  uv_revision_id, uv_unit_quantity, has_dedicated_pump)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [req.params.id, stream.parent_loop_number, stream.name, stream.preset,
                            stream.flow_pct, stream.notes, stream.sort_order,
                            stream.uv_revision_id ?? null, stream.uv_unit_quantity ?? null,
                            stream.has_dedicated_pump ?? false]);
                    }
                }
            }
            savedSideStreams = await loadSystemSideStreams(String(req.params.id), sideStreamQuery);
            if (normalizedFractionators) {
                await saveClient.query('DELETE FROM system_flow_fractionator_allocations WHERE system_id=$1', [req.params.id]);
                for (const allocation of normalizedFractionators) {
                    await saveClient.query(`INSERT INTO system_flow_fractionator_allocations
               (system_id, parent_loop_number, process_rate_ls_m2, notes, products, calculation_status)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6)`, [req.params.id, allocation.parent_loop_number, allocation.process_rate_ls_m2,
                        allocation.notes, JSON.stringify(allocation.products), allocation.calculation_status]);
                }
            }
            if (normalizedSandFilters) {
                await saveClient.query('DELETE FROM system_flow_sand_filter_allocations WHERE system_id=$1', [req.params.id]);
                for (const allocation of normalizedSandFilters) {
                    await saveClient.query(`INSERT INTO system_flow_sand_filter_allocations
               (system_id, parent_loop_number, process_rate_ls_m2, notes, products, calculation_status)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6)`, [req.params.id, allocation.parent_loop_number, allocation.process_rate_ls_m2,
                        allocation.notes, JSON.stringify(allocation.products), allocation.calculation_status]);
                }
            }
            savedFractionators = await loadSystemFractionatorAllocations(String(req.params.id), sideStreamQuery);
            savedSandFilters = await loadSystemSandFilterAllocations(String(req.params.id), sideStreamQuery);
            await saveClient.query('COMMIT');
        }
        catch (error) {
            await saveClient.query('ROLLBACK');
            throw error;
        }
        finally {
            saveClient.release();
        }
        const auditShape = (stream) => ({
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
        await (0, audit_1.logAudit)(req.user.id, 'system', String(req.params.id), 'UPDATE', {
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
    }
    catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: { code: 'CONFLICT', message: 'A system with that code already exists in this project.' } });
        }
        throw err;
    }
});
// Reset contract: only LSS-owned inputs are cleared. Project tanks, exhibits,
// Design Book exhibit hydraulics/substrate, and reusable PIM records are never
// deleted or updated by this transaction.
router.post('/systems/:id/configuration-reset', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const designBookId = req.body?.design_book_id;
    if (!designBookId) {
        return res.status(400).json({
            error: { code: 'INVALID_REQUEST', message: 'design_book_id is required.' },
        });
    }
    const client = await db_1.default.connect();
    try {
        await client.query('BEGIN');
        const systemResult = await client.query('SELECT * FROM systems WHERE id=$1 FOR UPDATE', [req.params.id]);
        const lockedSystem = systemResult.rows[0];
        if (!lockedSystem) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'System not found.' },
            });
        }
        const designBookResult = await client.query(`SELECT id, status FROM design_books
       WHERE id=$1 AND project_id=$2
       FOR UPDATE`, [designBookId, lockedSystem.project_id]);
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
            || (0, systemLifecycle_1.isRetiredSystem)(lockedSystem)) {
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
        const resetResult = await client.query(`UPDATE systems SET
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
         loop1_link_bio_degas=false,
         loop2_name='Loop 2', loop2_flow_source=NULL, loop2_filtration=NULL,
         loop2_flow_pct=NULL, loop2_bio_degas_pct=NULL, loop2_bio_degas_m3h=NULL,
         loop2_link_bio_degas=false,
         loop3_name='Loop 3', loop3_flow_source=NULL, loop3_filtration=NULL,
         loop3_flow_pct=NULL, loop3_bio_degas_pct=NULL, loop3_bio_degas_m3h=NULL,
         loop3_link_bio_degas=false,
         updated_at=NOW()
       WHERE id=$1
       RETURNING *`, [req.params.id]);
        await client.query(`INSERT INTO audit_logs
         (entity_type, entity_id, action, actor_id, details, ip_address)
       VALUES ('system',$1,'RESET_CONFIGURATION',$2,$3,$4)`, [
            req.params.id,
            req.user.id,
            {
                summary: `LSS configuration reset for ${lockedSystem.system_code}`,
                design_book_id: designBookId,
                preserved: ['project tanks', 'exhibits', 'tank hydraulics', 'PIM source data'],
            },
            req.ip || null,
        ]);
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
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
});
router.get('/systems/:id/side-streams', auth_1.authenticate, async (req, res) => {
    const system = await (0, db_1.query)('SELECT id FROM systems WHERE id=$1', [req.params.id]);
    if (!system.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    res.json({ items: await loadSystemSideStreams(String(req.params.id)), presets: FLOW_SIDE_STREAM_PRESETS });
});
router.post('/systems/:id/side-streams', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    let stream;
    try {
        stream = normalizeSideStreams([req.body])?.[0];
    }
    catch (error) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
    }
    const client = await db_1.default.connect();
    let created;
    try {
        await client.query('BEGIN');
        const system = await client.query('SELECT * FROM systems WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!system.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
        }
        if ((0, systemLifecycle_1.isRetiredSystem)(system.rows[0])) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: (0, systemLifecycle_1.systemLifecycleError)(system.rows[0]) });
        }
        created = (await client.query(`INSERT INTO system_flow_side_streams
         (system_id, parent_loop_number, name, preset, flow_pct, notes, sort_order,
          has_dedicated_pump)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [req.params.id, stream.parent_loop_number, stream.name, stream.preset,
            stream.flow_pct, stream.notes, stream.sort_order,
            stream.has_dedicated_pump ?? false])).rows[0];
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
    await (0, audit_1.logAudit)(req.user.id, 'system', String(req.params.id), 'ADD_SIDE_STREAM', {
        summary: `${stream.name} side stream added to Loop ${stream.parent_loop_number}`,
        side_stream: created,
    });
    res.status(201).json(created);
});
router.put('/systems/:id/side-streams/:sideStreamId', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    let stream;
    try {
        stream = normalizeSideStreams([req.body])?.[0];
    }
    catch (error) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
    }
    const client = await db_1.default.connect();
    let previous;
    let updated;
    try {
        await client.query('BEGIN');
        const system = await client.query('SELECT * FROM systems WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!system.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
        }
        if ((0, systemLifecycle_1.isRetiredSystem)(system.rows[0])) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: (0, systemLifecycle_1.systemLifecycleError)(system.rows[0]) });
        }
        const current = await client.query('SELECT * FROM system_flow_side_streams WHERE id=$1 AND system_id=$2', [req.params.sideStreamId, req.params.id]);
        if (!current.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Side stream not found' } });
        }
        previous = current.rows[0];
        // Validate UV revision is approved and from an eligible catalog if provided.
        if (stream.uv_revision_id) {
            const revCheck = await client.query(`SELECT r.id FROM uv_engineering_revisions r
         JOIN uv_engineering_catalogs c ON c.id=r.catalog_id
         JOIN product_masters pm ON pm.id=c.product_master_id
         JOIN product_families pf ON pf.id=pm.product_family_id
         WHERE r.id=$1 AND r.status='Approved' AND c.needs_review=false
           AND pm.status='Active' AND pf.product_family_code='PFM-UV'`, [stream.uv_revision_id]);
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
        updated = (await client.query(`UPDATE system_flow_side_streams
       SET parent_loop_number=$3, name=$4, preset=$5, flow_pct=$6, notes=$7,
           sort_order=$8, uv_revision_id=$9, uv_unit_quantity=$10,
           has_dedicated_pump=COALESCE($11,has_dedicated_pump), updated_at=NOW()
       WHERE id=$1 AND system_id=$2 RETURNING *`, [req.params.sideStreamId, req.params.id, stream.parent_loop_number, stream.name,
            stream.preset, stream.flow_pct, stream.notes, stream.sort_order,
            stream.uv_revision_id ?? null, stream.uv_unit_quantity ?? null,
            stream.has_dedicated_pump])).rows[0];
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
    await (0, audit_1.logAudit)(req.user.id, 'system', String(req.params.id), 'UPDATE_SIDE_STREAM', {
        summary: `${stream.name} side stream updated`,
        before: previous,
        after: updated,
    });
    res.json(updated);
});
router.delete('/systems/:id/side-streams/:sideStreamId', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(req.params.id));
    if (!editable.system)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    if (editable.error)
        return res.status(409).json({ error: editable.error });
    const result = await (0, db_1.query)('DELETE FROM system_flow_side_streams WHERE id=$1 AND system_id=$2 RETURNING *', [req.params.sideStreamId, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Side stream not found' } });
    await (0, audit_1.logAudit)(req.user.id, 'system', String(req.params.id), 'DELETE_SIDE_STREAM', {
        summary: `${result.rows[0].name} side stream removed`,
        side_stream_id: req.params.sideStreamId,
    });
    res.json({ deleted: true, id: req.params.sideStreamId });
});
router.delete('/systems/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (_req, res) => {
    res.status(409).json({
        error: {
            code: 'PHYSICAL_DELETE_DISABLED',
            message: 'Life Support Systems are governed records. Archive/decommission or supersede the system instead.',
        },
    });
});
router.post('/systems/:id/archive', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
        return res.status(400).json({ error: { code: 'REASON_REQUIRED', message: 'A reason is required to archive/decommission an LSS.' } });
    }
    const client = await db_1.default.connect();
    try {
        await client.query('BEGIN');
        const current = await client.query('SELECT * FROM systems WHERE id=$1 FOR UPDATE', [req.params.id]);
        const system = current.rows[0];
        if (!system) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
        }
        if (!(0, lssSystems_1.isLifeSupportSystem)(system)) {
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
        const updated = await client.query(`UPDATE systems
         SET status='Decommissioned', lifecycle_reason=$2,
             lifecycle_changed_at=NOW(), lifecycle_changed_by=$3, updated_at=NOW()
         WHERE id=$1 RETURNING *`, [req.params.id, reason, req.user.id]);
        await client.query(`INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details, ip_address)
         VALUES ('system',$1,'ARCHIVE',$2,$3,$4)`, [req.params.id, req.user.id, {
                summary: `LSS ${system.system_code} archived/decommissioned`,
                reason,
                previous_status: system.status,
                new_status: 'Decommissioned',
                replacement_system_id: null,
            }, req.ip || null]);
        await client.query('COMMIT');
        res.json(updated.rows[0]);
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
});
router.post('/systems/:id/supersede', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
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
    const client = await db_1.default.connect();
    try {
        await client.query('BEGIN');
        const locked = await client.query('SELECT * FROM systems WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[req.params.id, replacementSystemId]]);
        const system = locked.rows.find((row) => String(row.id) === String(req.params.id));
        const replacement = locked.rows.find((row) => String(row.id) === replacementSystemId);
        if (!system || !replacement) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: !system ? 'System not found' : 'Replacement LSS not found' } });
        }
        if (!(0, lssSystems_1.isLifeSupportSystem)(system)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: { code: 'INVALID_SYSTEM_TYPE', message: 'Only a Life Support System can use the LSS lifecycle workflow.' } });
        }
        if (system.status === 'Superseded' && String(system.superseded_by_system_id) === replacementSystemId) {
            await client.query('COMMIT');
            return res.json(system);
        }
        if ((0, systemLifecycle_1.isRetiredSystem)(system)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: { code: 'INVALID_LIFECYCLE_TRANSITION', message: 'A retired LSS cannot be superseded without a governed restore workflow.' } });
        }
        if (String(system.project_id) !== String(replacement.project_id)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: { code: 'REPLACEMENT_PROJECT_MISMATCH', message: 'The replacement LSS must belong to the same project.' } });
        }
        if ((0, systemLifecycle_1.isRetiredSystem)(replacement)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: { code: 'INVALID_REPLACEMENT', message: 'The replacement LSS must be active and current.' } });
        }
        if (!(0, lssSystems_1.isLifeSupportSystem)(replacement)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: { code: 'INVALID_REPLACEMENT_TYPE', message: 'The replacement must be a Life Support System.' } });
        }
        if (replacement.supersedes_system_id && String(replacement.supersedes_system_id) !== String(system.id)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: { code: 'REPLACEMENT_IN_USE', message: 'The replacement LSS already supersedes another system.' } });
        }
        const updated = await client.query(`UPDATE systems
         SET status='Superseded', superseded_by_system_id=$2,
             lifecycle_reason=$3, lifecycle_changed_at=NOW(),
             lifecycle_changed_by=$4, updated_at=NOW()
         WHERE id=$1 RETURNING *`, [req.params.id, replacementSystemId, reason, req.user.id]);
        await client.query(`UPDATE systems SET supersedes_system_id=$1, updated_at=NOW()
         WHERE id=$2`, [req.params.id, replacementSystemId]);
        await client.query(`INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details, ip_address)
         VALUES ('system',$1,'SUPERSEDE',$2,$3,$4)`, [req.params.id, req.user.id, {
                summary: `LSS ${system.system_code} superseded by ${replacement.system_code}`,
                reason,
                previous_status: system.status,
                new_status: 'Superseded',
                replacement_system_id: replacementSystemId,
            }, req.ip || null]);
        await client.query('COMMIT');
        res.json({
            ...updated.rows[0],
            replacement_system_code: replacement.system_code,
            replacement_system_name: replacement.system_name,
        });
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
});
router.post('/systems/:id/duplicate', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const src = await (0, db_1.query)('SELECT * FROM systems WHERE id=$1', [req.params.id]);
    if (!src.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    const s = src.rows[0];
    if ((0, systemLifecycle_1.isRetiredSystem)(s)) {
        return res.status(409).json({ error: { code: 'SYSTEM_RETIRED', message: 'Retired LSS records cannot be duplicated as current systems.' } });
    }
    const newCode = `${s.system_code}-COPY`;
    const result = await (0, db_1.query)(`INSERT INTO systems (system_code, project_id, area_id, exhibit_id, system_name, system_type, design_flow_m3h, turnover_rate_hr, water_type, duty_description, redundancy_strategy)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [newCode, s.project_id, s.area_id, s.exhibit_id, `${s.system_name} (Copy)`, s.system_type, s.design_flow_m3h, s.turnover_rate_hr, s.water_type, s.duty_description, s.redundancy_strategy]);
    res.status(201).json(result.rows[0]);
});
// SYSTEM ↔ EXHIBIT LINKS
router.get('/systems/:id/exhibit-links', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT sel.*, e.exhibit_code, e.exhibit_name, e.water_type as exhibit_water_type
     FROM system_exhibit_links sel
     JOIN exhibits e ON sel.exhibit_id = e.id
     WHERE sel.system_id = $1
     ORDER BY sel.sort_order, e.exhibit_code`, [req.params.id]);
    res.json(result.rows);
});
router.post('/systems/:id/exhibit-links', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(req.params.id));
    if (!editable.system)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    if (editable.error)
        return res.status(409).json({ error: editable.error });
    const { exhibit_id, link_type, flow_allocation_m3h, notes, sort_order } = req.body;
    if (!exhibit_id)
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'exhibit_id is required' } });
    if (flow_allocation_m3h != null &&
        (!Number.isFinite(Number(flow_allocation_m3h)) || Number(flow_allocation_m3h) < 0)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Flow allocation must be a non-negative number.' } });
    }
    try {
        const ownership = await (0, db_1.query)(`SELECT s.project_id AS system_project_id, s.water_type AS system_water_type,
              e.project_id AS exhibit_project_id, e.water_type AS exhibit_water_type,
              e.exhibit_code
       FROM systems s CROSS JOIN exhibits e
       WHERE s.id=$1 AND e.id=$2`, [req.params.id, exhibit_id]);
        const candidate = ownership.rows[0];
        if (!candidate)
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System or exhibit not found.' } });
        if (candidate.system_project_id !== candidate.exhibit_project_id) {
            return res.status(409).json({ error: { code: 'OWNERSHIP_MISMATCH', message: 'The exhibit and system must belong to the same project.' } });
        }
        if (!(0, aquariumCalculations_1.compatibleWaterTypes)(candidate.system_water_type, candidate.exhibit_water_type)) {
            return res.status(409).json({
                error: {
                    code: 'INCOMPATIBLE_WATER_TYPE',
                    message: `${candidate.exhibit_code} uses ${candidate.exhibit_water_type} water and cannot be linked to a ${candidate.system_water_type} system.`,
                },
            });
        }
        const allocationSource = flow_allocation_m3h != null ? 'manual_override' : 'calculated';
        const result = await (0, db_1.query)(`INSERT INTO system_exhibit_links
         (system_id, exhibit_id, link_type, flow_allocation_m3h, notes, sort_order, allocation_source, allocation_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       RETURNING *`, [req.params.id, exhibit_id, link_type || 'Primary', flow_allocation_m3h ?? null, notes || null, sort_order ?? 0, allocationSource]);
        const enriched = await (0, db_1.query)(`SELECT sel.*, e.exhibit_code, e.exhibit_name, e.water_type as exhibit_water_type
       FROM system_exhibit_links sel JOIN exhibits e ON sel.exhibit_id = e.id WHERE sel.id = $1`, [result.rows[0].id]);
        res.status(201).json(enriched.rows[0]);
    }
    catch (err) {
        if (err.code === '23505')
            return res.status(409).json({ error: { code: 'CONFLICT', message: 'This exhibit is already linked to the system.' } });
        throw err;
    }
});
router.put('/systems/:id/exhibit-links/:linkId', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(req.params.id));
    if (!editable.system)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    if (editable.error)
        return res.status(409).json({ error: editable.error });
    const { link_type, flow_allocation_m3h, notes } = req.body;
    if (flow_allocation_m3h != null &&
        (!Number.isFinite(Number(flow_allocation_m3h)) || Number(flow_allocation_m3h) < 0)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: 'Flow allocation must be a non-negative number.' } });
    }
    const result = await (0, db_1.query)(`UPDATE system_exhibit_links
     SET link_type=$1, flow_allocation_m3h=$2, notes=$3,
         allocation_source=$4, allocation_updated_at=NOW()
     WHERE id=$5 AND system_id=$6 RETURNING *`, [link_type || 'Primary', flow_allocation_m3h ?? null, notes || null,
        flow_allocation_m3h != null ? 'manual_override' : 'calculated',
        req.params.linkId, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Link not found' } });
    const enriched = await (0, db_1.query)(`SELECT sel.*, e.exhibit_code, e.exhibit_name, e.water_type as exhibit_water_type
     FROM system_exhibit_links sel JOIN exhibits e ON sel.exhibit_id = e.id WHERE sel.id = $1`, [result.rows[0].id]);
    res.json(enriched.rows[0]);
});
router.delete('/systems/:id/exhibit-links/:linkId', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(req.params.id));
    if (!editable.system)
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    if (editable.error)
        return res.status(409).json({ error: editable.error });
    const result = await (0, db_1.query)('DELETE FROM system_exhibit_links WHERE id=$1 AND system_id=$2 RETURNING id', [req.params.linkId, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Link not found' } });
    res.json({ deleted: true });
});
// EQUIPMENT ITEMS (direct product-to-project/system relationship)
router.post('/equipment-items', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const { equip_code, project_id, system_id, product_master_id, component_id, description, quantity, unit, notes, status } = req.body;
    if (!equip_code || !project_id)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'equip_code and project_id are required' } });
    if (system_id) {
        const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(system_id));
        if (!editable.system)
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
        if (editable.error)
            return res.status(409).json({ error: editable.error });
    }
    try {
        const result = await (0, db_1.query)(`INSERT INTO project_equipment_items (equip_code, project_id, system_id, product_master_id, component_id, description, quantity, unit, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [equip_code.trim().toUpperCase(), project_id, system_id || null, product_master_id || null,
            component_id || null, description || null, quantity || 1, unit || 'EA', notes || null, status || 'Design']);
        if (system_id)
            await (0, audit_1.logAudit)(req.user.id, 'system', system_id, 'ADD_EQUIPMENT', {
                summary: `Equipment ${equip_code.trim().toUpperCase()} added to system`,
                equip_code: equip_code.trim().toUpperCase(),
                description,
                quantity,
                unit,
            });
        res.status(201).json(result.rows[0]);
    }
    catch (err) {
        if (err.code === '23505')
            return res.status(409).json({ error: { code: 'CONFLICT', message: 'Equipment code already exists in this project' } });
        throw err;
    }
});
router.put('/equipment-items/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const { equip_code, system_id, product_master_id, component_id, description, quantity, unit, notes, status } = req.body;
    const current = await (0, db_1.query)('SELECT system_id FROM project_equipment_items WHERE id=$1', [req.params.id]);
    if (!current.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment item not found' } });
    if (current.rows[0].system_id) {
        const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(current.rows[0].system_id));
        if (editable.error)
            return res.status(409).json({ error: editable.error });
    }
    if (system_id) {
        const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(system_id));
        if (!editable.system)
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
        if (editable.error)
            return res.status(409).json({ error: editable.error });
    }
    const result = await (0, db_1.query)(`UPDATE project_equipment_items SET equip_code=COALESCE($1,equip_code), system_id=$2, product_master_id=$3,
     component_id=$4, description=$5, quantity=$6, unit=$7, notes=$8, status=$9, updated_at=NOW()
     WHERE id=$10 RETURNING *`, [equip_code ? equip_code.trim().toUpperCase() : null, system_id || null, product_master_id || null,
        component_id || null, description || null, quantity || 1, unit || 'EA', notes || null, status || 'Design', req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment item not found' } });
    if (system_id)
        await (0, audit_1.logAudit)(req.user.id, 'system', system_id, 'UPDATE_EQUIPMENT', {
            summary: `Equipment ${result.rows[0].equip_code} updated`,
            equip_code: result.rows[0].equip_code,
            description,
            quantity,
            status,
        });
    res.json(result.rows[0]);
});
router.delete('/equipment-items/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const existing = await (0, db_1.query)('SELECT * FROM project_equipment_items WHERE id=$1', [req.params.id]);
    const item = existing.rows[0];
    if (item?.system_id) {
        const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(item.system_id));
        if (editable.error)
            return res.status(409).json({ error: editable.error });
    }
    const result = await (0, db_1.query)('DELETE FROM project_equipment_items WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment item not found' } });
    if (item?.system_id)
        await (0, audit_1.logAudit)(req.user.id, 'system', item.system_id, 'REMOVE_EQUIPMENT', {
            summary: `Equipment ${item.equip_code} removed from system`,
            equip_code: item.equip_code,
            description: item.description,
        });
    res.json({ success: true });
});
// EQUIPMENT INSTANCES (legacy - kept for reference only)
router.get('/equipment-instances', auth_1.authenticate, async (req, res) => {
    const { page, page_size, offset } = paginate(req);
    const filters = [];
    const params = [];
    if (req.query.project_id) {
        params.push(req.query.project_id);
        filters.push(`ei.project_id = $${params.length}`);
    }
    if (req.query.system_id) {
        params.push(req.query.system_id);
        filters.push(`ei.system_id = $${params.length}`);
    }
    if (req.query.status) {
        params.push(req.query.status);
        filters.push(`ei.status = $${params.length}`);
    }
    if (req.query.q) {
        params.push(`%${req.query.q}%`);
        filters.push(`(ei.equipment_code ILIKE $${params.length} OR ei.equipment_name ILIKE $${params.length})`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countRes = await (0, db_1.query)(`SELECT COUNT(*) FROM equipment_instances ei ${where}`, params);
    params.push(page_size, offset);
    const result = await (0, db_1.query)(`SELECT ei.*, s.system_code, s.system_name, pm.product_code, pm.product_name, p.project_code
     FROM equipment_instances ei LEFT JOIN systems s ON ei.system_id=s.id LEFT JOIN product_usages pu ON pu.equipment_instance_id=ei.id LEFT JOIN product_masters pm ON pu.product_master_id=pm.id JOIN projects p ON ei.project_id=p.id
     ${where} ORDER BY ei.equipment_code LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ items: result.rows, pagination: { page, page_size, total: parseInt(countRes.rows[0].count) } });
});
router.get('/equipment-instances/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT ei.*, s.system_code, s.system_name, pm.product_code, pm.product_name, p.project_code, p.project_name, m.material_name
     FROM equipment_instances ei LEFT JOIN systems s ON ei.system_id=s.id LEFT JOIN product_usages pu ON pu.equipment_instance_id=ei.id LEFT JOIN product_masters pm ON pu.product_master_id=pm.id JOIN projects p ON ei.project_id=p.id LEFT JOIN materials m ON ei.material_code=m.material_code
     WHERE ei.id::text=$1 OR ei.equipment_code=$1`, [req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment not found' } });
    const documents = await (0, db_1.query)(`SELECT d.*, u.first_name || ' ' || u.last_name as created_by_name FROM documents d LEFT JOIN users u ON d.created_by=u.id WHERE d.equipment_id=$1 ORDER BY d.document_type, d.document_code`, [result.rows[0].id]);
    res.json({ ...result.rows[0], documents: documents.rows });
});
router.post('/equipment-instances', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const { equipment_code, project_id, system_id, equipment_type, equipment_name, design_flow_m3h, design_head_m, power_kw, material_code, operational_duty, location_reference, product_master_id } = req.body;
    if (system_id) {
        const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(system_id));
        if (!editable.system)
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
        if (editable.error)
            return res.status(409).json({ error: editable.error });
    }
    const result = await (0, db_1.query)('INSERT INTO equipment_instances (equipment_code, project_id, system_id, equipment_type, equipment_name, design_flow_m3h, design_head_m, power_kw, material_code, operational_duty, location_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *', [equipment_code, project_id, system_id, equipment_type, equipment_name, design_flow_m3h, design_head_m, power_kw, material_code, operational_duty, location_reference]);
    const eq = result.rows[0];
    if (product_master_id && eq?.id) {
        await (0, db_1.query)('INSERT INTO product_usages (product_master_id, equipment_instance_id, project_id) VALUES ($1,$2,$3)', [product_master_id, eq.id, project_id]);
    }
    await (0, audit_1.logAudit)(req.user.id, 'equipment', eq.id, 'CREATE', {
        summary: `Equipment ${equipment_code} created`,
        equipment_code,
        equipment_name,
        equipment_type,
    });
    res.status(201).json(eq);
});
router.put('/equipment-instances/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const { equipment_name, equipment_type, design_flow_m3h, design_head_m, power_kw, material_code, status, operational_duty, serial_number, installation_date, commissioning_date } = req.body;
    const current = await (0, db_1.query)('SELECT system_id FROM equipment_instances WHERE id=$1', [req.params.id]);
    if (!current.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment not found' } });
    if (current.rows[0].system_id) {
        const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(current.rows[0].system_id));
        if (editable.error)
            return res.status(409).json({ error: editable.error });
    }
    const result = await (0, db_1.query)('UPDATE equipment_instances SET equipment_name=$1, equipment_type=$2, design_flow_m3h=$3, design_head_m=$4, power_kw=$5, material_code=$6, status=$7, operational_duty=$8, serial_number=$9, installation_date=$10, commissioning_date=$11, updated_at=NOW() WHERE id=$12 RETURNING *', [equipment_name, equipment_type, design_flow_m3h, design_head_m, power_kw, material_code, status, operational_duty, serial_number, installation_date, commissioning_date, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Equipment not found' } });
    await (0, audit_1.logAudit)(req.user.id, 'equipment', String(req.params.id), 'UPDATE', {
        summary: 'Equipment details updated',
        equipment_name,
        equipment_type,
        status,
        serial_number,
    });
    res.json(result.rows[0]);
});
// LIFECYCLE TRANSITIONS
router.post('/lifecycle/transition', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const { entity_type, entity_id, to_state, comment } = req.body;
    if (!entity_type || !entity_id || !to_state)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'entity_type, entity_id, to_state required' } });
    const table = entity_type === 'system' ? 'systems' : entity_type === 'equipment' ? 'equipment_instances' : entity_type === 'document' ? 'documents' : null;
    let from_state = null;
    if (table) {
        const current = await (0, db_1.query)(`SELECT status FROM ${table} WHERE id=$1`, [entity_id]);
        from_state = current.rows[0]?.status;
        await (0, db_1.query)(`UPDATE ${table} SET status=$1, updated_at=NOW() WHERE id=$2`, [to_state, entity_id]);
    }
    await (0, db_1.query)('INSERT INTO lifecycle_transitions (entity_type, entity_id, from_state, to_state, actor_id, comment) VALUES ($1,$2,$3,$4,$5,$6)', [entity_type, entity_id, from_state, to_state, req.user.id, comment]);
    await (0, audit_1.logAudit)(req.user.id, entity_type, entity_id, 'STATE_TRANSITION', {
        summary: `Status changed from ${from_state || 'Unknown'} → ${to_state}`,
        from: from_state,
        to: to_state,
        comment,
    });
    res.json({ success: true, from_state, to_state });
});
router.get('/lifecycle/:entity_type/:entity_id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT lt.*, u.first_name || \' \' || u.last_name as actor_name FROM lifecycle_transitions lt LEFT JOIN users u ON lt.actor_id=u.id WHERE lt.entity_type=$1 AND lt.entity_id=$2::uuid ORDER BY lt.transitioned_at ASC', [req.params.entity_type, req.params.entity_id]);
    res.json({ items: result.rows });
});
router.get('/audit/:entity_type/:entity_id', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT al.*, u.first_name || ' ' || u.last_name as actor_name, u.email as actor_email
     FROM audit_logs al LEFT JOIN users u ON al.actor_id=u.id
     WHERE al.entity_type=$1 AND al.entity_id=$2
     ORDER BY al.created_at DESC LIMIT 200`, [req.params.entity_type, req.params.entity_id]);
    res.json({ items: result.rows });
});
// CHANGE REQUESTS
router.get('/change-requests', auth_1.authenticate, async (req, res) => {
    let where = '', params = [];
    if (req.query.project_id) {
        params.push(req.query.project_id);
        where = `WHERE cr.project_id=$1`;
    }
    const result = await (0, db_1.query)(`SELECT cr.*, u.first_name || ' ' || u.last_name as requested_by_name FROM change_requests cr LEFT JOIN users u ON cr.requested_by=u.id ${where} ORDER BY cr.created_at DESC`, params);
    res.json({ items: result.rows });
});
router.post('/change-requests', auth_1.authenticate, async (req, res) => {
    const { project_id, title, change_reason, risk_level, affected_entities } = req.body;
    const change_code = `CR-${Date.now().toString(36).toUpperCase()}`;
    const result = await (0, db_1.query)('INSERT INTO change_requests (change_code, project_id, title, change_reason, risk_level, affected_entities, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [change_code, project_id, title, change_reason, risk_level || 'Medium', JSON.stringify(affected_entities || []), req.user.id]);
    res.status(201).json(result.rows[0]);
});
router.put('/change-requests/:id', auth_1.authenticate, async (req, res) => {
    const { status, title, change_reason, risk_level } = req.body;
    const result = await (0, db_1.query)('UPDATE change_requests SET status=$1, title=$2, change_reason=$3, risk_level=$4, updated_at=NOW() WHERE id=$5 RETURNING *', [status, title, change_reason, risk_level, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Change request not found' } });
    res.json(result.rows[0]);
});
// PROJECT PIPING ITEMS
router.get('/projects/:id/piping', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT ppi.*, pm.product_code, pm.product_name, pm.application_type,
            s.system_code, s.system_name
     FROM project_piping_items ppi
     LEFT JOIN product_masters pm ON ppi.product_master_id = pm.id
     LEFT JOIN systems s ON ppi.system_id = s.id
     WHERE ppi.project_id = $1
     ORDER BY ppi.piping_code`, [req.params.id]);
    res.json({ items: result.rows });
});
router.post('/piping-items', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const { piping_code, project_id, system_id, product_master_id, description, quantity, unit, notes, status } = req.body;
    if (!piping_code || !project_id)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'piping_code and project_id are required' } });
    if (system_id) {
        const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(system_id));
        if (!editable.system)
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
        if (editable.error)
            return res.status(409).json({ error: editable.error });
    }
    const result = await (0, db_1.query)(`INSERT INTO project_piping_items (piping_code, project_id, system_id, product_master_id, description, quantity, unit, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [piping_code.trim().toUpperCase(), project_id, system_id || null, product_master_id || null,
        description || null, quantity || 1, unit || 'EA', notes || null, status || 'Design']);
    res.status(201).json(result.rows[0]);
});
router.put('/piping-items/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const { description, quantity, unit, notes, status, system_id } = req.body;
    const current = await (0, db_1.query)('SELECT system_id FROM project_piping_items WHERE id=$1', [req.params.id]);
    if (!current.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Piping item not found' } });
    if (current.rows[0].system_id) {
        const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(current.rows[0].system_id));
        if (editable.error)
            return res.status(409).json({ error: editable.error });
    }
    if (system_id) {
        const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(system_id));
        if (!editable.system)
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
        if (editable.error)
            return res.status(409).json({ error: editable.error });
    }
    const result = await (0, db_1.query)(`UPDATE project_piping_items SET description=$1, quantity=$2, unit=$3, notes=$4, status=$5, system_id=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`, [description || null, quantity || 1, unit || 'EA', notes || null, status, system_id || null, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Piping item not found' } });
    res.json(result.rows[0]);
});
router.delete('/piping-items/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), (0, auth_1.requireModuleManage)('projects'), async (req, res) => {
    const current = await (0, db_1.query)('SELECT system_id FROM project_piping_items WHERE id=$1', [req.params.id]);
    if (current.rows[0]?.system_id) {
        const editable = await (0, systemLifecycle_1.loadEditableSystem)(db_1.query, String(current.rows[0].system_id));
        if (editable.error)
            return res.status(409).json({ error: editable.error });
    }
    await (0, db_1.query)('DELETE FROM project_piping_items WHERE id=$1', [req.params.id]);
    res.json({ success: true });
});
// BOM RELEASES
router.get('/projects/:id/bom-releases', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT br.*, u.first_name || ' ' || u.last_name as created_by_name,
            (SELECT COUNT(*) FROM bom_release_lines WHERE bom_release_id = br.id) as line_count
     FROM bom_releases br
     LEFT JOIN users u ON br.created_by = u.id
     WHERE br.project_id = $1
     ORDER BY br.created_at DESC`, [req.params.id]);
    res.json({ items: result.rows });
});
router.get('/bom-releases/:id', auth_1.authenticate, async (req, res) => {
    const release = await (0, db_1.query)(`SELECT br.*, u.first_name || ' ' || u.last_name as created_by_name
     FROM bom_releases br LEFT JOIN users u ON br.created_by=u.id
     WHERE br.id=$1`, [req.params.id]);
    if (!release.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'BOM Release not found' } });
    const lines = await (0, db_1.query)('SELECT * FROM bom_release_lines WHERE bom_release_id=$1 ORDER BY section, line_number', [req.params.id]);
    res.json({ ...release.rows[0], lines: lines.rows });
});
router.post('/bom-releases', auth_1.authenticate, async (req, res) => {
    const { project_id, title, revision, notes, include_sections } = req.body;
    if (!project_id)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'project_id is required' } });
    const sections = Array.isArray(include_sections) && include_sections.length > 0
        ? include_sections
        : ['Products', 'Tank', 'Piping'];
    const countResult = await (0, db_1.query)('SELECT COUNT(*) FROM bom_releases WHERE project_id=$1', [project_id]);
    const num = (parseInt(countResult.rows[0].count) + 1).toString().padStart(3, '0');
    const projResult = await (0, db_1.query)('SELECT project_code FROM projects WHERE id=$1', [project_id]);
    const projectCode = projResult.rows[0]?.project_code || 'PRJ';
    const release_code = `BOM-${projectCode}-${num}`;
    const result = await (0, db_1.query)(`INSERT INTO bom_releases (release_code, project_id, title, revision, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [release_code, project_id, title || `BOM Release ${num}`, revision || 'A', notes || null, req.user.id]);
    const releaseId = result.rows[0].id;
    let lineNum = 1;
    if (sections.includes('Products')) {
        const equipment = await (0, db_1.query)(`SELECT pei.equip_code as tag_code,
              COALESCE(pei.description, pm.product_name) as description,
              pm.product_code, pm.product_name, pei.quantity, pei.unit,
              s.system_code as system_ref, NULL as area_ref
       FROM project_equipment_items pei
       LEFT JOIN product_masters pm ON pei.product_master_id = pm.id
       LEFT JOIN systems s ON pei.system_id = s.id
       WHERE pei.project_id = $1
       ORDER BY pei.equip_code`, [project_id]);
        for (const row of equipment.rows) {
            await (0, db_1.query)(`INSERT INTO bom_release_lines (bom_release_id, section, line_number, tag_code, description, product_code, product_name, quantity, unit, system_ref, area_ref)
         VALUES ($1,'Products',$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [releaseId, lineNum++, row.tag_code, row.description, row.product_code, row.product_name, row.quantity, row.unit, row.system_ref, row.area_ref]);
        }
    }
    if (sections.includes('Tank')) {
        const tanks = await (0, db_1.query)(`SELECT t.tank_code as tag_code, t.tank_name as description,
              pm.product_code, pm.product_name, 1 as quantity, 'EA' as unit,
              NULL as system_ref, a.area_name as area_ref
       FROM tanks t
       LEFT JOIN product_masters pm ON t.product_master_id = pm.id
       LEFT JOIN areas a ON t.area_id = a.id
       WHERE t.project_id = $1
       ORDER BY t.tank_code`, [project_id]);
        for (const row of tanks.rows) {
            await (0, db_1.query)(`INSERT INTO bom_release_lines (bom_release_id, section, line_number, tag_code, description, product_code, product_name, quantity, unit, system_ref, area_ref)
         VALUES ($1,'Tank',$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [releaseId, lineNum++, row.tag_code, row.description, row.product_code, row.product_name, row.quantity, row.unit, row.system_ref, row.area_ref]);
        }
    }
    if (sections.includes('Piping')) {
        const piping = await (0, db_1.query)(`SELECT ppi.piping_code as tag_code, COALESCE(ppi.description, pm.product_name) as description,
              pm.product_code, pm.product_name, ppi.quantity, ppi.unit,
              s.system_code as system_ref, NULL as area_ref
       FROM project_piping_items ppi
       LEFT JOIN product_masters pm ON ppi.product_master_id = pm.id
       LEFT JOIN systems s ON ppi.system_id = s.id
       WHERE ppi.project_id = $1
       ORDER BY ppi.piping_code`, [project_id]);
        for (const row of piping.rows) {
            await (0, db_1.query)(`INSERT INTO bom_release_lines (bom_release_id, section, line_number, tag_code, description, product_code, product_name, quantity, unit, system_ref, area_ref)
         VALUES ($1,'Piping',$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [releaseId, lineNum++, row.tag_code, row.description, row.product_code, row.product_name, row.quantity, row.unit, row.system_ref, row.area_ref]);
        }
    }
    const final = await (0, db_1.query)('SELECT * FROM bom_releases WHERE id=$1', [releaseId]);
    res.status(201).json(final.rows[0]);
});
router.get('/projects/:id/items-for-po', auth_1.authenticate, async (req, res) => {
    const proj = await (0, db_1.query)('SELECT id FROM projects WHERE id::text = $1 OR project_code = $1', [req.params.id]);
    if (!proj.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
    const projectId = proj.rows[0].id;
    const equipment = await (0, db_1.query)(`WITH released_eq AS (
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
     ORDER BY s.system_code NULLS LAST, pei.equip_code`, [projectId]);
    const tanks = await (0, db_1.query)(`WITH released_tanks AS (
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
     ORDER BY t.tank_code`, [projectId]);
    res.json({ equipment: equipment.rows, tanks: tanks.rows });
});
router.post('/bom-releases/:id/issue', auth_1.authenticate, async (req, res) => {
    const { issued_date } = req.body;
    const result = await (0, db_1.query)(`UPDATE bom_releases SET status='Issued', issued_date=COALESCE($1::date, CURRENT_DATE), updated_at=NOW()
     WHERE id=$2 AND status='Draft' RETURNING *`, [issued_date || null, req.params.id]);
    if (!result.rows[0])
        return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'Release not found or already issued' } });
    res.json(result.rows[0]);
});
router.delete('/bom-releases/:id', auth_1.authenticate, async (req, res) => {
    const check = await (0, db_1.query)('SELECT status FROM bom_releases WHERE id=$1', [req.params.id]);
    if (!check.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'BOM Release not found' } });
    if (check.rows[0].status === 'Issued')
        return res.status(400).json({ error: { code: 'INVALID_STATE', message: 'Cannot delete an issued release' } });
    await (0, db_1.query)('DELETE FROM bom_releases WHERE id=$1', [req.params.id]);
    res.json({ success: true });
});
exports.default = router;
