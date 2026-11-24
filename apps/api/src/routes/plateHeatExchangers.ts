// Saved plate heat exchanger sizings. The sizing itself runs in the browser (apps/web/src/lib/plateHeatExchanger.ts,
// a port of the PHE sizer artifact); this stores the inputs, the data sheet header and a result summary, and links a
// sizing to a project.
import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import pool, { query } from '../db';
import { assertSheetModel, renderPheSheetPdf } from '../lib/plateHeatExchangerPdf';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage, requireRole } from '../middleware/auth';
import { EDITOR_ROLES } from '../lib/roles';

const router = Router();
router.use('/plate-heat-exchangers', authenticate, requireModuleAccess('design_books'));
const canEdit = [requireRole(...EDITOR_ROLES), requireModuleManage('design_books')];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHEET_KEYS = ['client', 'tag', 'doc_no', 'rev', 'service', 'prepared', 'checked', 'approved'];

const SELECT = `
  SELECT s.*, p.project_code, p.project_name, COALESCE(c.name, p.client_name) AS client_name,
         db.book_code, db.book_title, sy.system_code, sy.system_name,
         TRIM(CONCAT(cu.first_name, ' ', cu.last_name)) AS created_by_name,
         TRIM(CONCAT(uu.first_name, ' ', uu.last_name)) AS updated_by_name
  FROM plate_heat_exchanger_sizings s
  LEFT JOIN projects p ON p.id = s.project_id
  LEFT JOIN clients c ON c.id = s.client_id
  LEFT JOIN design_books db ON db.id = s.design_book_id
  LEFT JOIN systems sy ON sy.id = s.system_id
  LEFT JOIN users cu ON cu.id = s.created_by
  LEFT JOIN users uu ON uu.id = s.updated_by`;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const bad = (res: Response, message: string) => res.status(400).json({ error: { code: 'VALIDATION_ERROR', message } });

type Body = { title: string; project_id: string | null; client_id: string | null; design_book_id: string | null; system_id: string | null; inputs: Record<string, unknown>; sheet: Record<string, string>; result_summary: Record<string, unknown> };

async function parseBody(body: any): Promise<Body | string> {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) return 'Give the sizing a title.';
  if (title.length > 255) return 'Title is too long (255 characters at most).';
  if (!isObject(body.inputs) || !(Number(body.inputs.duty) > 0)) return 'Inputs are missing or have no heat duty.';
  if (JSON.stringify(body.inputs).length > 20_000) return 'Inputs are too large.';
  const projectId = body.project_id || null;
  const ref = (v: unknown) => (v ? (typeof v === 'string' && UUID.test(v) ? v : 'invalid') : null);
  let clientId = ref(body.client_id), bookId = ref(body.design_book_id), systemId = ref(body.system_id);
  if ([clientId, bookId, systemId].includes('invalid')) return 'Client, design book or system is not valid.';
  if (projectId !== null) {
    if (typeof projectId !== 'string' || !UUID.test(projectId)) return 'Project is not valid.';
    const found = (await query('SELECT client_id FROM projects WHERE id=$1', [projectId])).rows[0];
    if (!found) return 'Project not found.';
    clientId = found.client_id; // a project's client always comes from the project
    if (bookId && !(await query('SELECT 1 FROM design_books WHERE id=$1 AND project_id=$2', [bookId, projectId])).rows[0]) return 'That design book is not on this project.';
    if (systemId && !(await query('SELECT 1 FROM systems WHERE id=$1 AND project_id=$2', [systemId, projectId])).rows[0]) return 'That system is not on this project.';
  } else {
    if (bookId || systemId) return 'Pick a project before a design book or system.';
    if (clientId && !(await query('SELECT 1 FROM clients WHERE id=$1', [clientId])).rows[0]) return 'Client not found.';
  }
  const sheet: Record<string, string> = {};
  if (body.sheet !== undefined && !isObject(body.sheet)) return 'Data sheet details are not valid.';
  for (const key of SHEET_KEYS) {
    const value = body.sheet?.[key];
    if (value === undefined || value === null) continue;
    sheet[key] = String(value).slice(0, 255);
  }
  const summary = isObject(body.result_summary) && JSON.stringify(body.result_summary).length <= 10_000 ? body.result_summary : {};
  return { title, project_id: projectId, client_id: clientId, design_book_id: bookId, system_id: systemId, inputs: body.inputs, sheet, result_summary: summary };
}

router.get('/plate-heat-exchangers', async (req: AuthRequest, res: Response) => {
  const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : '';
  const systemId = typeof req.query.system_id === 'string' ? req.query.system_id : '';
  if (projectId && !UUID.test(projectId)) return bad(res, 'Project is not valid.');
  if (systemId && !UUID.test(systemId)) return bad(res, 'System is not valid.');
  // The LSS page lists the exchangers sized for its system; the list page filters by project.
  const rows = systemId
    ? (await query(`${SELECT} WHERE s.system_id=$1 ORDER BY s.sheet->>'tag', s.updated_at DESC`, [systemId])).rows
    : projectId
      ? (await query(`${SELECT} WHERE s.project_id=$1 ORDER BY s.updated_at DESC`, [projectId])).rows
      : (await query(`${SELECT} ORDER BY s.updated_at DESC LIMIT 500`)).rows;
  res.json(rows);
});

// Pick lists for the selection sheet: every client (when there is no project), and for a project its
// client, design books and LSS systems. Served here so engineers need no Clients module access.
router.get('/plate-heat-exchangers/options/clients', async (_req: AuthRequest, res: Response) => {
  res.json((await query(`SELECT id, client_code, name FROM clients WHERE status='active' ORDER BY name`)).rows);
});

router.get('/plate-heat-exchangers/options/projects/:projectId', async (req: AuthRequest, res: Response) => {
  if (!UUID.test(String(req.params.projectId))) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  const project = (await query(
    `SELECT p.id, p.client_id, COALESCE(c.name, p.client_name) AS client_name
     FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id=$1`, [req.params.projectId])).rows[0];
  if (!project) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } });
  const [books, systems] = await Promise.all([
    query(`SELECT id, book_code, book_title, status FROM design_books WHERE project_id=$1 ORDER BY book_code`, [project.id]),
    query(`SELECT id, system_code, system_name, system_type FROM systems WHERE project_id=$1 ORDER BY system_code`, [project.id]),
  ]);
  // Next free HX number on each system: one above the highest HX-NN tag already saved against it.
  const used = await query(
    `SELECT system_id, MAX((substring(sheet->>'tag' from '^HX-?([0-9]+)$'))::int) AS top
     FROM plate_heat_exchanger_sizings WHERE project_id=$1 AND system_id IS NOT NULL GROUP BY system_id`, [project.id]);
  const top = new Map(used.rows.map((row: any) => [row.system_id, Number(row.top) || 0]));
  const withTags = systems.rows.map((sys: any) => ({ ...sys, next_tag: `HX-${String((top.get(sys.id) || 0) + 1).padStart(2, '0')}` }));
  res.json({ client_id: project.client_id, client_name: project.client_name, design_books: books.rows, systems: withTags });
});

router.get('/plate-heat-exchangers/:id', async (req: AuthRequest, res: Response) => {
  if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sizing not found' } });
  const row = (await query(`${SELECT} WHERE s.id=$1`, [req.params.id])).rows[0];
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sizing not found' } });
  res.json(row);
});

router.post('/plate-heat-exchangers', ...canEdit, async (req: AuthRequest, res: Response) => {
  const body = await parseBody(req.body);
  if (typeof body === 'string') return bad(res, body);
  const created = (await query(
    `INSERT INTO plate_heat_exchanger_sizings (title, project_id, client_id, design_book_id, system_id, inputs, sheet, result_summary, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id`,
    [body.title, body.project_id, body.client_id, body.design_book_id, body.system_id, body.inputs, body.sheet, body.result_summary, req.user!.id],
  )).rows[0];
  res.status(201).json((await query(`${SELECT} WHERE s.id=$1`, [created.id])).rows[0]);
});

router.put('/plate-heat-exchangers/:id', ...canEdit, async (req: AuthRequest, res: Response) => {
  if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sizing not found' } });
  const body = await parseBody(req.body);
  if (typeof body === 'string') return bad(res, body);
  const updated = (await query(
    `UPDATE plate_heat_exchanger_sizings
     SET title=$2, project_id=$3, client_id=$4, design_book_id=$5, system_id=$6, inputs=$7, sheet=$8, result_summary=$9,
         updated_by=$10, updated_at=NOW()
     WHERE id=$1 RETURNING id`,
    [req.params.id, body.title, body.project_id, body.client_id, body.design_book_id, body.system_id, body.inputs, body.sheet, body.result_summary, req.user!.id],
  )).rows[0];
  if (!updated) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sizing not found' } });
  res.json((await query(`${SELECT} WHERE s.id=$1`, [req.params.id])).rows[0]);
});

// Stores the printed selection sheet as a PDF revision of a project document ("Data Sheet", Design).
// The document code is the sheet's Doc. no., or <project code>-PHE-<tag>; the revision is the sheet's Rev.
const documentsDir = path.join(__dirname, '../../private-uploads/documents');
const EDITABLE_REVISION = ['Draft', 'Internal Review', 'Review Commented', 'Resubmitted'];
const conflict = (res: Response, code: string, message: string) => res.status(409).json({ error: { code, message } });

router.post('/plate-heat-exchangers/:id/documents', ...canEdit, requireModuleManage('documents'), async (req: AuthRequest, res: Response) => {
  if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sizing not found' } });
  const sizing = (await query(`${SELECT} WHERE s.id=$1`, [req.params.id])).rows[0];
  if (!sizing) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sizing not found' } });
  if (!sizing.project_id) return conflict(res, 'NO_PROJECT', 'Link the sizing to a project before storing its sheet in the project documents.');
  const model = req.body?.sheet;
  try { assertSheetModel(model); } catch (e: any) { return bad(res, e.message); }

  const clean = (v: unknown, max: number) => String(v ?? '').trim().replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(0, max);
  const tag = clean(model.header.tag, 30) || `HX-${String(sizing.id).slice(0, 4).toUpperCase()}`;
  const code = clean(model.header.doc_no, 100) || `${sizing.project_code}-PHE-${tag}`.slice(0, 100);
  const rev = clean(model.header.rev, 20) || 'A';
  const title = `Plate heat exchanger data sheet ${tag}${model.header.service ? ` – ${String(model.header.service).slice(0, 200)}` : ''}`;
  const pdf = await renderPheSheetPdf(model, title);

  const client = await pool.connect();
  let fileName = '';
  try {
    await client.query('BEGIN');
    let doc = (await client.query('SELECT * FROM documents WHERE document_code=$1 FOR UPDATE', [code])).rows[0];
    if (doc) {
      const revisions = (await client.query('SELECT revision_code, status FROM document_revisions WHERE document_id=$1 ORDER BY created_at DESC', [doc.id])).rows;
      if (revisions.some((r: any) => String(r.revision_code).toUpperCase() === rev.toUpperCase())) {
        await client.query('ROLLBACK');
        return conflict(res, 'REVISION_EXISTS', `Revision ${rev} of ${code} is already stored. Raise the Rev on the sheet to store a new revision.`);
      }
      if (revisions[0] && EDITABLE_REVISION.includes(revisions[0].status)) {
        await client.query('ROLLBACK');
        return conflict(res, 'EDITABLE_REVISION_EXISTS', `Revision ${revisions[0].revision_code} of ${code} is still in review (${revisions[0].status}). Finish its review in Documents before storing revision ${rev}.`);
      }
    } else {
      doc = (await client.query(
        `INSERT INTO documents (document_code, document_title, document_type, discipline, classification, system_id, owner, notes, created_by)
         VALUES ($1,$2,'Data Sheet','Mechanical','Design',$3,$4,$5,$6) RETURNING *`,
        [code, title, sizing.system_id, sizing.updated_by_name || sizing.created_by_name || null,
          'Generated from the plate heat exchanger sizer.', req.user!.id],
      )).rows[0];
      await client.query('INSERT INTO lifecycle_transitions (entity_type, entity_id, to_state, actor_id, comment) VALUES ($1,$2,$3,$4,$5)',
        ['document', doc.id, 'Draft', req.user!.id, 'Document registered from the plate heat exchanger sizer']);
    }
    await client.query('INSERT INTO document_project_links (document_id, project_id, linked_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [doc.id, sizing.project_id, req.user!.id]);

    if (!fs.existsSync(documentsDir)) fs.mkdirSync(documentsDir, { recursive: true });
    fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
    fs.writeFileSync(path.join(documentsDir, fileName), pdf);
    const revision = (await client.query(
      `INSERT INTO document_revisions (document_id, revision_code, revision_purpose, status, issued_by, file_path, file_name, file_size, mime_type, checksum, created_by)
       VALUES ($1,$2,'Issued for review','Draft',$3,$4,$5,$6,'application/pdf',$7,$3) RETURNING id, revision_code`,
      [doc.id, rev, req.user!.id, `private-uploads/documents/${fileName}`, `${code} rev ${rev}.pdf`, pdf.length,
        crypto.createHash('sha256').update(pdf).digest('hex')],
    )).rows[0];
    await client.query(`UPDATE documents SET current_revision=$1, status='Draft', updated_at=NOW() WHERE id=$2`, [rev, doc.id]);
    await client.query('UPDATE plate_heat_exchanger_sizings SET document_id=$1 WHERE id=$2', [doc.id, sizing.id]);
    await client.query('COMMIT');
    res.status(201).json({ document_id: doc.id, document_code: code, revision_id: revision.id, revision_code: revision.revision_code });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (fileName) fs.rmSync(path.join(documentsDir, fileName), { force: true });
    throw error;
  } finally {
    client.release();
  }
});

router.delete('/plate-heat-exchangers/:id', ...canEdit, async (req: AuthRequest, res: Response) => {
  if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sizing not found' } });
  const deleted = await query('DELETE FROM plate_heat_exchanger_sizings WHERE id=$1', [req.params.id]);
  if (!deleted.rowCount) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sizing not found' } });
  res.status(204).end();
});

export default router;
