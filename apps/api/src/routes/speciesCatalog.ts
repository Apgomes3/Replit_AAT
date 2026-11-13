import { Router, Response } from 'express';
import pool, { query } from '../db';
import { NextFunction } from 'express';
import { Pool, PoolConfig, QueryResult } from 'pg';
import {
  authenticate, AuthRequest, requireModuleAccess, requireModuleManage, requireRole,
} from '../middleware/auth';
import { logAudit } from '../db/audit';
import { EDITOR_ROLES } from '../lib/roles';

const router = Router();
const routeParam = (value: string | string[]) => Array.isArray(value) ? value[0] : value;

const WATER_TYPES = new Set(['Marine', 'Freshwater', 'Brackish', 'Universal']);
const CATALOG_QUERY_TIMEOUT_MS = 2_500;
export const catalogPoolOptions: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: CATALOG_QUERY_TIMEOUT_MS,
  statement_timeout: CATALOG_QUERY_TIMEOUT_MS,
  // The client-side timeout is deliberately longer than PostgreSQL's timeout,
  // allowing the server to cancel and release work before the client gives up.
  query_timeout: CATALOG_QUERY_TIMEOUT_MS + 500,
  max: 4,
};
const catalogPool = new Pool(catalogPoolOptions);

export class CatalogUnavailableError extends Error {
  code = 'CATALOG_UNAVAILABLE';
  status = 503;
  retryable = true;
}

export async function catalogQuery<T extends Record<string, unknown> = any>(
  text: string,
  values: any[] = [],
): Promise<QueryResult<T>> {
  try {
    return await catalogPool.query<T>(text, values);
  } catch (error: any) {
    if (error?.code === '57014' || /timeout|timed out/i.test(String(error?.message || ''))) {
      throw new CatalogUnavailableError('The species catalog took too long to respond. Please retry.');
    }
    throw new CatalogUnavailableError('The species catalog is temporarily unavailable. Please retry shortly.');
  }
}

async function ensureCatalogReady() {
  const result = await catalogQuery<{ table_name: string | null }>(
    `SELECT to_regclass('public.aquarium_species_catalog')::text AS table_name`,
  );
  if (!result.rows[0]?.table_name) {
    throw new CatalogUnavailableError(
      'The species catalog is not ready yet. Run the database migration, then retry.',
    );
  }
}

export function sendCatalogError(res: Response, error: unknown) {
  const unavailable = error instanceof CatalogUnavailableError;
  return res.status(unavailable ? error.status : 500).json({
    error: {
      code: unavailable ? error.code : 'CATALOG_ERROR',
      message: unavailable ? error.message : 'The species catalog could not be loaded. Please retry shortly.',
      retryable: unavailable,
    },
  });
}

async function requireCatalogReady(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await ensureCatalogReady();
    next();
  } catch (error) {
    sendCatalogError(res, error);
  }
}

router.use(authenticate, requireCatalogReady, requireModuleAccess('design_books'));

function text(value: unknown, label: string, required = false) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (required && !result) throw new Error(`${label} is required`);
  if (result.length > 255) throw new Error(`${label} must be 255 characters or fewer`);
  return result || null;
}

function measurement(value: unknown, label: string, required = false) {
  if (value === '' || value == null) {
    if (required) throw new Error(`${label} is required`);
    return null;
  }
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${label} must be greater than zero`);
  return result;
}

function catalogPayload(body: any) {
  const waterType = text(body.water_type, 'Water type', true)!;
  if (!WATER_TYPES.has(waterType)) throw new Error('Water type must be Marine, Freshwater, Brackish, or Universal');
  if (body.active !== undefined && typeof body.active !== 'boolean') {
    throw new Error('Active must be true or false');
  }
  return {
    scientific_name: text(body.scientific_name, 'Scientific name', true)!,
    common_name: text(body.common_name, 'Common name'),
    family: text(body.family, 'Family', true)!,
    water_type: waterType,
    average_size_cm: measurement(body.average_size_cm, 'Average size'),
    reference_average_mass_kg: measurement(body.reference_average_mass_kg, 'Reference average mass'),
    source: text(body.source, 'Source / provenance', true)!,
    active: body.active === undefined ? true : body.active,
  };
}

function errorMessage(error: any) {
  return error instanceof Error ? error.message : 'Unexpected catalog error';
}

router.get('/species-catalog/facets', async (_req: AuthRequest, res: Response) => {
  try {
    const [families, waterTypes] = await Promise.all([
      catalogQuery(`SELECT family, COUNT(*)::int AS count FROM aquarium_species_catalog WHERE active=true GROUP BY family ORDER BY family`),
      catalogQuery(`SELECT water_type, COUNT(*)::int AS count FROM aquarium_species_catalog WHERE active=true GROUP BY water_type ORDER BY water_type`),
    ]);
    res.json({ families: families.rows, water_types: waterTypes.rows });
  } catch (error) {
    sendCatalogError(res, error);
  }
});

router.get('/species-catalog', async (req: AuthRequest, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    const waterType = String(req.query.water_type || '').trim();
    const family = String(req.query.family || '').trim();
    const includeInactive = req.query.include_inactive === 'true';
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const params: any[] = [];
    const conditions: string[] = [];
    if (!includeInactive) conditions.push('active=true');
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(scientific_name ILIKE $${params.length} OR common_name ILIKE $${params.length} OR family ILIKE $${params.length})`);
    }
    if (waterType) { params.push(waterType); conditions.push(`water_type=$${params.length}`); }
    if (family) { params.push(family); conditions.push(`family=$${params.length}`); }
    params.push(limit, offset);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await catalogQuery(
      `SELECT *, COUNT(*) OVER()::int AS total_count
       FROM aquarium_species_catalog ${where}
       ORDER BY water_type, family, scientific_name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({
      items: result.rows.map(({ total_count, ...row }) => row),
      total: result.rows[0]?.total_count || 0,
      limit,
      offset,
    });
  } catch (error) {
    sendCatalogError(res, error);
  }
});

router.get('/species-catalog/:id', async (req: AuthRequest, res: Response) => {
  try {
    const result = await catalogQuery('SELECT * FROM aquarium_species_catalog WHERE id=$1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Species catalog record not found' } });
    res.json(result.rows[0]);
  } catch (error) {
    sendCatalogError(res, error);
  }
});

router.post('/species-catalog', requireRole(...EDITOR_ROLES), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  let payload: ReturnType<typeof catalogPayload>;
  try { payload = catalogPayload(req.body); } catch (error) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: errorMessage(error) } });
  }
  try {
    const result = await query(
      `INSERT INTO aquarium_species_catalog
         (scientific_name, common_name, family, water_type, average_size_cm,
          reference_average_mass_kg, source, active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
      [payload.scientific_name, payload.common_name, payload.family, payload.water_type,
        payload.average_size_cm, payload.reference_average_mass_kg, payload.source, payload.active, req.user!.id],
    );
    await logAudit(req.user!.id, 'aquarium_species_catalog', result.rows[0].id, 'CREATE', payload, req.ip);
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error?.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE_SCIENTIFIC_NAME', message: 'Scientific name already exists in the catalog.' } });
    throw error;
  }
});

router.put('/species-catalog/:id', requireRole(...EDITOR_ROLES), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  let payload: ReturnType<typeof catalogPayload>;
  try { payload = catalogPayload(req.body); } catch (error) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: errorMessage(error) } });
  }
  try {
    const result = await query(
      `UPDATE aquarium_species_catalog
       SET scientific_name=$1, common_name=$2, family=$3, water_type=$4,
           average_size_cm=$5, reference_average_mass_kg=$6, source=$7,
           active=$8, updated_by=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [payload.scientific_name, payload.common_name, payload.family, payload.water_type,
        payload.average_size_cm, payload.reference_average_mass_kg, payload.source, payload.active,
        req.user!.id, req.params.id],
    );
    if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Species catalog record not found' } });
    await logAudit(req.user!.id, 'aquarium_species_catalog', routeParam(req.params.id), 'UPDATE', payload, req.ip);
    res.json(result.rows[0]);
  } catch (error: any) {
    if (error?.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE_SCIENTIFIC_NAME', message: 'Scientific name already exists in the catalog.' } });
    throw error;
  }
});

router.post('/species-catalog/import', requireRole(...EDITOR_ROLES), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  const records = Array.isArray(req.body?.records) ? req.body.records : [];
  if (!records.length || records.length > 1000) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Import must contain between 1 and 1,000 records.' } });
  }
  const prepared: any[] = [];
  const names = new Set<string>();
  try {
    for (const record of records) {
      const payload = catalogPayload(record);
      const key = payload.scientific_name.toLowerCase();
      if (names.has(key)) throw new Error(`Duplicate scientific name in import: ${payload.scientific_name}`);
      names.add(key);
      prepared.push(payload);
    }
  } catch (error) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: errorMessage(error) } });
  }
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const payload of prepared) {
      const result = await client.query(
        `INSERT INTO aquarium_species_catalog
           (scientific_name, common_name, family, water_type, average_size_cm,
            reference_average_mass_kg, source, active, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
         ON CONFLICT DO NOTHING RETURNING id`,
        [payload.scientific_name, payload.common_name, payload.family, payload.water_type,
          payload.average_size_cm, payload.reference_average_mass_kg, payload.source, payload.active, req.user!.id],
      );
      inserted += result.rowCount || 0;
    }
    await client.query('COMMIT');
    await logAudit(req.user!.id, 'aquarium_species_catalog', 'import', 'IMPORT', {
      requested: records.length, inserted, skipped: records.length - inserted,
    }, req.ip);
    res.status(201).json({ requested: records.length, inserted, skipped: records.length - inserted });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

export default router;