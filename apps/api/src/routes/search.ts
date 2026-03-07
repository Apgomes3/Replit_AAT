import { Router, Response } from 'express';
import { query } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const q = req.query.q as string;
  if (!q || q.trim().length < 2) return res.json({ results: [], query: q });

  const term = `%${q.trim()}%`;

  const [projects, systems, equipment, products, materials, documents] = await Promise.all([
    query(`SELECT 'project' as type, id::text, project_code as code, project_name as name, project_status as status FROM projects WHERE project_name ILIKE $1 OR project_code ILIKE $1 LIMIT 10`, [term]),
    query(`SELECT 'system' as type, s.id::text, s.system_code as code, s.system_name as name, s.status, p.project_code FROM systems s JOIN projects p ON s.project_id=p.id WHERE s.system_name ILIKE $1 OR s.system_code ILIKE $1 LIMIT 10`, [term]),
    query(`SELECT 'equipment' as type, ei.id::text, ei.equipment_code as code, ei.equipment_name as name, ei.status, p.project_code FROM equipment_instances ei JOIN projects p ON ei.project_id=p.id WHERE ei.equipment_name ILIKE $1 OR ei.equipment_code ILIKE $1 LIMIT 10`, [term]),
    query(`SELECT 'product' as type, id::text, product_code as code, product_name as name, standard_status as status FROM product_masters WHERE product_name ILIKE $1 OR product_code ILIKE $1 OR EXISTS (SELECT 1 FROM unnest(synonyms) s WHERE s ILIKE $1) LIMIT 10`, [term]),
    query(`SELECT 'material' as type, id::text, material_code as code, material_name as name, status FROM materials WHERE material_name ILIKE $1 OR material_code ILIKE $1 LIMIT 10`, [term]),
    query(`SELECT 'document' as type, d.id::text, d.document_code as code, d.document_title as name, d.status, p.project_code FROM documents d LEFT JOIN projects p ON d.project_id=p.id WHERE d.document_title ILIKE $1 OR d.document_code ILIKE $1 LIMIT 10`, [term]),
  ]);

  const results = [
    ...projects.rows,
    ...systems.rows,
    ...equipment.rows,
    ...products.rows,
    ...materials.rows,
    ...documents.rows,
  ];

  res.json({ results, query: q, total: results.length });
});

export default router;
