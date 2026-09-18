import { Router } from 'express';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage } from '../middleware/auth';
import { query, withTransaction } from '../db';

const router = Router();
router.use(authenticate, requireModuleAccess('business_development'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const required = (v: any, f: string) => typeof v === 'string' && v.trim() ? null : `${f} is required.`;
const normalizeAddress = (value: any) => typeof value === 'string' ? (value.trim() ? { display_name: value.trim() } : {}) : (value || {});
const clientOutput = (row: any) => ({ ...row, address: row.address?.display_name ?? row.address ?? '', active: row.active ?? row.status === 'active' });
async function nextClientCode(db: any) {
  const year = new Date().getUTCFullYear();
  await db.query(`INSERT INTO enquiry_number_counters(counter_key,next_value) VALUES ($1,2)
    ON CONFLICT (counter_key) DO UPDATE SET next_value=enquiry_number_counters.next_value+1`, [`client:${year}`]);
  const row = await db.query('SELECT next_value-1 AS value FROM enquiry_number_counters WHERE counter_key=$1 FOR UPDATE', [`client:${year}`]);
  return `CL-${year}-${String(row.rows[0].value).padStart(4, '0')}`;
}
router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const params: any[] = []; const where: string[] = [];
    if (search) { params.push(`%${search}%`); where.push(`(name ILIKE $1 OR client_code ILIKE $1 OR email ILIKE $1)`); }
    const page = Math.max(1, Number(req.query.page) || 1), size = Math.min(200, Math.max(1, Number(req.query.page_size) || 25));
    const count = await query(`SELECT COUNT(*)::int AS count FROM clients ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, params);
    const rows = await query(`SELECT c.*, COUNT(e.id)::int AS enquiry_count FROM clients c LEFT JOIN enquiries e ON e.client_id=c.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} GROUP BY c.id ORDER BY c.name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, size, (page - 1) * size]);
    res.json({ data: rows.rows.map(clientOutput), pagination: { page, page_size: size, total: count.rows[0].count } });
  } catch (e) { next(e); }
});
router.post('/', requireModuleManage('business_development'), async (req: AuthRequest, res, next) => {
  try {
    const b = req.body || {}; const error = required(b.name, 'name'); if (error) return res.status(400).json({ error: { code: 'VALIDATION', message: error, field: 'name' } });
    const result = await withTransaction(async db => {
      const code = await nextClientCode(db);
      const inserted = await db.query(`INSERT INTO clients(client_code,name,legal_name,contact_name,contact_email,contact_phone,email,phone,website,country,address,notes,active,status,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
        [code, b.name.trim(), b.legal_name || null, b.contact_name || null, b.contact_email || null, b.contact_phone || null, b.website || null, b.country || null, normalizeAddress(b.address), b.notes || null, b.active !== false, b.active === false ? 'inactive' : 'active', req.user!.id]);
      return clientOutput(inserted.rows[0]);
    });
    res.status(201).json(result);
  } catch (e: any) { if (e.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'A client with these details already exists.' } }); next(e); }
});
router.get('/:id', async (req, res, next) => {
  try {
    const clientId = String(req.params.id);
    if (!UUID.test(clientId)) return res.status(400).json({ error: { code: 'VALIDATION', message: 'id must be a valid UUID.' } });
    const client = await query('SELECT * FROM clients WHERE id=$1', [clientId]);
    if (!client.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Client not found.' } });
    const enquiries = await query('SELECT * FROM enquiries WHERE client_id=$1 ORDER BY updated_at DESC', [clientId]);
    res.json({ ...clientOutput(client.rows[0]), enquiries: enquiries.rows });
  } catch (e) { next(e); }
});
router.patch('/:id', requireModuleManage('business_development'), async (req: AuthRequest, res, next) => {
  try {
    const clientId = String(req.params.id);
    if (!UUID.test(clientId)) return res.status(400).json({ error: { code: 'VALIDATION', message: 'id must be a valid UUID.' } });
    if (req.body?.name !== undefined && required(req.body.name, 'name')) return res.status(400).json({ error: { code: 'VALIDATION', message: 'name is required.', field: 'name' } });
    if (req.body?.status !== undefined && !['active', 'inactive'].includes(req.body.status)) return res.status(400).json({ error: { code: 'VALIDATION', message: 'status must be active or inactive.', field: 'status' } });
    if (req.body?.active !== undefined && typeof req.body.active !== 'boolean') return res.status(400).json({ error: { code: 'VALIDATION', message: 'active must be a boolean.', field: 'active' } });
    const fields = ['name','legal_name','contact_name','contact_email','contact_phone','email','phone','website','country','address','notes'];
    const set: string[] = [], values: any[] = [req.params.id];
    for (const field of fields) if (req.body?.[field] !== undefined) {
      let value = field === 'name' ? String(req.body[field]).trim() : req.body[field];
      if (field === 'address') value = normalizeAddress(value);
      if (field === 'active') { value = Boolean(value); set.push(`active=$${values.length + 1}`, `status=$${values.length + 2}`); values.push(value, value ? 'active' : 'inactive'); continue; }
      values.push(value); set.push(`${field}=$${values.length}`);
    }
    if (req.body?.active !== undefined) {
      values.push(req.body.active);
      set.push(`active=$${values.length}`);
      values.push(req.body.active ? 'active' : 'inactive');
      set.push(`status=$${values.length}`);
    } else if (req.body?.status !== undefined) {
      values.push(req.body.status);
      set.push(`status=$${values.length}`, `active=$${values.length + 1}`);
      values.push(req.body.status === 'active');
    }
    if (!set.length) return res.status(400).json({ error: { code: 'VALIDATION', message: 'At least one client field is required.' } });
    values.push(req.user!.id); set.push(`updated_by=$${values.length}`, 'updated_at=NOW()');
    const result = await query(`UPDATE clients SET ${set.join(',')} WHERE id=$1 RETURNING *`, values);
    if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Client not found.' } });
    res.json(clientOutput(result.rows[0]));
  } catch (e) { next(e); }
});
export default router;