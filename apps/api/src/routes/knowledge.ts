import { Router, Response } from 'express';
import { query } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// MATERIALS
router.get('/materials', authenticate, async (req: AuthRequest, res: Response) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  const result = q
    ? await query('SELECT * FROM materials WHERE material_name ILIKE $1 OR material_code ILIKE $1 ORDER BY material_code', [q])
    : await query('SELECT * FROM materials ORDER BY material_code');
  res.json({ items: result.rows });
});

router.get('/materials/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM materials WHERE id::text=$1 OR material_code=$1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Material not found' } });
  const products = await query('SELECT product_code, product_name FROM product_masters WHERE primary_material_code=$1 ORDER BY product_code', [result.rows[0].material_code]);
  res.json({ ...result.rows[0], products: products.rows });
});

router.post('/materials', authenticate, async (req: AuthRequest, res: Response) => {
  const { material_code, material_name, material_category, density, chemical_resistance, temperature_limit, notes } = req.body;
  const result = await query('INSERT INTO materials (material_code, material_name, material_category, density, chemical_resistance, temperature_limit, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [material_code, material_name, material_category, density, chemical_resistance, temperature_limit, notes]);
  res.status(201).json(result.rows[0]);
});

router.put('/materials/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { material_name, material_category, density, chemical_resistance, temperature_limit, status, notes } = req.body;
  const result = await query('UPDATE materials SET material_name=$1, material_category=$2, density=$3, chemical_resistance=$4, temperature_limit=$5, status=$6, notes=$7, updated_at=NOW() WHERE id=$8 RETURNING *',
    [material_name, material_category, density, chemical_resistance, temperature_limit, status, notes, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Material not found' } });
  res.json(result.rows[0]);
});

// SPECIFICATIONS
router.get('/specifications', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM specifications ORDER BY spec_code');
  res.json({ items: result.rows });
});

router.get('/specifications/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM specifications WHERE id::text=$1 OR spec_code=$1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Specification not found' } });
  res.json(result.rows[0]);
});

router.post('/specifications', authenticate, async (req: AuthRequest, res: Response) => {
  const { spec_code, spec_name, spec_type, standard_reference, discipline, description } = req.body;
  const result = await query('INSERT INTO specifications (spec_code, spec_name, spec_type, standard_reference, discipline, description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [spec_code, spec_name, spec_type, standard_reference, discipline, description]);
  res.status(201).json(result.rows[0]);
});

router.put('/specifications/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { spec_name, spec_type, standard_reference, discipline, status, description } = req.body;
  const result = await query('UPDATE specifications SET spec_name=$1, spec_type=$2, standard_reference=$3, discipline=$4, status=$5, description=$6, updated_at=NOW() WHERE id=$7 RETURNING *',
    [spec_name, spec_type, standard_reference, discipline, status, description, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Specification not found' } });
  res.json(result.rows[0]);
});

// DESIGN RULES
router.get('/design-rules', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM design_rules ORDER BY rule_code');
  res.json({ items: result.rows });
});

router.get('/design-rules/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM design_rules WHERE id::text=$1 OR rule_code=$1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design rule not found' } });
  res.json(result.rows[0]);
});

router.post('/design-rules', authenticate, async (req: AuthRequest, res: Response) => {
  const { rule_code, rule_name, discipline, applies_to, rule_description, reference_spec } = req.body;
  const result = await query('INSERT INTO design_rules (rule_code, rule_name, discipline, applies_to, rule_description, reference_spec) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [rule_code, rule_name, discipline, applies_to, rule_description, reference_spec]);
  res.status(201).json(result.rows[0]);
});

// CALCULATION TEMPLATES
router.get('/calculation-templates', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM calculation_templates ORDER BY template_code');
  res.json({ items: result.rows });
});

router.get('/calculation-templates/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM calculation_templates WHERE id::text=$1 OR template_code=$1', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Calculation template not found' } });
  res.json(result.rows[0]);
});

router.post('/calculation-templates', authenticate, async (req: AuthRequest, res: Response) => {
  const { template_code, template_name, discipline, applies_to, description, formula_notes } = req.body;
  const result = await query('INSERT INTO calculation_templates (template_code, template_name, discipline, applies_to, description, formula_notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [template_code, template_name, discipline, applies_to, description, formula_notes]);
  res.status(201).json(result.rows[0]);
});

export default router;
