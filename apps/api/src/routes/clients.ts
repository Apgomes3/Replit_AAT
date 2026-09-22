import { Router } from 'express';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage } from '../middleware/auth';
import { query, withTransaction } from '../db';

const router = Router();
router.use(authenticate, requireModuleAccess('business_development'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const required = (v: any, f: string) => typeof v === 'string' && v.trim() ? null : `${f} is required.`;
const normalizeAddress = (value: any) => typeof value === 'string' ? (value.trim() ? { display_name: value.trim() } : {}) : (value || {});

export function validateContacts(value: any) {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return 'contacts must be an array.';
  const seen = new Set<string>(); let primaries = 0;
  for (const [index, contact] of value.entries()) {
    if (!contact || required(contact.name, `contacts[${index}].name`)) return `contacts[${index}].name is required.`;
    if (required(contact.email, `contacts[${index}].email`) || !EMAIL.test(String(contact.email).trim())) return `contacts[${index}].email must be a valid email.`;
    const email = String(contact.email).trim().toLowerCase();
    if (seen.has(email)) return `Duplicate contact email: ${contact.email}.`;
    seen.add(email);
    if (contact.is_primary !== undefined && typeof contact.is_primary !== 'boolean') return `contacts[${index}].is_primary must be a boolean.`;
    if (contact.is_primary === true) primaries++;
  }
  return primaries > 1 ? 'Only one primary contact is allowed.' : null;
}

export function adaptLegacyContacts(body: any) {
  const fieldsPresent = ['contact_name', 'contact_email', 'contact_phone'].some(field => Object.prototype.hasOwnProperty.call(body || {}, field));
  if (!fieldsPresent) return { contacts: undefined, error: null };
  const name = typeof body.contact_name === 'string' ? body.contact_name.trim() : '';
  const email = typeof body.contact_email === 'string' ? body.contact_email.trim() : '';
  const phone = typeof body.contact_phone === 'string' ? body.contact_phone.trim() : '';
  if (!name || !email) return { contacts: undefined, error: 'Legacy contact_name and contact_email are both required when using legacy contact fields.' };
  return { contacts: [{ name, email, phone: phone || undefined, is_primary: true }], error: null };
}

function clientOutput(row: any, contacts: any[] = []) {
  const primary = contacts.find(c => c.is_primary) || contacts[0] || (
    row.primary_contact_name ? {
      name: row.primary_contact_name,
      email: row.primary_contact_email,
      phone: row.primary_contact_phone,
    } : (row.contact_name || row.contact_email || row.contact_phone || row.email || row.phone ? {
      name: row.contact_name || null,
      email: row.contact_email || row.email || null,
      phone: row.contact_phone || row.phone || null,
    } : null)
  );
  return {
    ...row,
    address: row.address?.display_name ?? row.address ?? '',
    active: row.active ?? row.status === 'active',
    contact_name: primary?.name ?? null,
    contact_email: primary?.email ?? null,
    contact_phone: primary?.phone ?? null,
    contact_count: row.contact_count == null ? contacts.length : Number(row.contact_count),
  };
}

export function normalizeContacts(contacts: any[]) {
  return contacts.map((c, i) => ({ ...c, is_primary: c.is_primary === true || (i === 0 && !contacts.some(x => x.is_primary)) }));
}

async function saveContacts(db: any, clientId: string, contacts: any[], userId: string) {
  await db.query('DELETE FROM client_contacts WHERE client_id=$1', [clientId]);
  const normalized = normalizeContacts(contacts);
  for (const c of normalized) {
    await db.query(`INSERT INTO client_contacts(client_id,name,email,phone,job_title,is_primary,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$7)`, [clientId, c.name.trim(), c.email.trim(), c.phone?.trim() || null, c.job_title?.trim() || null, c.is_primary, userId]);
  }
}

async function contactsFor(db: any, clientId: string) {
  return (await db.query('SELECT * FROM client_contacts WHERE client_id=$1 ORDER BY is_primary DESC, name, id', [clientId])).rows;
}

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const params: any[] = []; const where: string[] = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(c.name ILIKE $1 OR c.client_code ILIKE $1 OR EXISTS (SELECT 1 FROM client_contacts sc WHERE sc.client_id=c.id AND (sc.name ILIKE $1 OR sc.email ILIKE $1)))`);
    }
    const predicate = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const page = Math.max(1, Number(req.query.page) || 1), size = Math.min(200, Math.max(1, Number(req.query.page_size) || 25));
    const count = await query(`SELECT COUNT(*)::int AS count FROM clients c ${predicate}`, params);
    const rows = await query(`SELECT c.*, COUNT(DISTINCT e.id)::int AS enquiry_count,
      COUNT(DISTINCT cc.id)::int AS contact_count,
      pc.name AS primary_contact_name, pc.email AS primary_contact_email, pc.phone AS primary_contact_phone
      FROM clients c LEFT JOIN enquiries e ON e.client_id=c.id
      LEFT JOIN client_contacts cc ON cc.client_id=c.id
      LEFT JOIN client_contacts pc ON pc.client_id=c.id AND pc.is_primary
      ${predicate} GROUP BY c.id,pc.name,pc.email,pc.phone ORDER BY c.name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, (page - 1) * size]);
    res.json({ data: rows.rows.map(r => clientOutput(r)), pagination: { page, page_size: size, total: count.rows[0].count } });
  } catch (e) { next(e); }
});

router.post('/', requireModuleManage('business_development'), async (req: AuthRequest, res, next) => {
  try {
    const b = req.body || {}; const legacy = b.contacts === undefined ? adaptLegacyContacts(b) : { contacts: b.contacts, error: null };
    const error = required(b.name, 'name') || legacy.error || validateContacts(legacy.contacts);
    if (error) return res.status(400).json({ error: { code: 'VALIDATION', message: error } });
    const result = await withTransaction(async db => {
      const year = new Date().getUTCFullYear();
      await db.query(`INSERT INTO enquiry_number_counters(counter_key,next_value) VALUES ($1,2)
        ON CONFLICT (counter_key) DO UPDATE SET next_value=enquiry_number_counters.next_value+1`, [`client:${year}`]);
      const n = await db.query('SELECT next_value-1 AS value FROM enquiry_number_counters WHERE counter_key=$1 FOR UPDATE', [`client:${year}`]);
      const code = `CL-${year}-${String(n.rows[0].value).padStart(4, '0')}`;
      const inserted = await db.query(`INSERT INTO clients(client_code,name,legal_name,website,country,address,notes,active,status,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
        [code, b.name.trim(), b.legal_name || null, b.website || null, b.country || null, normalizeAddress(b.address), b.notes || null, b.active !== false, b.active === false ? 'inactive' : 'active', req.user!.id]);
      if (legacy.contacts?.length) await saveContacts(db, inserted.rows[0].id, legacy.contacts, req.user!.id);
      return clientOutput(inserted.rows[0], legacy.contacts || []);
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
    const contacts = await query('SELECT * FROM client_contacts WHERE client_id=$1 ORDER BY is_primary DESC, name, id', [clientId]);
    const enquiries = await query('SELECT * FROM enquiries WHERE client_id=$1 ORDER BY updated_at DESC', [clientId]);
    res.json({ ...clientOutput(client.rows[0], contacts.rows), contacts: contacts.rows, enquiries: enquiries.rows });
  } catch (e) { next(e); }
});

router.patch('/:id', requireModuleManage('business_development'), async (req: AuthRequest, res, next) => {
  try {
    const clientId = String(req.params.id); const b = req.body || {};
    if (!UUID.test(clientId)) return res.status(400).json({ error: { code: 'VALIDATION', message: 'id must be a valid UUID.' } });
    const legacy = b.contacts === undefined ? adaptLegacyContacts(b) : { contacts: b.contacts, error: null };
    const error = (b.name !== undefined ? required(b.name, 'name') : null) || legacy.error || (b.status !== undefined && !['active', 'inactive'].includes(b.status) ? 'status must be active or inactive.' : null) || (b.active !== undefined && typeof b.active !== 'boolean' ? 'active must be a boolean.' : null) || validateContacts(legacy.contacts);
    if (error) return res.status(400).json({ error: { code: 'VALIDATION', message: error } });
    const result = await withTransaction(async db => {
      const fields = ['name','legal_name','website','country','address','notes']; const set: string[] = []; const values: any[] = [clientId];
      for (const field of fields) if (b[field] !== undefined) { values.push(field === 'name' ? b[field].trim() : field === 'address' ? normalizeAddress(b[field]) : b[field]); set.push(`${field}=$${values.length}`); }
      if (b.active !== undefined) { values.push(b.active, b.active ? 'active' : 'inactive'); set.push(`active=$${values.length - 1}`, `status=$${values.length}`); }
      else if (b.status !== undefined) { values.push(b.status, b.status === 'active'); set.push(`status=$${values.length - 1}`, `active=$${values.length}`); }
      if (!set.length && legacy.contacts === undefined) throw Object.assign(new Error('At least one client field is required.'), { status: 400, code: 'VALIDATION' });
      let updated = (await db.query(`UPDATE clients SET ${set.length ? `${set.join(',')},` : ''} updated_by=$${values.length + 1},updated_at=NOW() WHERE id=$1 RETURNING *`, [...values, req.user!.id])).rows[0];
      if (!updated) throw Object.assign(new Error('Client not found.'), { status: 404, code: 'NOT_FOUND' });
      if (legacy.contacts !== undefined) await saveContacts(db, clientId, legacy.contacts, req.user!.id);
      const contacts = await contactsFor(db, clientId);
      return clientOutput(updated, contacts);
    });
    res.json(result);
  } catch (e: any) { if (e.status) return res.status(e.status).json({ error: { code: e.code, message: e.message } }); next(e); }
});

export default router;