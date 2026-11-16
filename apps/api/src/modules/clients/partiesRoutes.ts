// Companies and people on a project, with their role (/api/v1/projects/:projectId/parties).
// Reading needs Project Management access; changing needs manage on Projects or on Clients & contacts.
import { Response, Router } from 'express';
import { authenticate, AuthRequest, requireAnyModuleManage, requireModuleAccess } from '../../middleware/auth';
import { query } from '../../db';
import { logAudit } from '../../db/audit';
import { isUuid } from './validation';

const router = Router();
const manage = requireAnyModuleManage('projects', 'clients');

/** Role names offered in the screens; any other short text is allowed too. */
export const COMPANY_ROLES = ['Owner / operator', 'Consultant', 'Contractor', 'Architect', 'Theming', 'Supplier', 'Partner'];
export const PERSON_ROLES = ['Client project manager', 'Client engineer', 'Curator / life support', 'Consultant engineer', 'Contractor project manager', 'Site contact', 'Procurement', 'Accounts'];

function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

/** Trimmed role text, or an error. */
export function cleanRole(value: unknown): { role: string } | { error: string } {
  if (typeof value !== 'string' || !value.trim()) return { error: 'Choose or type a role' };
  const role = value.trim().replace(/\s+/g, ' ');
  return role.length > 80 ? { error: 'Role must be 80 characters or fewer' } : { role };
}

const PARTY_SQL = `
  SELECT pp.id, pp.project_id, pp.client_id, c.name AS client_name, c.client_code, c.kinds,
    pp.contact_id, cc.name AS contact_name, cc.email, COALESCE(cc.phone, cc.mobile) AS phone, cc.job_title, cc.left_on,
    pp.role, pp.notes, pp.created_at
  FROM project_parties pp JOIN clients c ON c.id = pp.client_id LEFT JOIN client_contacts cc ON cc.id = pp.contact_id`;

async function projectExists(id: string) {
  return !!(await query('SELECT 1 FROM projects WHERE id=$1', [id])).rows[0];
}

router.get('/projects/:projectId/parties', authenticate, requireModuleAccess('projects'), async (req, res, next) => {
  try {
    const projectId = String(req.params.projectId);
    if (!isUuid(projectId)) return fail(res, 400, 'VALIDATION', 'Not a valid project');
    const rows = await query(`${PARTY_SQL} WHERE pp.project_id=$1 ORDER BY c.name, (pp.contact_id IS NOT NULL), cc.name, pp.role`, [projectId]);
    res.json({ data: rows.rows, company_roles: COMPANY_ROLES, person_roles: PERSON_ROLES });
  } catch (e) { next(e); }
});

router.post('/projects/:projectId/parties', authenticate, manage, async (req: AuthRequest, res, next) => {
  try {
    const projectId = String(req.params.projectId);
    const b = req.body ?? {};
    if (!isUuid(projectId)) return fail(res, 400, 'VALIDATION', 'Not a valid project');
    if (!isUuid(b.client_id)) return fail(res, 400, 'VALIDATION', 'Choose a company');
    if (b.contact_id != null && b.contact_id !== '' && !isUuid(b.contact_id)) return fail(res, 400, 'VALIDATION', 'Not a valid person');
    const r = cleanRole(b.role);
    if ('error' in r) return fail(res, 400, 'VALIDATION', r.error);
    if (!(await projectExists(projectId))) return fail(res, 404, 'NOT_FOUND', 'Project not found');
    const company = (await query('SELECT name FROM clients WHERE id=$1', [b.client_id])).rows[0];
    if (!company) return fail(res, 404, 'NOT_FOUND', 'Company not found');
    const contactId = b.contact_id || null;
    let contactName: string | null = null;
    if (contactId) {
      const contact = (await query('SELECT name FROM client_contacts WHERE id=$1 AND client_id=$2', [contactId, b.client_id])).rows[0];
      if (!contact) return fail(res, 400, 'VALIDATION', `That person does not work for ${company.name}`);
      contactName = contact.name;
    }
    const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null;
    let id: string;
    try {
      id = (await query(
        `INSERT INTO project_parties (project_id, client_id, contact_id, role, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [projectId, b.client_id, contactId, r.role, notes, req.user!.id])).rows[0].id;
    } catch (e: any) {
      if (e?.code === '23505') return fail(res, 409, 'CONFLICT', `${contactName ?? company.name} is already on this project as ${r.role}`);
      throw e;
    }
    await logAudit(req.user!.id, 'project', projectId, 'UPDATE', { summary: `${contactName ? `${contactName} (${company.name})` : company.name} added as ${r.role}` });
    res.status(201).json((await query(`${PARTY_SQL} WHERE pp.id=$1`, [id])).rows[0]);
  } catch (e) { next(e); }
});

router.patch('/projects/:projectId/parties/:partyId', authenticate, manage, async (req: AuthRequest, res, next) => {
  try {
    const { projectId, partyId } = req.params as Record<string, string>;
    if (!isUuid(projectId) || !isUuid(partyId)) return fail(res, 400, 'VALIDATION', 'Not a valid entry');
    const b = req.body ?? {};
    const set: string[] = []; const values: any[] = [partyId, projectId];
    if (b.role !== undefined) {
      const r = cleanRole(b.role);
      if ('error' in r) return fail(res, 400, 'VALIDATION', r.error);
      values.push(r.role); set.push(`role=$${values.length}`);
    }
    if (b.notes !== undefined) { values.push(typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null); set.push(`notes=$${values.length}`); }
    if (!set.length) return fail(res, 400, 'VALIDATION', 'Nothing to change');
    try {
      const updated = (await query(`UPDATE project_parties SET ${set.join(', ')}, updated_at=NOW() WHERE id=$1 AND project_id=$2 RETURNING id`, values)).rows[0];
      if (!updated) return fail(res, 404, 'NOT_FOUND', 'Entry not found');
    } catch (e: any) {
      if (e?.code === '23505') return fail(res, 409, 'CONFLICT', 'They already have that role on this project');
      throw e;
    }
    res.json((await query(`${PARTY_SQL} WHERE pp.id=$1`, [partyId])).rows[0]);
  } catch (e) { next(e); }
});

router.delete('/projects/:projectId/parties/:partyId', authenticate, manage, async (req: AuthRequest, res, next) => {
  try {
    const { projectId, partyId } = req.params as Record<string, string>;
    if (!isUuid(projectId) || !isUuid(partyId)) return fail(res, 400, 'VALIDATION', 'Not a valid entry');
    const removed = (await query(`${PARTY_SQL} WHERE pp.id=$1 AND pp.project_id=$2`, [partyId, projectId])).rows[0];
    if (!removed) return fail(res, 404, 'NOT_FOUND', 'Entry not found');
    await query('DELETE FROM project_parties WHERE id=$1', [partyId]);
    await logAudit(req.user!.id, 'project', projectId, 'UPDATE', { summary: `${removed.contact_name ?? removed.client_name} removed as ${removed.role}` });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
