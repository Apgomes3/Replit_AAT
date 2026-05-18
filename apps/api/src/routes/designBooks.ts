import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { query } from '../db/index';

const router = Router();

router.get('/design-books', authenticate, async (req: AuthRequest, res: Response) => {
  const q = req.query.q as string | undefined;
  const projectId = req.query.project_id as string | undefined;
  const params: any[] = [];
  const filters: string[] = [];
  if (q) { params.push(`%${q}%`); filters.push(`(db.book_code ILIKE $${params.length} OR db.book_title ILIKE $${params.length} OR p.project_name ILIKE $${params.length})`); }
  if (projectId) { params.push(projectId); filters.push(`db.project_id = $${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await query(
    `SELECT db.*, p.project_code, p.project_name, p.client_name,
       u.first_name || ' ' || u.last_name as created_by_name
     FROM design_books db
     LEFT JOIN projects p ON db.project_id = p.id
     LEFT JOIN users u ON db.created_by = u.id
     ${where}
     ORDER BY db.created_at DESC`,
    params
  );
  res.json({ items: result.rows });
});

router.get('/design-books/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const book = await query(
    `SELECT db.*, p.project_code, p.project_name, p.client_name, p.site_name, p.country,
       u.first_name || ' ' || u.last_name as created_by_name
     FROM design_books db
     LEFT JOIN projects p ON db.project_id = p.id
     LEFT JOIN users u ON db.created_by = u.id
     WHERE db.id = $1`,
    [req.params.id]
  );
  if (!book.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  const row = book.rows[0];

  let exhibits: any[] = [];
  let tanks: any[] = [];
  let systems: any[] = [];
  let species: any[] = [];

  if (row.project_id) {
    const exResult = await query(
      `SELECT e.*, a.area_name, a.area_code
       FROM exhibits e
       LEFT JOIN areas a ON e.area_id = a.id
       WHERE e.project_id = $1
       ORDER BY a.area_code, e.exhibit_code`,
      [row.project_id]
    );
    exhibits = exResult.rows;

    const tkResult = await query(
      `SELECT t.*,
        e.exhibit_name, e.water_type as exhibit_water_type,
        s.system_code, s.system_name,
        pm.product_code, pm.product_name as product_name,
        COALESCE(t.shape_type, pm.shape_type) as eff_shape,
        COALESCE(t.length_mm, pm.length_mm) as eff_length_mm,
        COALESCE(t.width_mm, pm.width_mm) as eff_width_mm,
        COALESCE(t.height_mm, pm.height_mm) as eff_height_mm,
        COALESCE(t.design_water_level_mm, pm.design_water_level_mm) as eff_water_level_mm,
        COALESCE(
          CASE
            WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
                 AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
              THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) * COALESCE(t.height_mm, pm.height_mm) / 1000000000.0)::numeric, 4)
            WHEN COALESCE(t.shape_type, pm.shape_type) IS DISTINCT FROM 'Cylindrical'
                 AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
                 AND COALESCE(t.height_mm, pm.height_mm) IS NOT NULL
              THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.height_mm,pm.height_mm)/1000000000.0)::numeric, 4)
            ELSE NULL
          END,
          t.gross_volume_m3, pm.gross_volume_m3
        ) as gross_volume_m3,
        COALESCE(
          CASE
            WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
                 AND COALESCE(t.design_water_level_mm, pm.design_water_level_mm) IS NOT NULL
              THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) * COALESCE(t.design_water_level_mm, pm.design_water_level_mm) / 1000000000.0)::numeric, 4)
            WHEN COALESCE(t.shape_type, pm.shape_type) IS DISTINCT FROM 'Cylindrical'
                 AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
                 AND COALESCE(t.design_water_level_mm, pm.design_water_level_mm) IS NOT NULL
              THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.design_water_level_mm,pm.design_water_level_mm)/1000000000.0)::numeric, 4)
            ELSE NULL
          END,
          t.operating_volume_m3, pm.operating_volume_m3
        ) as design_volume_m3
       FROM tanks t
       LEFT JOIN exhibits e ON t.exhibit_id = e.id
       LEFT JOIN systems s ON t.system_id = s.id
       LEFT JOIN product_masters pm ON t.product_master_id = pm.id
       WHERE t.project_id = $1
       ORDER BY e.exhibit_code NULLS LAST, t.sort_order, t.tank_code`,
      [row.project_id]
    );
    tanks = tkResult.rows;

    const sysResult = await query(
      `SELECT s.*,
         e.exhibit_code, e.exhibit_name,
         a.area_code, a.area_name,
         (SELECT COUNT(*) FROM equipment_instances ei WHERE ei.system_id = s.id) as equipment_count
       FROM systems s
       LEFT JOIN exhibits e ON s.exhibit_id = e.id
       LEFT JOIN areas a ON s.area_id = a.id
       WHERE s.project_id = $1
       ORDER BY a.area_code NULLS LAST, e.exhibit_code NULLS LAST, s.system_code`,
      [row.project_id]
    );
    systems = sysResult.rows;
  }

  const speciesResult = await query(
    `SELECT * FROM design_book_exhibit_species WHERE design_book_id = $1 ORDER BY exhibit_id, sort_order, species_name`,
    [req.params.id]
  );
  species = speciesResult.rows;

  res.json({ ...row, exhibits, tanks, systems, species });
});

router.post('/design-books', authenticate, async (req: AuthRequest, res: Response) => {
  const { book_code, book_title, project_id, description, revision, status, notes } = req.body;
  if (!book_code || !book_title) return res.status(400).json({ error: { code: 'VALIDATION', message: 'book_code and book_title are required' } });
  const result = await query(
    `INSERT INTO design_books (book_code, book_title, project_id, description, revision, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [book_code, book_title, project_id || null, description || null, revision || 'A', status || 'Draft', notes || null, req.user!.id]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/design-books/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { book_title, project_id, description, revision, status, notes } = req.body;
  const result = await query(
    `UPDATE design_books SET book_title=$1, project_id=$2, description=$3, revision=$4, status=$5, notes=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [book_title, project_id || null, description || null, revision || 'A', status || 'Draft', notes || null, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  res.json(result.rows[0]);
});

router.delete('/design-books/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('DELETE FROM design_books WHERE id=$1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  res.json({ deleted: true });
});

// Species CRUD
router.post('/design-books/:id/species', authenticate, async (req: AuthRequest, res: Response) => {
  const { exhibit_id, species_name, common_name, quantity, avg_size_cm, biomass_kg, notes, sort_order } = req.body;
  if (!exhibit_id || !species_name) return res.status(400).json({ error: { code: 'VALIDATION', message: 'exhibit_id and species_name are required' } });
  const result = await query(
    `INSERT INTO design_book_exhibit_species (design_book_id, exhibit_id, species_name, common_name, quantity, avg_size_cm, biomass_kg, notes, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.params.id, exhibit_id, species_name, common_name || null, quantity || null, avg_size_cm || null, biomass_kg || null, notes || null, sort_order || 0]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/design-books/:id/species/:speciesId', authenticate, async (req: AuthRequest, res: Response) => {
  const { species_name, common_name, quantity, avg_size_cm, biomass_kg, notes } = req.body;
  const result = await query(
    `UPDATE design_book_exhibit_species SET species_name=$1, common_name=$2, quantity=$3, avg_size_cm=$4, biomass_kg=$5, notes=$6, updated_at=NOW()
     WHERE id=$7 AND design_book_id=$8 RETURNING *`,
    [species_name, common_name || null, quantity || null, avg_size_cm || null, biomass_kg || null, notes || null, req.params.speciesId, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Species entry not found' } });
  res.json(result.rows[0]);
});

router.delete('/design-books/:id/species/:speciesId', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    'DELETE FROM design_book_exhibit_species WHERE id=$1 AND design_book_id=$2 RETURNING id',
    [req.params.speciesId, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Species entry not found' } });
  res.json({ deleted: true });
});

export default router;
