import { Router } from 'express';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage } from '../middleware/auth';
import { query, withTransaction } from '../db';

const router = Router();
router.use(authenticate, requireModuleAccess('business_development'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = ['new','in_review','quoted','won','lost','closed'];
const flatContact = (body: any) => ({
  ...(body.contact_details && typeof body.contact_details === 'object' ? body.contact_details : {}),
  ...(body.contact_name !== undefined ? { name: body.contact_name } : {}),
  ...(body.contact_email !== undefined ? { email: body.contact_email } : {}),
  ...(body.contact_phone !== undefined ? { phone: body.contact_phone } : {}),
});
const flatSource = (body: any) => ({
  ...(body.source_metadata && typeof body.source_metadata === 'object' ? body.source_metadata : {}),
  ...(body.source !== undefined ? { source: body.source } : {}),
});
const aliases = (row: any) => ({
  ...row,
  contact_name: row.contact_details?.name ?? null,
  contact_email: row.contact_details?.email ?? null,
  contact_phone: row.contact_details?.phone ?? null,
  source: row.source_metadata?.source ?? null,
});
const currencies = /^[A-Z]{3}$/;
const required = (v: any, f: string) => typeof v === 'string' && v.trim() ? null : `${f} is required.`;
const invalidId = (v: any, f: string) => v == null || UUID.test(String(v)) ? null : `${f} must be a valid UUID.`;
const dateError = (v: any, f: string) => {
  if (v == null) return null;
  const match = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return `${f} must be a valid date in YYYY-MM-DD format.`;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3])
    ? null : `${f} must be a valid calendar date.`;
};
const dateOrderError = (received: any, due: any) => received && due && String(due) < String(received) ? 'due_date must be on or after received_date.' : null;
function referenceModuleAccess(req: AuthRequest, res: any, next: any) {
  // A null value is still an intentional reference change (unlink).  Keep the
  // module boundary check for that request rather than treating it as absent.
  const body = req.body || {};
  const needsProject = Object.prototype.hasOwnProperty.call(body, 'project_id');
  const needsDesignBook = Object.prototype.hasOwnProperty.call(body, 'design_book_id');
  const checkDesign = () => needsDesignBook ? requireModuleAccess('design_books')(req, res, next) : next();
  if (needsProject) return requireModuleAccess('projects')(req, res, checkDesign);
  return checkDesign();
}
async function nextNumber(db: any, key: string, prefix: string) {
  await db.query(`INSERT INTO enquiry_number_counters(counter_key,next_value) VALUES($1,2)
    ON CONFLICT(counter_key) DO UPDATE SET next_value=enquiry_number_counters.next_value+1`, [key]);
  const row = await db.query('SELECT next_value-1 AS value FROM enquiry_number_counters WHERE counter_key=$1 FOR UPDATE', [key]);
  return `${prefix}${String(row.rows[0].value).padStart(4, '0')}`;
}
async function record(db: any, enquiryId: string | string[], actor: string, action: string, details: any = {}) {
  await db.query('INSERT INTO enquiry_activities(enquiry_id,action,details,actor_id) VALUES($1,$2,$3,$4)', [String(enquiryId), action, details, actor]);
}
async function references(db: any, projectId: string | null, designBookId: string | null) {
  if (projectId && !(await db.query('SELECT id FROM projects WHERE id=$1', [projectId])).rows[0]) throw Object.assign(new Error('Project not found.'), { status: 404, code: 'NOT_FOUND' });
  if (designBookId) {
    const row = (await db.query('SELECT id,project_id FROM design_books WHERE id=$1', [designBookId])).rows[0];
    if (!row) throw Object.assign(new Error('Design Book not found.'), { status: 404, code: 'NOT_FOUND' });
    if (projectId && row.project_id !== projectId) throw Object.assign(new Error('Design Book must belong to the linked Project.'), { status: 400, code: 'INVALID_REFERENCE' });
  }
}
router.get('/', async (req, res, next) => {
  try {
    const params: any[] = []; const where: string[] = []; const search = String(req.query.search || '').trim();
    if (search) { params.push(`%${search}%`); where.push(`(e.enquiry_number ILIKE $1 OR e.title ILIKE $1 OR c.name ILIKE $1)`); }
    if (req.query.status) { params.push(String(req.query.status)); where.push(`e.status=$${params.length}`); }
    if (req.query.project_id) { if (!UUID.test(String(req.query.project_id))) return res.status(400).json({ error: { code: 'VALIDATION', message: 'project_id must be a valid UUID.' } }); params.push(req.query.project_id); where.push(`e.project_id=$${params.length}`); }
    const page = Math.max(1, Number(req.query.page) || 1), size = Math.min(200, Math.max(1, Number(req.query.page_size) || 25));
    const predicate = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await query(`SELECT COUNT(*)::int AS count FROM enquiries e JOIN clients c ON c.id=e.client_id ${predicate}`, params);
    const rows = await query(`SELECT e.*, c.name AS client_name, p.project_code, p.project_name, d.book_code AS design_book_code
      FROM enquiries e JOIN clients c ON c.id=e.client_id LEFT JOIN projects p ON p.id=e.project_id LEFT JOIN design_books d ON d.id=e.design_book_id
      ${predicate} ORDER BY e.updated_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params, size, (page-1)*size]);
    res.json({ data: rows.rows.map(aliases), pagination: { page, page_size: size, total: count.rows[0].count } });
  } catch (e) { next(e); }
});
router.post('/', requireModuleManage('business_development'), referenceModuleAccess, async (req: AuthRequest, res, next) => {
  try {
    const b = req.body || {};
    for (const [v, f] of [[b.client_id,'client_id'],[b.title,'title']] as any[]) { const e = required(v, f); if (e) return res.status(400).json({ error: { code: 'VALIDATION', message: e, field: f } }); }
    for (const [v, f] of [[b.client_id,'client_id'],[b.project_id,'project_id'],[b.design_book_id,'design_book_id']] as any[]) if (v != null && invalidId(v,f)) return res.status(400).json({ error: { code: 'VALIDATION', message: invalidId(v,f), field: f } });
    if (b.status && !statuses.includes(b.status)) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid status.', field: 'status' } });
    if (Object.prototype.hasOwnProperty.call(b, 'received_date') && b.received_date === null) return res.status(400).json({ error: { code: 'VALIDATION', message: 'received_date cannot be null.', field: 'received_date' } });
    if (dateError(b.received_date,'received_date') || dateError(b.due_date,'due_date') || dateOrderError(b.received_date || new Date().toISOString().slice(0, 10), b.due_date)) return res.status(400).json({ error: { code: 'VALIDATION', message: dateError(b.received_date,'received_date') || dateError(b.due_date,'due_date') || dateOrderError(b.received_date || new Date().toISOString().slice(0, 10), b.due_date) } });
    const result = await withTransaction(async db => {
      if (!(await db.query('SELECT id FROM clients WHERE id=$1', [b.client_id])).rows[0]) throw Object.assign(new Error('Client not found.'), { status: 404, code: 'NOT_FOUND' });
      await references(db, b.project_id || null, b.design_book_id || null);
      const number = await nextNumber(db, `enquiry:${new Date().getUTCFullYear()}`, `ENQ-${new Date().getUTCFullYear()}-`);
      const inserted = await db.query(`INSERT INTO enquiries(enquiry_number,client_id,title,description,status,contact_details,received_date,due_date,project_id,design_book_id,source_metadata,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,CURRENT_DATE),$8,$9,$10,$11,$12,$12) RETURNING *`,
        [number,b.client_id,b.title.trim(),b.description || null,b.status || 'new',flatContact(b),b.received_date || null,b.due_date || null,b.project_id || null,b.design_book_id || null,flatSource(b),req.user!.id]);
      await record(db, inserted.rows[0].id, req.user!.id, 'created', { project_id: b.project_id || null, design_book_id: b.design_book_id || null });
      return inserted.rows[0];
    });
    res.status(201).json(aliases(result));
  } catch (e: any) { if (e.status) return res.status(e.status).json({ error: { code: e.code, message: e.message } }); next(e); }
});
router.get('/:id', async (req, res, next) => {
  try {
    const enquiryId = String(req.params.id);
    if (!UUID.test(enquiryId)) return res.status(400).json({ error: { code: 'VALIDATION', message: 'id must be a valid UUID.' } });
    const enquiry = await query(`SELECT e.*, c.name AS client_name, p.project_code,p.project_name,d.book_code AS design_book_code
      FROM enquiries e JOIN clients c ON c.id=e.client_id LEFT JOIN projects p ON p.id=e.project_id LEFT JOIN design_books d ON d.id=e.design_book_id WHERE e.id=$1`, [req.params.id]);
    if (!enquiry.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Enquiry not found.' } });
    const activities = await query('SELECT * FROM enquiry_activities WHERE enquiry_id=$1 ORDER BY created_at DESC LIMIT 100', [req.params.id]);
    const quote = await query('SELECT * FROM enquiry_quotes WHERE enquiry_id=$1', [req.params.id]);
    const lines = quote.rows[0] ? await query('SELECT * FROM enquiry_quote_lines WHERE quote_id=$1 ORDER BY sort_order,id', [quote.rows[0].id]) : { rows: [] };
    res.json({ ...aliases(enquiry.rows[0]), activities: activities.rows, quote: quote.rows[0] ? { ...quote.rows[0], lines: lines.rows } : null });
  } catch (e) { next(e); }
});
router.patch('/:id', requireModuleManage('business_development'), referenceModuleAccess, async (req: AuthRequest, res, next) => {
  try {
    const enquiryId = String(req.params.id);
    if (!UUID.test(enquiryId)) return res.status(400).json({ error: { code: 'VALIDATION', message: 'id must be a valid UUID.' } });
    const b=req.body||{};
    if (b.status && !statuses.includes(b.status)) return res.status(400).json({error:{code:'VALIDATION',message:'Invalid status.'}});
    if (Object.prototype.hasOwnProperty.call(b, 'received_date') && b.received_date === null) return res.status(400).json({error:{code:'VALIDATION',message:'received_date cannot be null.',field:'received_date'}});
    if (b.title !== undefined && required(b.title, 'title')) return res.status(400).json({error:{code:'VALIDATION',message:'title is required.',field:'title'}});
    for (const [value, field] of [[b.client_id, 'client_id'], [b.project_id, 'project_id'], [b.design_book_id, 'design_book_id']] as any[]) {
      if (value !== undefined && value !== null && invalidId(value, field)) return res.status(400).json({error:{code:'VALIDATION',message:invalidId(value, field),field}});
    }
    for (const [value, field] of [[b.received_date, 'received_date'], [b.due_date, 'due_date']] as any[]) {
      if (value !== undefined && value !== null && dateError(value, field)) return res.status(400).json({error:{code:'VALIDATION',message:dateError(value, field),field}});
    }
    const set:string[]=[]; const vals:any[]=[req.params.id];
    for (const f of ['client_id','title','description','status','received_date','due_date','project_id','design_book_id']) if (b[f] !== undefined) {
      vals.push(f==='title'?String(b[f]).trim():b[f]); set.push(`${f}=$${vals.length}`);
    }
    if (b.contact_details !== undefined || b.contact_name !== undefined || b.contact_email !== undefined || b.contact_phone !== undefined) { vals.push(flatContact(b)); set.push(`contact_details=$${vals.length}`); }
    if (b.source_metadata !== undefined || b.source !== undefined) { vals.push(flatSource(b)); set.push(`source_metadata=$${vals.length}`); }
    if (!set.length) return res.status(400).json({error:{code:'VALIDATION',message:'At least one enquiry field is required.'}});
    vals.push(req.user!.id); set.push(`updated_by=$${vals.length}`,'updated_at=NOW()');
    const updated=await withTransaction(async db=>{ const current=(await db.query('SELECT * FROM enquiries WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0]; if(!current) throw Object.assign(new Error('Enquiry not found.'),{status:404,code:'NOT_FOUND'}); if (b.client_id !== undefined && b.client_id === null) throw Object.assign(new Error('client_id cannot be null.'),{status:400,code:'VALIDATION'}); if (b.client_id !== undefined && !(await db.query('SELECT id FROM clients WHERE id=$1',[b.client_id])).rows[0]) throw Object.assign(new Error('Client not found.'),{status:404,code:'NOT_FOUND'}); const effectiveProject = b.project_id !== undefined ? b.project_id : current.project_id; const effectiveDesign = b.design_book_id !== undefined ? b.design_book_id : current.design_book_id; const effectiveReceived = b.received_date !== undefined ? b.received_date : current.received_date; const effectiveDue = b.due_date !== undefined ? b.due_date : current.due_date; if (effectiveDue && dateOrderError(effectiveReceived, effectiveDue)) throw Object.assign(new Error(dateOrderError(effectiveReceived, effectiveDue)!),{status:400,code:'VALIDATION'}); await references(db,effectiveProject,effectiveDesign); const r=await db.query(`UPDATE enquiries SET ${set.join(',')} WHERE id=$1 RETURNING *`,vals); await record(db,req.params.id,req.user!.id,'updated',{changes:b}); return r.rows[0]; });
    res.json(aliases(updated));
  } catch(e:any){if(e.status)return res.status(e.status).json({error:{code:e.code,message:e.message}});next(e);}
});
router.post('/:id/create-project', requireModuleManage('business_development'), requireModuleManage('projects'), async (req: AuthRequest, res, next) => {
  try {
    const enquiryId = String(req.params.id);
    if (!UUID.test(enquiryId)) return res.status(400).json({error:{code:'VALIDATION',message:'id must be a valid UUID.'}});
    const b=req.body||{}; for(const f of ['project_code','project_name']) {const e=required(b[f],f);if(e)return res.status(400).json({error:{code:'VALIDATION',message:e,field:f}});}
    const result=await withTransaction(async db=>{const e=(await db.query('SELECT * FROM enquiries WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!e)throw Object.assign(new Error('Enquiry not found.'),{status:404,code:'NOT_FOUND'});if(e.project_id)throw Object.assign(new Error('Enquiry is already linked to a Project.'),{status:409,code:'CONFLICT'});const p=(await db.query(`INSERT INTO projects(project_code,project_name,client_name,site_name,country,city,project_status,notes,created_by) VALUES($1,$2,(SELECT name FROM clients WHERE id=$3),$4,$5,$6,$7,$8,$9) RETURNING *`,[b.project_code.trim(),b.project_name.trim(),e.client_id,b.site_name||null,b.country||null,b.city||null,b.project_status||'Concept',b.notes||null,req.user!.id])).rows[0];const u=await db.query('UPDATE enquiries SET project_id=$1,updated_by=$2,updated_at=NOW() WHERE id=$3 RETURNING *',[p.id,req.user!.id,req.params.id]);await record(db,req.params.id,req.user!.id,'project_created',{project_id:p.id});return{project:p,enquiry:u.rows[0]};});res.status(201).json(result);
  }catch(e:any){if(e.status)return res.status(e.status).json({error:{code:e.code,message:e.message}});if(e.code==='23505')return res.status(409).json({error:{code:'CONFLICT',message:'A project with this code already exists.'}});next(e);}
});
async function quote(db:any,id:string | string[],user:string,b:any){const enquiryId=String(id);const e=(await db.query('SELECT * FROM enquiries WHERE id=$1 FOR UPDATE',[enquiryId])).rows[0];if(!e)throw Object.assign(new Error('Enquiry not found.'),{status:404,code:'NOT_FOUND'});const existing=(await db.query('SELECT * FROM enquiry_quotes WHERE enquiry_id=$1',[enquiryId])).rows[0];if(existing)return existing;const n=await nextNumber(db,`quote:${new Date().getUTCFullYear()}`,`QUO-${new Date().getUTCFullYear()}-`);return(await db.query('INSERT INTO enquiry_quotes(enquiry_id,quote_number,currency,notes,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5) RETURNING *',[enquiryId,n,b.currency||'USD',b.notes||null,user])).rows[0];}
router.post('/:id/quote',requireModuleManage('business_development'),async(req:AuthRequest,res,next)=>{try{if(!UUID.test(String(req.params.id)))return res.status(400).json({error:{code:'VALIDATION',message:'id must be a valid UUID.'}});if(req.body?.currency&&!currencies.test(req.body.currency))return res.status(400).json({error:{code:'VALIDATION',message:'currency must be uppercase ISO code.'}});const q=await withTransaction(db=>quote(db,req.params.id,req.user!.id,req.body||{}));res.status(201).json(q);}catch(e:any){if(e.status)return res.status(e.status).json({error:{code:e.code,message:e.message}});next(e);}});
router.patch('/:id/quote', requireModuleManage('business_development'), async (req: AuthRequest, res, next) => {
  try {
    const enquiryId = String(req.params.id);
    if (!UUID.test(enquiryId)) return res.status(400).json({ error: { code: 'VALIDATION', message: 'id must be a valid UUID.' } });
    const { status, currency, notes } = req.body || {};
    if (status !== undefined && !['draft', 'issued', 'accepted', 'rejected', 'expired'].includes(status)) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid quote status.', field: 'status' } });
    if (currency !== undefined && (typeof currency !== 'string' || !currencies.test(currency))) return res.status(400).json({ error: { code: 'VALIDATION', message: 'currency must be uppercase ISO code.', field: 'currency' } });
    const result = await withTransaction(async db => {
      const current = (await db.query('SELECT * FROM enquiry_quotes WHERE enquiry_id=$1 FOR UPDATE', [enquiryId])).rows[0];
      if (!current) throw Object.assign(new Error('Quote not found.'), { status: 404, code: 'NOT_FOUND' });
      const allowed: Record<string, string[]> = {
        draft: ['draft', 'issued'],
        issued: ['issued', 'accepted', 'rejected', 'expired'],
        accepted: ['accepted'],
        rejected: ['rejected'],
        expired: ['expired'],
      };
      if (status !== undefined && !allowed[current.status]?.includes(status)) {
        throw Object.assign(new Error(`Quote cannot transition from ${current.status} to ${status}.`), { status: 409, code: 'QUOTE_TRANSITION' });
      }
      const updated = await db.query(`UPDATE enquiry_quotes SET status=COALESCE($1,status),currency=COALESCE($2,currency),notes=COALESCE($3,notes),updated_by=$4,updated_at=NOW() WHERE enquiry_id=$5 RETURNING *`, [status ?? null, currency ?? null, notes ?? null, req.user!.id, enquiryId]);
      await record(db, enquiryId, req.user!.id, 'quote_updated', { changes: req.body });
      return updated.rows[0];
    });
    res.json(result);
  } catch (e: any) { if (e.status) return res.status(e.status).json({ error: { code: e.code, message: e.message } }); next(e); }
});
router.post('/:id/quote/import-equipment-breakdown',requireModuleManage('business_development'),requireModuleAccess('design_books'),async(req:AuthRequest,res,next)=>{try{const result=await withTransaction(async db=>{const e=(await db.query('SELECT * FROM enquiries WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!e)throw Object.assign(new Error('Enquiry not found.'),{status:404,code:'NOT_FOUND'});if(!e.design_book_id)throw Object.assign(new Error('Enquiry has no linked Design Book.'),{status:400,code:'INVALID_REFERENCE'});const q=await quote(db,req.params.id,req.user!.id,{});if(q.status!=='draft')throw Object.assign(new Error('Equipment Breakdown can only be imported into a draft quote.'),{status:409,code:'QUOTE_LOCKED'});const lines=(await db.query(`SELECT l.*,s.system_code,s.system_name FROM design_book_equipment_breakdown_lines l JOIN design_book_equipment_breakdowns b ON b.id=l.breakdown_id LEFT JOIN systems s ON s.id=l.system_id WHERE b.design_book_id=$1 ORDER BY s.system_code,l.sort_order,l.created_at`,[e.design_book_id])).rows;await db.query('DELETE FROM enquiry_quote_lines WHERE quote_id=$1',[q.id]);for(const [i,l] of lines.entries())await db.query(`INSERT INTO enquiry_quote_lines(quote_id,source_line_id,source_design_book_id,source_snapshot,description,quantity,unit,unit_price,currency,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[q.id,l.id,e.design_book_id,l,l.description,l.quantity,l.unit,l.selling_price ?? l.unit_cost,l.currency||q.currency,i]);const persisted=(await db.query('SELECT * FROM enquiry_quote_lines WHERE quote_id=$1 ORDER BY sort_order,id',[q.id])).rows;await record(db,req.params.id,req.user!.id,'quote_imported',{quote_id:q.id,line_count:persisted.length,design_book_id:e.design_book_id});return{quote:q,lines:persisted};});res.json(result);}catch(e:any){if(e.status)return res.status(e.status).json({error:{code:e.code,message:e.message}});next(e);}});
export default router;