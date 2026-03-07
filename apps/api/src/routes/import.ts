import { Router, Response } from 'express';
import { query } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import multer from 'multer';
import csv from 'csv-parser';
import fs from 'fs';
import path from 'path';

const router = Router();
const upload = multer({ dest: path.join(__dirname, '../../uploads/tmp/') });

function parseCSVFile(filePath: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const results: any[] = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => results.push(row))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

router.post('/products', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'CSV file required' } });
  const rows = await parseCSVFile(req.file.path);
  const results = { imported: 0, skipped: 0, errors: [] as string[] };

  for (const row of rows) {
    const { product_code, product_name, product_family_code, product_category, application_type, design_flow_m3h, power_kw, primary_material_code, standard_status } = row;
    if (!product_code || !product_name) { results.skipped++; continue; }
    try {
      let family_id = null;
      if (product_family_code) {
        const fam = await query('SELECT id FROM product_families WHERE product_family_code=$1', [product_family_code]);
        if (fam.rows[0]) family_id = fam.rows[0].id;
      }
      await query(
        'INSERT INTO product_masters (product_code, product_family_id, product_name, product_category, application_type, design_flow_m3h, power_kw, primary_material_code, standard_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (product_code) DO NOTHING',
        [product_code, family_id, product_name, product_category, application_type, design_flow_m3h || null, power_kw || null, primary_material_code, standard_status || 'Concept']
      );
      results.imported++;
    } catch (err: any) {
      results.errors.push(`${product_code}: ${err.message}`);
    }
  }

  fs.unlinkSync(req.file.path);
  res.json({ ...results, total: rows.length });
});

router.post('/equipment', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'CSV file required' } });
  const rows = await parseCSVFile(req.file.path);
  const results = { imported: 0, skipped: 0, errors: [] as string[] };

  for (const row of rows) {
    const { equipment_code, project_code, system_code, equipment_type, equipment_name, design_flow_m3h, power_kw, material_code } = row;
    if (!equipment_code || !equipment_name) { results.skipped++; continue; }
    try {
      const proj = await query('SELECT id FROM projects WHERE project_code=$1', [project_code]);
      if (!proj.rows[0]) { results.errors.push(`${equipment_code}: project ${project_code} not found`); continue; }
      const sys = system_code ? await query('SELECT id FROM systems WHERE system_code=$1 AND project_id=$2', [system_code, proj.rows[0].id]) : { rows: [] };
      await query(
        'INSERT INTO equipment_instances (equipment_code, project_id, system_id, equipment_type, equipment_name, design_flow_m3h, power_kw, material_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (project_id, equipment_code) DO NOTHING',
        [equipment_code, proj.rows[0].id, sys.rows[0]?.id || null, equipment_type, equipment_name, design_flow_m3h || null, power_kw || null, material_code]
      );
      results.imported++;
    } catch (err: any) {
      results.errors.push(`${equipment_code}: ${err.message}`);
    }
  }

  fs.unlinkSync(req.file.path);
  res.json({ ...results, total: rows.length });
});

router.post('/documents', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'CSV file required' } });
  const rows = await parseCSVFile(req.file.path);
  const results = { imported: 0, skipped: 0, errors: [] as string[] };

  for (const row of rows) {
    const { document_code, document_title, document_type, discipline, project_code } = row;
    if (!document_code || !document_title) { results.skipped++; continue; }
    try {
      const proj = project_code ? await query('SELECT id FROM projects WHERE project_code=$1', [project_code]) : { rows: [] };
      await query(
        'INSERT INTO documents (document_code, document_title, document_type, discipline, project_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (document_code) DO NOTHING',
        [document_code, document_title, document_type, discipline, proj.rows[0]?.id || null, req.user!.id]
      );
      results.imported++;
    } catch (err: any) {
      results.errors.push(`${document_code}: ${err.message}`);
    }
  }

  fs.unlinkSync(req.file.path);
  res.json({ ...results, total: rows.length });
});

export default router;
