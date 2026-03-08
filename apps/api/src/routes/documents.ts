import { Router, Response } from 'express';
import { query } from '../db';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const router = Router();

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_, file, cb) => {
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// DOCUMENTS
router.get('/documents', authenticate, async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const page_size = Math.min(parseInt(req.query.page_size as string) || 25, 200);
  const offset = (page - 1) * page_size;
  const filters: string[] = [];
  const params: any[] = [];

  if (req.query.project_id) { params.push(req.query.project_id); filters.push(`EXISTS (SELECT 1 FROM document_project_links dpl WHERE dpl.document_id=d.id AND dpl.project_id=$${params.length})`); }
  if (req.query.product_id) { params.push(req.query.product_id); filters.push(`d.product_id=$${params.length}`); }
  if (req.query.component_id) { params.push(req.query.component_id); filters.push(`d.component_id=$${params.length}`); }
  if (req.query.status) { params.push(req.query.status); filters.push(`d.status=$${params.length}`); }
  if (req.query.document_type) { params.push(req.query.document_type); filters.push(`d.document_type=$${params.length}`); }
  if (req.query.drawing_types) { filters.push(`d.document_type IN ('Drawing','GA Drawing','Assembly Drawing','Fabrication Drawing','3D Model','P&ID','As-Built Drawing','Wiring Diagram')`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); filters.push(`(d.document_code ILIKE $${params.length} OR d.document_title ILIKE $${params.length})`); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countRes = await query(`SELECT COUNT(*) FROM documents d ${where}`, params);
  params.push(page_size, offset);
  const result = await query(
    `SELECT d.*,
            (SELECT STRING_AGG(p.project_code, ', ' ORDER BY dpl.linked_at) FROM document_project_links dpl JOIN projects p ON dpl.project_id=p.id WHERE dpl.document_id=d.id) as project_codes,
            (SELECT STRING_AGG(dpl.project_id::text, ',' ORDER BY dpl.linked_at) FROM document_project_links dpl WHERE dpl.document_id=d.id) as project_ids,
            pm.product_code, pm.product_name, c.component_code, c.component_name,
            u.first_name || ' ' || u.last_name as created_by_name
     FROM documents d
     LEFT JOIN product_masters pm ON d.product_id=pm.id
     LEFT JOIN components c ON d.component_id=c.id
     LEFT JOIN users u ON d.created_by=u.id
     ${where} ORDER BY d.document_code LIMIT $${params.length-1} OFFSET $${params.length}`, params);
  res.json({ items: result.rows, pagination: { page, page_size, total: parseInt(countRes.rows[0].count) } });
});

router.get('/documents/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT d.*, u.first_name || ' ' || u.last_name as created_by_name
     FROM documents d LEFT JOIN users u ON d.created_by=u.id
     WHERE d.id::text=$1 OR d.document_code=$1`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
  const docId = result.rows[0].id;
  const projects = await query(
    `SELECT p.id, p.project_code, p.project_name FROM document_project_links dpl JOIN projects p ON dpl.project_id=p.id WHERE dpl.document_id=$1 ORDER BY dpl.linked_at`,
    [docId]);
  const revisions = await query(
    `SELECT dr.*, u.first_name || ' ' || u.last_name as issued_by_name
     FROM document_revisions dr LEFT JOIN users u ON dr.issued_by=u.id
     WHERE dr.document_id=$1 ORDER BY dr.created_at DESC`, [docId]);
  const approvals = await query(
    `SELECT a.*, u.first_name || ' ' || u.last_name as approver_name
     FROM approvals a LEFT JOIN users u ON a.approver_id=u.id
     WHERE a.document_id=$1 ORDER BY a.acted_at DESC`, [docId]);
  res.json({ ...result.rows[0], projects: projects.rows, revisions: revisions.rows, approvals: approvals.rows });
});

router.post('/documents', authenticate, async (req: AuthRequest, res: Response) => {
  const { document_code, document_title, document_type, discipline, project_id, system_id, equipment_id, product_id, component_id, owner, notes } = req.body;
  if (!document_code || !document_title) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'document_code and document_title required' } });
  const result = await query(
    'INSERT INTO documents (document_code, document_title, document_type, discipline, system_id, equipment_id, product_id, component_id, owner, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
    [document_code, document_title, document_type, discipline, system_id, equipment_id, product_id, component_id || null, owner, notes, req.user!.id]);
  if (project_id) {
    await query('INSERT INTO document_project_links (document_id, project_id, linked_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [result.rows[0].id, project_id, req.user!.id]);
  }
  await query('INSERT INTO lifecycle_transitions (entity_type, entity_id, to_state, actor_id, comment) VALUES ($1,$2,$3,$4,$5)',
    ['document', result.rows[0].id, 'Draft', req.user!.id, 'Document registered']);
  res.status(201).json(result.rows[0]);
});

router.put('/documents/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { document_title, document_type, discipline, status, owner, notes } = req.body;
  const result = await query(
    'UPDATE documents SET document_title=$1, document_type=$2, discipline=$3, status=$4, owner=$5, notes=$6, updated_at=NOW() WHERE id=$7 RETURNING *',
    [document_title, document_type, discipline, status, owner, notes, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
  res.json(result.rows[0]);
});

// PROJECT LINKS
router.post('/documents/:id/projects', authenticate, async (req: AuthRequest, res: Response) => {
  const { project_id } = req.body;
  if (!project_id) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'project_id required' } });
  await query('INSERT INTO document_project_links (document_id, project_id, linked_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [req.params.id, project_id, req.user!.id]);
  const links = await query(
    'SELECT p.id, p.project_code, p.project_name FROM document_project_links dpl JOIN projects p ON dpl.project_id=p.id WHERE dpl.document_id=$1 ORDER BY dpl.linked_at',
    [req.params.id]);
  res.json(links.rows);
});

router.delete('/documents/:id/projects/:projectId', authenticate, async (req: AuthRequest, res: Response) => {
  await query('DELETE FROM document_project_links WHERE document_id=$1 AND project_id=$2', [req.params.id, req.params.projectId]);
  res.status(204).end();
});

// REVISIONS
router.post('/documents/:id/revisions', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  const { revision_code, revision_purpose } = req.body;
  const file = req.file;

  const doc = await query('SELECT * FROM documents WHERE id=$1', [req.params.id]);
  if (!doc.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });

  let file_path = null, file_name = null, file_size = null, mime_type = null, checksum = null;
  if (file) {
    file_path = `/uploads/${file.filename}`;
    file_name = file.originalname;
    file_size = file.size;
    mime_type = file.mimetype;
    const buf = fs.readFileSync(file.path);
    checksum = crypto.createHash('sha256').update(buf).digest('hex');
  }

  const result = await query(
    'INSERT INTO document_revisions (document_id, revision_code, revision_purpose, status, issued_by, file_path, file_name, file_size, mime_type, checksum, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
    [req.params.id, revision_code || 'A', revision_purpose, 'Draft', req.user!.id, file_path, file_name, file_size, mime_type, checksum, req.user!.id]);

  await query('UPDATE documents SET current_revision=$1, updated_at=NOW() WHERE id=$2', [revision_code || 'A', req.params.id]);
  res.status(201).json(result.rows[0]);
});

// DELETE REVISION (admin only)
router.delete('/documents/revisions/:revId', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const rev = await query('SELECT * FROM document_revisions WHERE id=$1', [req.params.revId]);
  if (!rev.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Revision not found' } });
  const docId = rev.rows[0].document_id;
  if (rev.rows[0].file_path) {
    const filePath = path.join(__dirname, '../../', rev.rows[0].file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  await query('DELETE FROM document_revisions WHERE id=$1', [req.params.revId]);
  const remaining = await query('SELECT revision_code FROM document_revisions WHERE document_id=$1 ORDER BY created_at DESC LIMIT 1', [docId]);
  const newCurrent = remaining.rows[0]?.revision_code ?? null;
  await query('UPDATE documents SET current_revision=$1, updated_at=NOW() WHERE id=$2', [newCurrent, docId]);
  res.status(204).end();
});

// DELETE DOCUMENT (admin only)
router.delete('/documents/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const doc = await query('SELECT * FROM documents WHERE id=$1', [req.params.id]);
  if (!doc.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
  const revisions = await query('SELECT file_path FROM document_revisions WHERE document_id=$1', [req.params.id]);
  for (const rev of revisions.rows) {
    if (rev.file_path) {
      const filePath = path.join(__dirname, '../../', rev.file_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }
  await query('DELETE FROM document_revisions WHERE document_id=$1', [req.params.id]);
  await query('DELETE FROM approvals WHERE document_id=$1', [req.params.id]);
  await query('DELETE FROM lifecycle_transitions WHERE entity_type=$1 AND entity_id=$2', ['document', req.params.id]);
  await query('DELETE FROM documents WHERE id=$1', [req.params.id]);
  res.status(204).end();
});

// APPROVALS
router.post('/documents/:id/approvals', authenticate, async (req: AuthRequest, res: Response) => {
  const { revision_id, action, comment, role } = req.body;
  const result = await query('INSERT INTO approvals (document_id, revision_id, approver_id, role, action, comment) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.params.id, revision_id, req.user!.id, role, action, comment]);

  if (action === 'Approved') {
    await query('UPDATE documents SET status=$1, updated_at=NOW() WHERE id=$2', ['Approved', req.params.id]);
    if (revision_id) await query('UPDATE document_revisions SET status=$1, issued_at=NOW(), issued_by=$2 WHERE id=$3', ['Approved', req.user!.id, revision_id]);
  } else if (action === 'Released') {
    await query('UPDATE documents SET status=$1, updated_at=NOW() WHERE id=$2', ['Released', req.params.id]);
    if (revision_id) await query('UPDATE document_revisions SET status=$1, issued_at=NOW(), issued_by=$2 WHERE id=$3', ['Released', req.user!.id, revision_id]);
  } else if (action === 'Rejected') {
    await query('UPDATE documents SET status=$1, updated_at=NOW() WHERE id=$2', ['Draft', req.params.id]);
    if (revision_id) await query('UPDATE document_revisions SET status=$1, issued_at=NOW(), issued_by=$2 WHERE id=$3', ['Rejected', req.user!.id, revision_id]);
  } else if (action === 'Review Commented') {
    if (revision_id) await query('UPDATE document_revisions SET status=$1 WHERE id=$2', ['Review Commented', revision_id]);
  }

  await query('INSERT INTO lifecycle_transitions (entity_type, entity_id, to_state, actor_id, comment) VALUES ($1,$2,$3,$4,$5)',
    ['document', req.params.id, action, req.user!.id, comment]);

  res.status(201).json(result.rows[0]);
});

// RELEASE PACKAGES
router.get('/release-packages', authenticate, async (req: AuthRequest, res: Response) => {
  let where = '', params: any[] = [];
  if (req.query.project_id) { params.push(req.query.project_id); where = 'WHERE rp.project_id=$1'; }
  const result = await query(`SELECT rp.*, p.project_code FROM release_packages rp LEFT JOIN projects p ON rp.project_id=p.id ${where} ORDER BY rp.created_at DESC`, params);
  res.json({ items: result.rows });
});

router.get('/release-packages/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const pkg = await query('SELECT rp.*, p.project_code FROM release_packages rp LEFT JOIN projects p ON rp.project_id=p.id WHERE rp.id=$1', [req.params.id]);
  if (!pkg.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Release package not found' } });
  const items = await query('SELECT rpi.*, d.document_code, d.document_title FROM release_package_items rpi JOIN documents d ON rpi.document_id=d.id WHERE rpi.release_package_id=$1', [req.params.id]);
  res.json({ ...pkg.rows[0], items: items.rows });
});

router.post('/release-packages', authenticate, async (req: AuthRequest, res: Response) => {
  const { project_id, package_type, package_name, notes } = req.body;
  const release_code = `RLS-${Date.now().toString(36).toUpperCase()}`;
  const result = await query('INSERT INTO release_packages (release_code, project_id, package_type, package_name, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [release_code, project_id, package_type, package_name, notes, req.user!.id]);
  res.status(201).json(result.rows[0]);
});

router.post('/release-packages/:id/items', authenticate, async (req: AuthRequest, res: Response) => {
  const { document_id, revision_code } = req.body;
  const result = await query('INSERT INTO release_package_items (release_package_id, document_id, revision_code) VALUES ($1,$2,$3) RETURNING *',
    [req.params.id, document_id, revision_code]);
  res.status(201).json(result.rows[0]);
});

export default router;
