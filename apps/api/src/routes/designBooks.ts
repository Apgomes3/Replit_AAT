import { Router, Response } from 'express';
import {
  authenticate, AuthRequest, requireRole, requireModuleAccess, requireModuleManage,
} from '../middleware/auth';
import pool, { query } from '../db/index';
import crypto from 'crypto';
import { logAudit } from '../db/audit';
import {
  buildDesignBookReleaseChecklist,
  DesignBookReleaseContext,
  releaseBlockers,
  validateReleaseConfirmation,
  validateReleaseBlockers,
} from '../lib/designBookRelease';
import {
  DESIGN_BOOK_DESIGNER_ROLES,
  DESIGN_BOOK_MANAGER_ROLES,
  isDesignBookContentEditable,
} from '../lib/designBookWorkflow';
import {
  AQUARIUM_CALCULATION_VERSION,
  calculateExhibitHydraulics,
  calculateSystemEngineering,
  ALLOCATION_TOLERANCE_PCT,
} from '../lib/aquariumCalculations';
import { calculateSpeciesAllocation } from '../lib/speciesAllocations';

const router = Router();
router.use(authenticate, requireModuleAccess('design_books'));

type DbRunner = (text: string, params?: any[]) => Promise<{ rows: any[] }>;
const routeParam = (value: string | string[]) => Array.isArray(value) ? value[0] : value;

async function attachSystemSideStreams(runner: DbRunner, systems: any[]) {
  if (!systems.length) return systems;
  const rows = (await runner(
    `SELECT * FROM system_flow_side_streams
     WHERE system_id = ANY($1::uuid[])
     ORDER BY parent_loop_number, sort_order, created_at, id`,
    [systems.map(system => system.id)],
  )).rows;
  const fractionators = (await runner(
    `SELECT * FROM system_flow_fractionator_allocations
     WHERE system_id = ANY($1::uuid[]) ORDER BY parent_loop_number`,
    [systems.map(system => system.id)],
  )).rows;
  return systems.map(system => ({
    ...system,
    side_streams: rows.filter(stream => stream.system_id === system.id),
    fractionator_allocations: fractionators.filter(allocation => allocation.system_id === system.id),
  }));
}

function nullableSpeciesNumber(value: unknown, label: string, allowZero = false): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new Error(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} number.`);
  }
  return parsed;
}

function nullableSpeciesQuantity(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error('Quantity must be a non-negative whole number.');
  return parsed;
}

async function loadCatalogSpecies(id: string | null) {
  if (!id) return null;
  const result = await query('SELECT * FROM aquarium_species_catalog WHERE id=$1', [id]);
  return result.rows[0] || null;
}

function speciesValueSources(row: any) {
  return {
    ...row,
    avg_size_source: row.avg_size_override_cm != null
      ? 'override'
      : row.catalog_species_id ? 'catalog_snapshot' : 'manual',
    reference_mass_source: row.reference_mass_override_kg != null
      ? 'override'
      : row.catalog_species_id ? 'catalog_snapshot' : row.reference_average_mass_kg != null ? 'manual' : null,
    biomass_source: row.catalog_species_id
      ? row.biomass_override_kg != null ? 'override' : row.biomass_kg != null ? 'calculated' : null
      : row.biomass_kg != null ? 'manual' : null,
  };
}

async function insertAudit(
  runner: DbRunner,
  actorId: string | null,
  entityType: string,
  entityId: string,
  action: string,
  details: Record<string, any>,
  ipAddress?: string,
) {
  await runner(
    `INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [entityType, entityId, action, actorId, details, ipAddress || null],
  );
}

async function loadReleaseContext(
  id: string,
  runner: DbRunner = query,
  lock = false,
  liveOnly = false,
): Promise<DesignBookReleaseContext & Record<string, any>> {
  const bookResult = await runner(
    `SELECT db.*, p.project_scopes, p.project_code, p.project_name
     FROM design_books db
     LEFT JOIN projects p ON db.project_id = p.id
     WHERE db.id = $1${lock ? ' FOR UPDATE OF db' : ''}`,
    [id],
  );
  const book = bookResult.rows[0];
  if (!book) return null as any;

  let exhibits: any[] = [];
  let tanks: any[] = [];
  let systems: any[] = [];
  if (book.project_id) {
    const exhibitResult = await runner('SELECT * FROM exhibits WHERE project_id=$1 ORDER BY exhibit_code', [book.project_id]);
    const tankResult = await runner(
      `SELECT t.*,
         t.gross_volume_m3 AS project_gross_volume_m3,
         t.operating_volume_m3 AS project_operating_volume_m3,
         pm.operating_volume_m3 AS pim_operating_volume_m3,
         pm.product_code AS pim_product_code,
         pm.product_name AS pim_product_name,
         tf.name AS pim_tank_family_name,
         COALESCE(t.tank_type, pm.application_type) AS eff_tank_type,
         COALESCE(t.shape_type, pm.shape_type) AS eff_shape,
         COALESCE(t.length_mm, pm.length_mm) AS eff_length_mm,
         COALESCE(t.width_mm, pm.width_mm) AS eff_width_mm,
         COALESCE(t.height_mm, pm.height_mm) AS eff_height_mm,
         COALESCE(t.design_water_level_mm, pm.design_water_level_mm) AS eff_water_level_mm,
         COALESCE(t.primary_material, pm.primary_material_code) AS eff_primary_material,
         COALESCE(t.notes, pm.notes) AS eff_notes,
         COALESCE(t.gross_volume_m3, pm.gross_volume_m3) AS gross_volume_m3,
         COALESCE(t.operating_volume_m3, pm.operating_volume_m3) AS design_volume_m3,
         COALESCE(
           t.surface_area_m2,
           pm.surface_area_m2,
           CASE
             WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
                  AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) / 1000000.0)::numeric, 4)
             WHEN COALESCE(t.shape_type, pm.shape_type) NOT IN ('Cylindrical', 'Custom')
                  AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
                  AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
               THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)/1000000.0)::numeric, 4)
             ELSE NULL
           END
         ) AS surface_area_m2
       FROM tanks t
       LEFT JOIN product_masters pm ON pm.id=t.product_master_id
       LEFT JOIN tank_families tf ON tf.id=pm.tank_family_id
       WHERE t.project_id=$1
       ORDER BY t.tank_code`,
      [book.project_id],
    );
    const systemResult = await runner('SELECT * FROM systems WHERE project_id=$1 ORDER BY system_code', [book.project_id]);
    exhibits = exhibitResult.rows;
    tanks = tankResult.rows;
    systems = await attachSystemSideStreams(runner, systemResult.rows);
  }

  const speciesResult = await runner(
    `SELECT s.*, c.family AS catalog_family, c.water_type AS catalog_water_type,
            c.active AS catalog_active
     FROM design_book_exhibit_species s
     LEFT JOIN aquarium_species_catalog c ON c.id=s.catalog_species_id
     WHERE s.design_book_id=$1 ORDER BY s.exhibit_id, s.sort_order`,
    [id],
  );
  const hydraulicsResult = await runner('SELECT * FROM design_book_exhibit_hydraulics WHERE design_book_id=$1', [id]);
  const substrateResult = await runner('SELECT * FROM design_book_exhibit_substrate WHERE design_book_id=$1', [id]);
  const species = speciesResult.rows.map(speciesValueSources);
  const hydraulics = hydraulicsResult.rows;
  const substrate = substrateResult.rows;
  const handovers = (await runner(
    `SELECT h.*, u.first_name || ' ' || u.last_name AS created_by_name
     FROM design_book_review_handovers h
     LEFT JOIN users u ON u.id=h.created_by
     WHERE h.design_book_id=$1
     ORDER BY h.meeting_date DESC, h.created_at DESC`,
    [id],
  )).rows;
  const calculatedAt = new Date().toISOString();
  const exhibitCalculations = exhibits.map(exhibit => calculateExhibitHydraulics(
    exhibit,
    tanks.filter(tank => tank.exhibit_id === exhibit.id),
    hydraulics.find(record => record.exhibit_id === exhibit.id),
    substrate.find(record => record.exhibit_id === exhibit.id),
    calculatedAt,
  ));

  let links: any[] = [];
  let biologicalMediaCases: any[] = [];
  if (systems.length) {
    const linksResult = await runner(
      'SELECT sel.*, e.exhibit_code FROM system_exhibit_links sel LEFT JOIN exhibits e ON e.id=sel.exhibit_id WHERE sel.system_id = ANY($1::uuid[])',
      [systems.map(system => system.id)],
    );
    links = linksResult.rows;
    biologicalMediaCases = (await runner(
      `SELECT c.*, mp.profile_code AS media_profile_code, mp.profile_name AS media_profile_name,
              mp.revision AS media_profile_revision, mp.status AS media_profile_status,
              tp.profile_code AS tan_profile_code, tp.profile_name AS tan_profile_name,
              tp.revision AS tan_profile_revision, tp.status AS tan_profile_status
       FROM lss_biological_media_cases c
       LEFT JOIN lss_biological_media_profiles mp ON mp.id=c.media_profile_revision_id
       LEFT JOIN lss_tan_generation_profiles tp ON tp.id=c.tan_generation_profile_revision_id
       WHERE c.design_book_id=$1 AND c.system_id = ANY($2::uuid[])`,
      [id, systems.map(system => system.id)],
    )).rows;
    if (biologicalMediaCases.length) {
      const biologicalSpecies = (await runner(
        `SELECT * FROM lss_biological_media_species
         WHERE case_id = ANY($1::uuid[]) ORDER BY case_id, sort_order, id`,
        [biologicalMediaCases.map(item => item.id)],
      )).rows;
      biologicalMediaCases = biologicalMediaCases.map(item => ({
        ...item,
        species_rows: biologicalSpecies.filter(row => row.case_id === item.id),
      }));
    }
  }
  const compactUnitIds = systems.map(system => system.compact_unit_id).filter(Boolean);
  const compactUnits = compactUnitIds.length
    ? (await runner('SELECT * FROM lss_compact_units WHERE id = ANY($1::uuid[])', [compactUnitIds])).rows
    : [];
  const systemCalculations = systems.map(system => calculateSystemEngineering(
    system,
    links.filter(link => link.system_id === system.id),
    exhibitCalculations,
    compactUnits.find(unit => unit.id === system.compact_unit_id) || null,
    calculatedAt,
    system.side_streams || [],
    system.fractionator_allocations || [],
  ));
  const currentSystems = systems.map(system => {
    const calculation = systemCalculations.find(
      item => item.inputs.system_id === system.id);
    return {
      ...system,
      stored_design_flow_m3h: system.design_flow_m3h,
      design_flow_m3h: calculation?.results.design_flow_m3h ?? null,
      design_flow_source: calculation?.inputs.design_flow_source || 'linked_exhibits',
    };
  });

  const liveContext = {
    ...book,
    exhibits,
    tanks,
    systems: currentSystems,
    system_links: links,
    species,
    hydraulics,
    substrate,
    review_handovers: handovers,
    biological_media_cases: biologicalMediaCases,
    engineering_calculations: {
      calculation_version: AQUARIUM_CALCULATION_VERSION,
      calculated_at: calculatedAt,
      exhibits: exhibitCalculations,
      systems: systemCalculations,
    },
  };
  if (!liveOnly && ['For Review', 'Approved'].includes(book.status) && book.review_snapshot) {
    return {
      ...book.review_snapshot,
      id: book.id,
      book_code: book.book_code,
      book_title: book.book_title,
      revision: book.revision,
      status: book.status,
      review_submitted_by: book.review_submitted_by,
      review_submitted_at: book.review_submitted_at,
      approved_by: book.approved_by,
      approved_at: book.approved_at,
      approval_notes: book.approval_notes,
      review_snapshot: book.review_snapshot,
    };
  }
  return liveContext;
}

async function ensureBookEditable(id: string, res: Response) {
  const result = await query('SELECT status FROM design_books WHERE id=$1', [id]);
  if (!result.rows[0]) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    return false;
  }
  if (!isDesignBookContentEditable(result.rows[0].status)) {
    res.status(409).json({
      error: {
        code: 'DESIGN_BOOK_NOT_EDITABLE',
        message: 'Design Books are read-only while under review, approved, or released. Create a new revision or return to design before editing.',
      },
    });
    return false;
  }
  return true;
}

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
    `SELECT db.*, p.project_code, p.project_name, p.client_name, p.site_name, p.country, p.project_scopes,
       u.first_name || ' ' || u.last_name as created_by_name,
       ru.first_name || ' ' || ru.last_name as released_by_name,
       su.first_name || ' ' || su.last_name as review_submitted_by_name,
       au.first_name || ' ' || au.last_name as approved_by_name
     FROM design_books db
     LEFT JOIN projects p ON db.project_id = p.id
     LEFT JOIN users u ON db.created_by = u.id
     LEFT JOIN users ru ON db.released_by = ru.id
     LEFT JOIN users su ON db.review_submitted_by = su.id
     LEFT JOIN users au ON db.approved_by = au.id
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
        t.gross_volume_m3 as project_gross_volume_m3,
        t.operating_volume_m3 as project_operating_volume_m3,
        pm.operating_volume_m3 as pim_operating_volume_m3,
        e.exhibit_name, e.water_type as exhibit_water_type,
        s.system_code, s.system_name,
        pm.product_code, pm.product_name as product_name,
         pm.product_code as pim_product_code,
         pm.product_name as pim_product_name,
         tf.name as pim_tank_family_name,
         COALESCE(t.tank_type, pm.application_type) as eff_tank_type,
         COALESCE(t.primary_material, pm.primary_material_code) as eff_primary_material,
         COALESCE(t.notes, pm.notes) as eff_notes,
        promoted_pm.id as promoted_product_master_id,
        promoted_pm.product_code as promoted_product_code,
        mat.material_code, mat.material_name,
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
            WHEN COALESCE(t.shape_type, pm.shape_type) NOT IN ('Cylindrical', 'Custom')
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
            WHEN COALESCE(t.shape_type, pm.shape_type) NOT IN ('Cylindrical', 'Custom')
                 AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
                 AND COALESCE(t.design_water_level_mm, pm.design_water_level_mm) IS NOT NULL
              THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)*COALESCE(t.design_water_level_mm,pm.design_water_level_mm)/1000000000.0)::numeric, 4)
            ELSE NULL
          END,
          t.operating_volume_m3, pm.operating_volume_m3
        ) as design_volume_m3,
        COALESCE(
          t.surface_area_m2,
          pm.surface_area_m2,
          CASE
            WHEN COALESCE(t.shape_type, pm.shape_type) = 'Cylindrical'
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
              THEN ROUND((PI() * POWER(COALESCE(t.width_mm, pm.width_mm) / 2.0, 2) / 1000000.0)::numeric, 4)
            WHEN COALESCE(t.shape_type, pm.shape_type) NOT IN ('Cylindrical', 'Custom')
                 AND COALESCE(t.length_mm, pm.length_mm) IS NOT NULL
                 AND COALESCE(t.width_mm, pm.width_mm) IS NOT NULL
              THEN ROUND((COALESCE(t.length_mm,pm.length_mm)*COALESCE(t.width_mm,pm.width_mm)/1000000.0)::numeric, 4)
            ELSE NULL
          END
        ) as surface_area_m2
       FROM tanks t
       LEFT JOIN exhibits e ON t.exhibit_id = e.id
       LEFT JOIN systems s ON t.system_id = s.id
       LEFT JOIN product_masters pm ON t.product_master_id = pm.id
        LEFT JOIN tank_families tf ON tf.id = pm.tank_family_id
       LEFT JOIN product_masters promoted_pm ON promoted_pm.source_tank_id = t.id
       LEFT JOIN materials mat ON t.material_id = mat.id
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
    systems = await attachSystemSideStreams(query, sysResult.rows);
  }

  const speciesResult = await query(
    `SELECT s.*, c.family AS catalog_family, c.water_type AS catalog_water_type,
            c.active AS catalog_active
     FROM design_book_exhibit_species s
     LEFT JOIN aquarium_species_catalog c ON c.id=s.catalog_species_id
     WHERE s.design_book_id = $1 ORDER BY s.exhibit_id, s.sort_order, s.species_name`,
    [req.params.id]
  );
  species = speciesResult.rows.map(speciesValueSources);

  const hydraulicsResult = await query(
    `SELECT * FROM design_book_exhibit_hydraulics WHERE design_book_id = $1`,
    [req.params.id]
  );
  const hydraulics = hydraulicsResult.rows;

  const substrateResult = await query(
    `SELECT * FROM design_book_exhibit_substrate WHERE design_book_id = $1`,
    [req.params.id]
  );
  const substrate = substrateResult.rows;

  // All design-book hydraulic and LSS values are calculated here from the
  // current project inputs.  Consumers receive the inputs and policy along
  // with the values, so they do not need to reproduce engineering formulas.
  const calculationTimestamp = new Date().toISOString();
  const exhibitCalculations = exhibits.map(exhibit => {
    const hydraulic = hydraulics.find(h => h.exhibit_id === exhibit.id);
    const substrateRecord = substrate.find(s => s.exhibit_id === exhibit.id);
    return calculateExhibitHydraulics(
      exhibit,
      tanks.filter(tank => tank.exhibit_id === exhibit.id),
      hydraulic,
      substrateRecord,
      calculationTimestamp,
    );
  });

  let systemLinks: any[] = [];
  if (systems.length > 0) {
    const linkResult = await query(
      `SELECT sel.*, e.exhibit_code
       FROM system_exhibit_links sel
       LEFT JOIN exhibits e ON e.id = sel.exhibit_id
       WHERE sel.system_id = ANY($1::uuid[])`,
      [systems.map(system => system.id)],
    );
    systemLinks = linkResult.rows;
  }
  const compactUnitIds = systems
    .map(system => system.compact_unit_id)
    .filter(Boolean);
  const compactUnits = compactUnitIds.length > 0
    ? (await query('SELECT * FROM lss_compact_units WHERE id = ANY($1::uuid[])', [compactUnitIds])).rows
    : [];
  const systemCalculations = systems.map(system => calculateSystemEngineering(
    system,
    systemLinks.filter(link => link.system_id === system.id),
    exhibitCalculations,
    compactUnits.find(unit => unit.id === system.compact_unit_id) || null,
    calculationTimestamp,
    system.side_streams || [],
    system.fractionator_allocations || [],
  ));
  const currentSystems = systems.map(system => {
    const calculation = systemCalculations.find(
      item => item.inputs.system_id === system.id);
    return {
      ...system,
      stored_design_flow_m3h: system.design_flow_m3h,
      design_flow_m3h: calculation?.results.design_flow_m3h ?? null,
      design_flow_source: calculation?.inputs.design_flow_source || 'linked_exhibits',
    };
  });

  const livePackage = {
    exhibits,
    tanks,
    systems: currentSystems,
    system_links: systemLinks,
    species,
    hydraulics,
    substrate,
    engineering_calculations: {
      calculation_version: AQUARIUM_CALCULATION_VERSION,
      calculated_at: calculationTimestamp,
      policy: {
        turnover_unit: 'cycles_per_hour',
        flow_unit: 'm3_per_hour',
        allocation_tolerance_pct: 0.01,
        volume_definition: 'operating water volume less substrate and theming displacement',
        rounding: 'volumes to 4 decimals m³; flows to 3 decimals m³/h',
      },
      exhibits: exhibitCalculations,
      systems: systemCalculations,
    },
  };
  const releasedPackage = row.status === 'Released' && row.release_snapshot
    ? row.release_snapshot
    : ['For Review', 'Approved'].includes(row.status) && row.review_snapshot
      ? row.review_snapshot
      : livePackage;

  res.json({
    ...row,
    ...releasedPackage,
    id: row.id,
    book_code: row.book_code,
    book_title: row.book_title,
    revision: row.revision,
    status: row.status,
    release_scope: row.release_scope,
    release_notes: row.release_notes,
    released_by_name: row.released_by_name,
    released_at: row.released_at,
  });
});

router.get('/design-books/:id/release-preflight', authenticate, async (req: AuthRequest, res: Response) => {
  const context = await loadReleaseContext(routeParam(req.params.id));
  if (!context) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  const checklist = buildDesignBookReleaseChecklist(context);
  res.json({
    design_book_id: req.params.id,
    status: context.status,
    revision: context.revision,
    checklist,
    blockers: releaseBlockers(checklist),
  });
});

router.post('/design-books', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const { book_code, book_title, project_id, description, revision, status, notes } = req.body;
  if (!book_code || !book_title) return res.status(400).json({ error: { code: 'VALIDATION', message: 'book_code and book_title are required' } });
  if (status && status !== 'Draft') {
    return res.status(400).json({
      error: { code: 'WORKFLOW_ACTION_REQUIRED', message: 'New Design Books must start as Draft.' },
    });
  }
  const result = await query(
    `INSERT INTO design_books (book_code, book_title, project_id, description, revision, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [book_code, book_title, project_id || null, description || null, revision || 'A', 'Draft', notes || null, req.user!.id]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/design-books/:id', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const { book_title, project_id, description, revision, status, notes } = req.body;
  const existing = await query('SELECT status FROM design_books WHERE id=$1', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  if (status && status !== existing.rows[0].status) {
    return res.status(400).json({
      error: { code: 'WORKFLOW_ACTION_REQUIRED', message: 'Use the Design Book review, approval, or release action to change workflow status.' },
    });
  }
  if (!await ensureBookEditable(routeParam(req.params.id), res)) return;
  const result = await query(
    `UPDATE design_books SET book_title=$1, project_id=$2, description=$3, revision=$4, status=$5, notes=$6, updated_at=NOW()
     WHERE id=$7 AND status <> 'Released' RETURNING *`,
    [book_title, project_id || null, description || null, revision || 'A', existing.rows[0].status, notes || null, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  res.json(result.rows[0]);
});

router.delete('/design-books/:id', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  if (!await ensureBookEditable(routeParam(req.params.id), res)) return;
  const result = await query(
    `DELETE FROM design_books
     WHERE id=$1 AND status <> 'Released'
     RETURNING id`,
    [req.params.id],
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  res.json({ deleted: true });
});

// Species CRUD
router.post('/design-books/:id/species', authenticate, requireRole('admin', 'engineer'), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  if (!await ensureBookEditable(routeParam(req.params.id), res)) return;
  const catalogId = req.body.catalog_species_id || req.body.catalog_id || null;
  const catalog = await loadCatalogSpecies(catalogId);
  if (catalogId && !catalog) return res.status(400).json({ error: { code: 'INVALID_CATALOG_SPECIES', message: 'Selected catalog species does not exist.' } });
  if (catalog && !catalog.active) return res.status(409).json({ error: { code: 'INACTIVE_CATALOG_SPECIES', message: 'Inactive catalog species cannot be added to a new allocation.' } });
  const speciesName = String(catalog?.scientific_name || req.body.species_name || '').trim();
  const exhibitId = String(req.body.exhibit_id || '').trim();
  if (!exhibitId || !speciesName) return res.status(400).json({ error: { code: 'VALIDATION', message: 'exhibit_id and a catalog or custom scientific name are required.' } });
  try {
    const quantity = nullableSpeciesQuantity(req.body.quantity);
    const avgSizeOverride = catalog ? nullableSpeciesNumber(req.body.avg_size_override_cm, 'Average size override') : null;
    const massOverride = catalog ? nullableSpeciesNumber(req.body.reference_mass_override_kg, 'Reference mass override') : null;
    const biomassOverride = catalog
      ? nullableSpeciesNumber(req.body.biomass_override_kg ?? req.body.biomass_kg, 'Biomass override', true)
      : null;
    const manualAverageSize = catalog ? null : nullableSpeciesNumber(req.body.avg_size_cm, 'Average size');
    const manualReferenceMass = catalog ? null : nullableSpeciesNumber(req.body.reference_average_mass_kg, 'Reference average mass');
    const manualBiomass = catalog ? null : nullableSpeciesNumber(req.body.biomass_kg, 'Biomass', true);
    const calculated = calculateSpeciesAllocation({
      quantity,
      catalogLinked: !!catalog,
      catalogAverageSizeCm: catalog ? nullableSpeciesNumber(catalog.average_size_cm, 'Catalog average size') : null,
      catalogReferenceMassKg: catalog ? nullableSpeciesNumber(catalog.reference_average_mass_kg, 'Catalog reference mass') : null,
      manualAverageSizeCm: manualAverageSize,
      manualReferenceMassKg: manualReferenceMass,
      manualBiomassKg: manualBiomass,
      averageSizeOverrideCm: avgSizeOverride,
      referenceMassOverrideKg: massOverride,
      biomassOverrideKg: biomassOverride,
    });
    const result = await query(
      `INSERT INTO design_book_exhibit_species
         (design_book_id, exhibit_id, catalog_species_id, species_name, common_name, quantity,
          avg_size_cm, reference_average_mass_kg, biomass_kg, avg_size_override_cm,
          reference_mass_override_kg, biomass_override_kg, notes, sort_order)
       SELECT db.id, e.id, $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
       FROM design_books db
       JOIN exhibits e ON e.id=$2 AND e.project_id=db.project_id
       WHERE db.id=$1
       RETURNING *`,
      [req.params.id, exhibitId, catalogId, speciesName, catalog?.common_name || req.body.common_name || null,
        quantity, calculated.average_size_cm, calculated.reference_average_mass_kg, calculated.biomass_kg,
        avgSizeOverride, massOverride, biomassOverride,
        req.body.notes || null, Number(req.body.sort_order) || 0],
    );
    if (!result.rows[0]) {
      return res.status(400).json({ error: { code: 'INVALID_EXHIBIT', message: 'Exhibit must belong to the Design Book project.' } });
    }
    res.status(201).json(speciesValueSources(result.rows[0]));
  } catch (error: any) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
  }
});

router.put('/design-books/:id/species/:speciesId', authenticate, requireRole('admin', 'engineer'), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  if (!await ensureBookEditable(routeParam(req.params.id), res)) return;
  const existingResult = await query(
    `SELECT s.*
     FROM design_book_exhibit_species s
     JOIN design_books db ON db.id=s.design_book_id
     JOIN exhibits e ON e.id=s.exhibit_id AND e.project_id=db.project_id
     WHERE s.id=$1 AND s.design_book_id=$2`,
    [req.params.speciesId, req.params.id],
  );
  const existing = existingResult.rows[0];
  if (!existing) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Species entry not found' } });
  const catalogId = req.body.catalog_species_id !== undefined || req.body.catalog_id !== undefined
    ? req.body.catalog_species_id || req.body.catalog_id || null
    : existing.catalog_species_id;
  const catalog = await loadCatalogSpecies(catalogId);
  if (catalogId && !catalog) return res.status(400).json({ error: { code: 'INVALID_CATALOG_SPECIES', message: 'Selected catalog species does not exist.' } });
  const catalogChanged = String(catalogId || '') !== String(existing.catalog_species_id || '');
  if (catalog && !catalog.active && catalogChanged) {
    return res.status(409).json({ error: { code: 'INACTIVE_CATALOG_SPECIES', message: 'Inactive catalog species cannot be selected for a new allocation.' } });
  }
  try {
    const quantity = nullableSpeciesQuantity(
      Object.prototype.hasOwnProperty.call(req.body, 'quantity') ? req.body.quantity : existing.quantity,
    );
    const hasAvgOverride = Object.prototype.hasOwnProperty.call(req.body, 'avg_size_override_cm');
    const hasMassOverride = Object.prototype.hasOwnProperty.call(req.body, 'reference_mass_override_kg');
    const hasBiomassOverride = Object.prototype.hasOwnProperty.call(req.body, 'biomass_override_kg')
      || Object.prototype.hasOwnProperty.call(req.body, 'biomass_kg');
    const avgSizeOverride = catalog
      ? nullableSpeciesNumber(hasAvgOverride ? req.body.avg_size_override_cm : existing.avg_size_override_cm, 'Average size override')
      : null;
    const massOverride = catalog
      ? nullableSpeciesNumber(hasMassOverride ? req.body.reference_mass_override_kg : existing.reference_mass_override_kg, 'Reference mass override')
      : null;
    const biomassOverride = catalog
      ? nullableSpeciesNumber(
          hasBiomassOverride ? req.body.biomass_override_kg ?? req.body.biomass_kg : existing.biomass_override_kg,
          'Biomass override',
          true,
        )
      : null;
    const refreshCatalog = catalogChanged || req.body.refresh_catalog === true;
    const averageCatalogBaseline = refreshCatalog || (hasAvgOverride && avgSizeOverride == null && existing.avg_size_override_cm != null)
      ? catalog?.average_size_cm
      : existing.avg_size_cm;
    const massCatalogBaseline = refreshCatalog || (hasMassOverride && massOverride == null && existing.reference_mass_override_kg != null)
      ? catalog?.reference_average_mass_kg
      : existing.reference_average_mass_kg;
    const manualAverageSize = catalog ? null : nullableSpeciesNumber(
      Object.prototype.hasOwnProperty.call(req.body, 'avg_size_cm') ? req.body.avg_size_cm : existing.avg_size_cm,
      'Average size',
    );
    const manualReferenceMass = catalog ? null : nullableSpeciesNumber(
      Object.prototype.hasOwnProperty.call(req.body, 'reference_average_mass_kg')
        ? req.body.reference_average_mass_kg
        : existing.reference_average_mass_kg,
      'Reference average mass',
    );
    const manualBiomass = catalog ? null : nullableSpeciesNumber(
      Object.prototype.hasOwnProperty.call(req.body, 'biomass_kg') ? req.body.biomass_kg : existing.biomass_kg,
      'Biomass',
      true,
    );
    const calculated = calculateSpeciesAllocation({
      quantity,
      catalogLinked: !!catalog,
      catalogAverageSizeCm: catalog ? nullableSpeciesNumber(averageCatalogBaseline, 'Catalog average size') : null,
      catalogReferenceMassKg: catalog ? nullableSpeciesNumber(massCatalogBaseline, 'Catalog reference mass') : null,
      manualAverageSizeCm: manualAverageSize,
      manualReferenceMassKg: manualReferenceMass,
      manualBiomassKg: manualBiomass,
      averageSizeOverrideCm: avgSizeOverride,
      referenceMassOverrideKg: massOverride,
      biomassOverrideKg: biomassOverride,
    });
    const speciesName = String(
      catalog && refreshCatalog ? catalog.scientific_name : req.body.species_name || existing.species_name,
    ).trim();
    const commonName = catalog && refreshCatalog
      ? catalog.common_name
      : req.body.common_name !== undefined ? req.body.common_name || null : existing.common_name;
    if (!speciesName) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Scientific name is required.' } });
    const result = await query(
      `UPDATE design_book_exhibit_species
       SET catalog_species_id=$1, species_name=$2, common_name=$3, quantity=$4,
           avg_size_cm=$5, reference_average_mass_kg=$6, biomass_kg=$7,
           avg_size_override_cm=$8, reference_mass_override_kg=$9,
           biomass_override_kg=$10, notes=$11, updated_at=NOW()
       WHERE id=$12 AND design_book_id=$13 RETURNING *`,
      [catalogId, speciesName, commonName, quantity,
        calculated.average_size_cm, calculated.reference_average_mass_kg, calculated.biomass_kg,
        avgSizeOverride, massOverride, biomassOverride,
        req.body.notes !== undefined ? req.body.notes || null : existing.notes,
        req.params.speciesId, req.params.id],
    );
    res.json(speciesValueSources(result.rows[0]));
  } catch (error: any) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
  }
});

router.put('/design-books/:id/exhibits/:exhibitId/substrate', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  if (!await ensureBookEditable(routeParam(req.params.id), res)) return;
  const { substrate_type, substrate_height_mm, substrate_volume_m3, theming_type, theming_height_mm, theming_volume_m3, theming_volume_pct, notes } = req.body;
  for (const [label, value] of [
    ['Substrate height', substrate_height_mm],
    ['Substrate volume', substrate_volume_m3],
    ['Theming height', theming_height_mm],
    ['Theming volume', theming_volume_m3],
    ['Theming percentage', theming_volume_pct],
  ] as Array<[string, any]>) {
    if (value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: `${label} must be a non-negative number.` } });
    }
  }
  if (theming_volume_pct != null && Number(theming_volume_pct) > 100) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Theming percentage cannot exceed 100%.' } });
  }
  const tankVolumeResult = await query(
    `SELECT SUM(COALESCE(t.operating_volume_m3, pm.operating_volume_m3, 0) * COALESCE(t.quantity, 1)) AS volume_m3
     FROM tanks t
     LEFT JOIN product_masters pm ON pm.id=t.product_master_id
     WHERE t.exhibit_id=$1`,
    [req.params.exhibitId],
  );
  const grossOperatingVolume = Number(tankVolumeResult.rows[0]?.volume_m3);
  if (theming_volume_pct != null && !(grossOperatingVolume > 0)) {
    return res.status(400).json({
      error: { code: 'VALIDATION', message: 'A known tank operating volume is required to use percentage-based theming displacement.' },
    });
  }
  const resolvedThemingVolume = theming_volume_pct != null
    ? Math.round(grossOperatingVolume * Number(theming_volume_pct) / 100 * 1e6) / 1e6
    : (theming_volume_m3 ?? null);
  const displacement = Number(substrate_volume_m3 || 0) + Number(resolvedThemingVolume || 0);
  if (grossOperatingVolume > 0 && displacement >= grossOperatingVolume) {
    return res.status(400).json({
      error: { code: 'VALIDATION', message: 'Substrate and theming displacement must be less than operating volume.' },
    });
  }
  const result = await query(
    `INSERT INTO design_book_exhibit_substrate
       (design_book_id, exhibit_id, substrate_type, substrate_height_mm, substrate_volume_m3, theming_type, theming_height_mm, theming_volume_m3, theming_volume_pct, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (design_book_id, exhibit_id)
     DO UPDATE SET
       substrate_type      = EXCLUDED.substrate_type,
       substrate_height_mm = EXCLUDED.substrate_height_mm,
       substrate_volume_m3 = EXCLUDED.substrate_volume_m3,
       theming_type        = EXCLUDED.theming_type,
       theming_height_mm   = EXCLUDED.theming_height_mm,
       theming_volume_m3   = EXCLUDED.theming_volume_m3,
       theming_volume_pct  = EXCLUDED.theming_volume_pct,
       notes               = EXCLUDED.notes,
       updated_at          = NOW()
     RETURNING *`,
    [req.params.id, req.params.exhibitId,
     substrate_type || null, substrate_height_mm ?? null, substrate_volume_m3 ?? null,
     theming_type || null, theming_height_mm ?? null, resolvedThemingVolume,
     theming_volume_pct ?? null, notes || null]
  );
  res.json(result.rows[0]);
});

router.put('/design-books/:id/exhibits/:exhibitId/hydraulics', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  if (!await ensureBookEditable(routeParam(req.params.id), res)) return;
  const {
    target_turnover_rate, surface_skim_pct, bottom_drain_pct, notes,
    weir_head_mm, weir_length_mm, weir_formula_method, weir_geometry,
    weir_end_contractions, weir_discharge_condition, weir_downstream_head_mm,
  } = req.body;
  const hasField = (field: string) => Object.prototype.hasOwnProperty.call(req.body, field);
  const hasWeirHead = hasField('weir_head_mm');
  const hasWeirLength = hasField('weir_length_mm');
  const hasWeirMethod = hasField('weir_formula_method');
  const hasWeirGeometry = hasField('weir_geometry');
  const hasWeirContractions = hasField('weir_end_contractions');
  const hasWeirDischarge = hasField('weir_discharge_condition');
  const hasWeirDownstreamHead = hasField('weir_downstream_head_mm');
  if (weir_formula_method != null && !['francis_184', 'bazin_1888'].includes(weir_formula_method)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Unsupported weir formula method' } });
  }
  if (weir_geometry != null && weir_geometry !== 'sharp_rectangular') {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Only sharp-crested rectangular weirs are supported' } });
  }
  if (weir_end_contractions != null &&
      (!Number.isInteger(Number(weir_end_contractions)) || Number(weir_end_contractions) < 0 || Number(weir_end_contractions) > 2)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Weir end contractions must be 0, 1, or 2' } });
  }
  if (weir_discharge_condition != null && !['free', 'submerged'].includes(weir_discharge_condition)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Unsupported weir discharge condition' } });
  }
  if (weir_head_mm != null && (!Number.isFinite(Number(weir_head_mm)) || Number(weir_head_mm) < 0)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Weir head must be a non-negative number' } });
  }
  if (weir_length_mm != null && (!Number.isFinite(Number(weir_length_mm)) || Number(weir_length_mm) < 0)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Weir length must be a non-negative number' } });
  }
  if (weir_downstream_head_mm != null &&
      (!Number.isFinite(Number(weir_downstream_head_mm)) || Number(weir_downstream_head_mm) < 0)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Downstream head must be a non-negative number' } });
  }
  const numericFields: Array<[string, any]> = [
    ['target turnover rate', target_turnover_rate],
    ['surface skim percentage', surface_skim_pct],
    ['bottom drain percentage', bottom_drain_pct],
  ];
  for (const [label, value] of numericFields) {
    if (value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: `${label} must be a non-negative number` } });
    }
  }
  if (target_turnover_rate != null && Number(target_turnover_rate) === 0) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Target turnover rate must be greater than zero' } });
  }
  const savedSurfacePct = surface_skim_pct ?? 30;
  const savedBottomPct = bottom_drain_pct ?? 70;
  if (Number(savedSurfacePct) > 100 || Number(savedBottomPct) > 100 ||
      Math.abs(Number(savedSurfacePct) + Number(savedBottomPct) - 100) > ALLOCATION_TOLERANCE_PCT) {
    return res.status(400).json({
      error: { code: 'VALIDATION', message: `Surface and bottom allocations must total 100% ± ${ALLOCATION_TOLERANCE_PCT}%.` },
    });
  }
  const result = await query(
    `INSERT INTO design_book_exhibit_hydraulics
       (design_book_id, exhibit_id, target_turnover_rate, surface_skim_pct, bottom_drain_pct, notes,
        weir_head_mm, weir_length_mm, weir_formula_method, weir_geometry, weir_end_contractions,
        weir_discharge_condition, weir_downstream_head_mm,
        calculation_version, last_calculated_at, calculation_inputs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
        '${AQUARIUM_CALCULATION_VERSION}',NOW(),$21)
     ON CONFLICT (design_book_id, exhibit_id)
     DO UPDATE SET
       target_turnover_rate = EXCLUDED.target_turnover_rate,
       surface_skim_pct     = EXCLUDED.surface_skim_pct,
       bottom_drain_pct     = EXCLUDED.bottom_drain_pct,
       notes                = EXCLUDED.notes,
       weir_head_mm = CASE WHEN $14 THEN EXCLUDED.weir_head_mm ELSE design_book_exhibit_hydraulics.weir_head_mm END,
       weir_length_mm = CASE WHEN $15 THEN EXCLUDED.weir_length_mm ELSE design_book_exhibit_hydraulics.weir_length_mm END,
       weir_formula_method = CASE WHEN $16 THEN EXCLUDED.weir_formula_method ELSE design_book_exhibit_hydraulics.weir_formula_method END,
       weir_geometry = CASE WHEN $17 THEN EXCLUDED.weir_geometry ELSE design_book_exhibit_hydraulics.weir_geometry END,
       weir_end_contractions = CASE WHEN $18 THEN EXCLUDED.weir_end_contractions ELSE design_book_exhibit_hydraulics.weir_end_contractions END,
       weir_discharge_condition = CASE WHEN $19 THEN EXCLUDED.weir_discharge_condition ELSE design_book_exhibit_hydraulics.weir_discharge_condition END,
       weir_downstream_head_mm = CASE WHEN $20 THEN EXCLUDED.weir_downstream_head_mm ELSE design_book_exhibit_hydraulics.weir_downstream_head_mm END,
       calculation_version   = EXCLUDED.calculation_version,
       last_calculated_at    = EXCLUDED.last_calculated_at,
       calculation_inputs    = EXCLUDED.calculation_inputs,
       updated_at           = NOW()
     RETURNING *`,
    [req.params.id, req.params.exhibitId,
     target_turnover_rate ?? null, savedSurfacePct, savedBottomPct,
     notes ?? null, weir_head_mm ?? null, weir_length_mm ?? null, weir_formula_method ?? null,
     weir_geometry ?? null, weir_end_contractions ?? null,
     weir_discharge_condition ?? null, weir_downstream_head_mm ?? null,
     hasWeirHead, hasWeirLength, hasWeirMethod, hasWeirGeometry, hasWeirContractions,
     hasWeirDischarge, hasWeirDownstreamHead,
     JSON.stringify({
       target_turnover_rate: target_turnover_rate ?? null,
       surface_skim_pct: savedSurfacePct,
       bottom_drain_pct: savedBottomPct,
       turnover_unit: 'cycles_per_hour',
       flow_unit: 'm3_per_hour',
       weir_head_unit: 'mm',
       weir_length_unit: 'mm',
     })]
  );
  res.json(result.rows[0]);
});

router.delete('/design-books/:id/species/:speciesId', authenticate, requireRole('admin', 'engineer'), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  if (!await ensureBookEditable(routeParam(req.params.id), res)) return;
  const result = await query(
    'DELETE FROM design_book_exhibit_species WHERE id=$1 AND design_book_id=$2 RETURNING id',
    [req.params.speciesId, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Species entry not found' } });
  res.json({ deleted: true });
});

router.get('/design-books/:id/review-handovers', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT h.*, u.first_name || ' ' || u.last_name AS created_by_name
     FROM design_book_review_handovers h
     LEFT JOIN users u ON u.id=h.created_by
     WHERE h.design_book_id=$1
     ORDER BY h.meeting_date DESC, h.created_at DESC`,
    [req.params.id],
  );
  res.json({ items: result.rows });
});

router.post(
  '/design-books/:id/review-handovers',
  authenticate,
  requireRole(...Array.from(new Set([...DESIGN_BOOK_DESIGNER_ROLES, ...DESIGN_BOOK_MANAGER_ROLES]))),
  async (req: AuthRequest, res: Response) => {
    const {
      meeting_date,
      title,
      attendees,
      purpose,
      discussion_summary,
      decisions,
      action_items,
      open_items,
      acceptance_notes,
    } = req.body;
    const attendeeList = Array.isArray(attendees)
      ? attendees.map((value: any) => String(value).trim()).filter(Boolean)
      : String(attendees || '').split(/[\n,]/).map(value => value.trim()).filter(Boolean);
    if (!meeting_date || !title?.trim()) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'Meeting date and report title are required.' },
      });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const bookResult = await client.query(
        'SELECT status, review_snapshot FROM design_books WHERE id=$1 FOR UPDATE',
        [req.params.id],
      );
      if (!bookResult.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
      }
      if (bookResult.rows[0].status !== 'For Review') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: { code: 'INVALID_HANDOVER_STATE', message: 'Handover reports can only be recorded while a Design Book is For Review.' },
        });
      }
      const result = await client.query(
        `INSERT INTO design_book_review_handovers
           (design_book_id, meeting_date, title, attendees, purpose, discussion_summary,
            decisions, action_items, open_items, acceptance_notes, created_by)
         VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          req.params.id, meeting_date, title.trim(), attendeeList, purpose || null,
          discussion_summary || null, decisions || null, action_items || null,
          open_items || null, acceptance_notes || null, req.user!.id,
        ],
      );
      const reviewSnapshot = bookResult.rows[0].review_snapshot || {};
      const handovers = Array.isArray(reviewSnapshot.review_handovers)
        ? reviewSnapshot.review_handovers
        : [];
      await client.query(
        'UPDATE design_books SET review_snapshot=$1::jsonb, updated_at=NOW() WHERE id=$2',
        [JSON.stringify({ ...reviewSnapshot, review_handovers: [...handovers, result.rows[0]] }), req.params.id],
      );
      await insertAudit(client.query.bind(client) as DbRunner, req.user!.id, 'design_book', routeParam(req.params.id), 'REVIEW_HANDOVER', {
        summary: `Review handover report recorded for ${meeting_date}`,
        handover_id: result.rows[0].id,
        title: title.trim(),
        meeting_date,
        attendees: attendeeList,
      }, req.ip);
      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
);

router.post(
  '/design-books/:id/submit-review',
  authenticate,
  requireRole(...DESIGN_BOOK_DESIGNER_ROLES),
  async (req: AuthRequest, res: Response) => {
    const comment = String(req.body.comment || '').trim();
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const context = await loadReleaseContext(
        routeParam(req.params.id),
        client.query.bind(client) as DbRunner,
        true,
      );
      if (!context || !isDesignBookContentEditable(context.status)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: { code: 'INVALID_TRANSITION', message: 'Only Draft or In Progress Design Books can be submitted for review.' },
        });
      }
      const previousStatus = context.status;
      const {
        release_snapshot: _releaseSnapshot,
        review_snapshot: _reviewSnapshot,
        ...reviewPackage
      } = context;
      const submittedAt = new Date().toISOString();
      const snapshot = {
        ...reviewPackage,
        status: 'For Review',
        review_submitted_by: req.user!.id,
        review_submitted_at: submittedAt,
      };
      const result = await client.query(
        `UPDATE design_books
         SET status='For Review', review_submitted_by=$1, review_submitted_at=NOW(),
             review_snapshot=$2::jsonb, updated_at=NOW()
         WHERE id=$3 AND status IN ('Draft', 'In Progress')
         RETURNING *`,
        [req.user!.id, JSON.stringify(snapshot), req.params.id],
      );
      if (!result.rows[0]) throw new Error('Design Book status changed during review submission');
      await client.query(
        `INSERT INTO lifecycle_transitions
           (entity_type, entity_id, from_state, to_state, actor_id, comment)
         VALUES ('design_book',$1,$2,'For Review',$3,$4)`,
        [req.params.id, previousStatus, req.user!.id, comment || null],
      );
      await insertAudit(client.query.bind(client) as DbRunner, req.user!.id, 'design_book', routeParam(req.params.id), 'SUBMIT_REVIEW', {
        summary: `Design Book submitted for review${comment ? `: ${comment}` : ''}`,
        comment,
      }, req.ip);
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
);

router.post(
  '/design-books/:id/approve',
  authenticate,
  requireRole(...DESIGN_BOOK_MANAGER_ROLES),
  async (req: AuthRequest, res: Response) => {
    const approvalNotes = String(req.body.approval_notes || '').trim();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE design_books
         SET status='Approved', approved_by=$1, approved_at=NOW(), approval_notes=$2, updated_at=NOW()
         WHERE id=$3 AND status='For Review'
         RETURNING *`,
        [req.user!.id, approvalNotes || null, req.params.id],
      );
      if (!result.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: { code: 'INVALID_TRANSITION', message: 'Only Design Books that are For Review can be approved.' },
        });
      }
      await client.query(
        `INSERT INTO lifecycle_transitions
           (entity_type, entity_id, from_state, to_state, actor_id, comment)
         VALUES ('design_book',$1,'For Review','Approved',$2,$3)`,
        [req.params.id, req.user!.id, approvalNotes || null],
      );
      await insertAudit(client.query.bind(client) as DbRunner, req.user!.id, 'design_book', routeParam(req.params.id), 'APPROVE', {
        summary: `Design Book approved${approvalNotes ? `: ${approvalNotes}` : ''}`,
        approval_notes: approvalNotes,
      }, req.ip);
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
);

router.post(
  '/design-books/:id/release',
  authenticate,
  requireRole(...DESIGN_BOOK_MANAGER_ROLES),
  async (req: AuthRequest, res: Response) => {
    const { revision, included_scope, release_notes } = req.body;
    const scope = Array.isArray(included_scope)
      ? included_scope.map((value: any) => String(value).trim()).filter(Boolean)
      : [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const context = await loadReleaseContext(
        routeParam(req.params.id),
        client.query.bind(client) as DbRunner,
        true,
      );
      if (!context) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
      }
      if (context.status === 'Released') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: { code: 'ALREADY_RELEASED', message: 'This Design Book revision is already released.' },
        });
      }
      if (context.status !== 'Approved') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: { code: 'APPROVAL_REQUIRED', message: 'The Design Book must be approved by a manager before release.' },
        });
      }
      const projectScope = Array.isArray(context.project_scopes) ? context.project_scopes : [];
      const confirmationError = validateReleaseConfirmation({
        currentRevision: String(context.revision || '').trim(),
        confirmedRevision: String(revision || '').trim(),
        includedScope: scope,
        projectScope,
        releaseNotes: String(release_notes || '').trim(),
      });
      if (confirmationError) {
        await client.query('ROLLBACK');
        return res.status(confirmationError.status).json({ error: confirmationError });
      }
      const checklist = buildDesignBookReleaseChecklist({ ...context, project_scopes: scope });
      const blockers = releaseBlockers(checklist);
      const blockerError = validateReleaseBlockers(blockers.length);
      if (blockerError) {
        await client.query('ROLLBACK');
        return res.status(blockerError.status).json({
          error: blockerError,
          checklist,
          blockers,
        });
      }

      const {
        release_snapshot: _existingSnapshot,
        release_scope: _existingScope,
        release_notes: _existingNotes,
        released_by: _existingReleaser,
        released_at: _existingReleasedAt,
        ...packageSnapshot
      } = context;
      const releasedAt = new Date().toISOString();
      const snapshot = {
        ...packageSnapshot,
        status: 'Released',
        released_revision: revision.trim(),
        included_scope: scope,
        release_notes: release_notes.trim(),
        released_by: req.user!.id,
        released_at: releasedAt,
        release_checklist: checklist,
      };
      const updated = await client.query(
        `UPDATE design_books
         SET status='Released', revision=$1, release_scope=$2::text[], release_notes=$3,
             released_by=$4, released_at=NOW(), release_snapshot=$5::jsonb, updated_at=NOW()
         WHERE id=$6 AND status <> 'Released'
         RETURNING *`,
        [revision.trim(), scope, release_notes.trim(), req.user!.id, JSON.stringify(snapshot), req.params.id],
      );
      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: { code: 'ALREADY_RELEASED', message: 'This Design Book revision is already released.' },
        });
      }
      const releasedVersionSnapshot = withSnapshotIntegrity({
        ...makeVersionSnapshot({
          ...context,
          status: 'Released',
          revision: revision.trim(),
        }),
        release: {
          included_scope: scope,
          release_notes: release_notes.trim(),
          released_by: req.user!.id,
          released_at: releasedAt,
          release_checklist: checklist,
        },
      });
      await insertVersion(
        client.query.bind(client) as DbRunner,
        routeParam(req.params.id),
        `Released Rev ${revision.trim()}`,
        release_notes.trim(),
        releasedVersionSnapshot,
        req.user!.id,
      );
      await insertAudit(client.query.bind(client) as DbRunner, req.user!.id, 'design_book', routeParam(req.params.id), 'RELEASE', {
        summary: `Design Book ${context.book_code} Rev ${revision.trim()} released`,
        revision: revision.trim(),
        included_scope: scope,
        release_notes: release_notes.trim(),
      }, req.ip);
      await client.query('COMMIT');
      res.json({
        ...updated.rows[0],
        checklist,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
);

router.post(
  '/design-books/:id/revisions',
  authenticate,
  requireRole('admin', 'engineer'),
  async (req: AuthRequest, res: Response) => {
    const sourceResult = await query('SELECT * FROM design_books WHERE id=$1', [req.params.id]);
    const source = sourceResult.rows[0];
    if (!source) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    if (source.status !== 'Released') {
      return res.status(409).json({
        error: { code: 'NOT_RELEASED', message: 'Create a version snapshot for draft work; new revisions branch from released Design Books.' },
      });
    }
    const revision = String(req.body.revision || '').trim();
    const bookCode = String(req.body.book_code || '').trim();
    if (!revision || !bookCode) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'A new revision and unique Design Book code are required.' },
      });
    }

    const snapshot = source.release_snapshot || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query(
        `INSERT INTO design_books
           (book_code, book_title, project_id, description, revision, status, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,'Draft',$6,$7)
         RETURNING *`,
        [
          bookCode,
          String(req.body.book_title || source.book_title).trim(),
          source.project_id,
          source.description,
          revision,
          req.body.notes || `Continues released ${source.book_code} Rev ${source.revision}`,
          req.user!.id,
        ],
      );
      const next = created.rows[0];
      for (const row of snapshot.species || []) {
        await client.query(
          `INSERT INTO design_book_exhibit_species
             (design_book_id, exhibit_id, catalog_species_id, species_name, common_name, quantity,
              avg_size_cm, reference_average_mass_kg, biomass_kg, avg_size_override_cm,
              reference_mass_override_kg, biomass_override_kg, notes, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [next.id, row.exhibit_id, row.catalog_species_id, row.species_name, row.common_name,
            row.quantity, row.avg_size_cm, row.reference_average_mass_kg, row.biomass_kg,
            row.avg_size_override_cm, row.reference_mass_override_kg, row.biomass_override_kg,
            row.notes, row.sort_order || 0],
        );
      }
      for (const row of snapshot.hydraulics || []) {
        await client.query(
          `INSERT INTO design_book_exhibit_hydraulics
             (design_book_id, exhibit_id, target_turnover_rate, surface_skim_pct, bottom_drain_pct, notes,
              weir_head_mm, weir_length_mm, weir_formula_method, weir_geometry, weir_end_contractions,
              weir_discharge_condition, weir_downstream_head_mm, calculation_version, last_calculated_at,
              calculation_inputs, override_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            next.id, row.exhibit_id, row.target_turnover_rate, row.surface_skim_pct, row.bottom_drain_pct, row.notes,
            row.weir_head_mm, row.weir_length_mm, row.weir_formula_method, row.weir_geometry, row.weir_end_contractions,
            row.weir_discharge_condition, row.weir_downstream_head_mm, row.calculation_version, row.last_calculated_at,
            row.calculation_inputs, row.override_reason,
          ],
        );
      }
      for (const row of snapshot.substrate || []) {
        await client.query(
          `INSERT INTO design_book_exhibit_substrate
             (design_book_id, exhibit_id, substrate_type, substrate_height_mm, substrate_volume_m3,
              theming_type, theming_height_mm, theming_volume_m3, theming_volume_pct, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            next.id, row.exhibit_id, row.substrate_type, row.substrate_height_mm, row.substrate_volume_m3,
            row.theming_type, row.theming_height_mm, row.theming_volume_m3, row.theming_volume_pct, row.notes,
          ],
        );
      }
      await client.query('COMMIT');
      await logAudit(req.user!.id, 'design_book', next.id, 'CREATE_REVISION', {
        summary: `Revision ${revision} created from ${source.book_code} Rev ${source.revision}`,
        source_design_book_id: source.id,
        source_revision: source.revision,
      }, req.ip);
      res.status(201).json(next);
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error.code === '23505') {
        return res.status(409).json({
          error: { code: 'CONFLICT', message: `Design Book code "${bookCode}" already exists.` },
        });
      }
      throw error;
    } finally {
      client.release();
    }
  },
);

// ─── Versions ────────────────────────────────────────────────────────────────

const VERSION_SNAPSHOT_SCHEMA = 4;
const VERSION_REFERENCE_FIELDS = {
  project: ['id', 'project_code', 'project_name'],
  exhibits: ['id', 'project_id', 'exhibit_code', 'exhibit_name', 'water_type',
    'design_temperature_min', 'design_temperature_max', 'design_salinity', 'area_id', 'status', 'notes'],
  tanks: ['id', 'project_id', 'tank_code', 'exhibit_id', 'system_id', 'area_id', 'quantity',
    'tank_name', 'tank_type', 'product_master_id', 'shape_type', 'gross_volume_m3',
    'operating_volume_m3', 'surface_area_m2', 'custom_footprint', 'length_mm', 'width_mm', 'height_mm', 'design_water_level_mm',
    'primary_material', 'material_id', 'wall_thickness_mm', 'inner_length_mm', 'inner_width_mm',
    'inner_height_mm', 'status', 'notes'],
  systems: ['id', 'project_id', 'system_code', 'area_id', 'exhibit_id', 'system_name', 'system_type',
    'design_flow_m3h', 'turnover_rate_hr', 'water_type', 'status', 'primary_control_panel_code',
    'duty_description', 'redundancy_strategy', 'design_basis_reference', 'system_config', 'compact_unit_id',
    'calculation_version', 'calculation_inputs', 'loop1_name', 'loop1_flow_source', 'loop1_filtration',
    'loop1_flow_pct', 'loop1_bio_degas_pct', 'loop1_bio_degas_m3h', 'loop1_link_bio_degas',
    'loop2_name', 'loop2_flow_source', 'loop2_filtration', 'loop2_flow_pct', 'loop2_bio_degas_pct',
    'loop2_bio_degas_m3h', 'loop2_link_bio_degas', 'loop3_name', 'loop3_flow_source', 'loop3_filtration',
    'loop3_flow_pct', 'loop3_bio_degas_pct', 'loop3_bio_degas_m3h', 'loop3_link_bio_degas',
    'side_streams'],
  system_links: ['id', 'system_id', 'exhibit_id', 'link_type', 'flow_allocation_m3h', 'notes',
    'sort_order', 'allocation_source', 'allocation_updated_at'],
};

function jsonCopy(value: any) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function pickFields(row: any, fields: string[]) {
  return fields.reduce((result, field) => {
    result[field] = row?.[field] ?? null;
    return result;
  }, {} as Record<string, any>);
}

function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function withSnapshotIntegrity(snapshot: any) {
  const unsigned = { ...snapshot };
  delete unsigned.integrity;
  return {
    ...unsigned,
    integrity: {
      algorithm: 'sha256',
      digest: crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
    },
  };
}

function snapshotIntegrityStatus(snapshot: any, persistedChecksum?: string | null, requirePersisted = false) {
  if (!snapshot?.integrity?.digest) return 'legacy_unverified';
  if (requirePersisted && !persistedChecksum) return 'invalid';
  const unsigned = { ...snapshot };
  const expected = snapshot.integrity.digest;
  delete unsigned.integrity;
  const actual = crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
  return expected === actual && (!persistedChecksum || persistedChecksum === actual) ? 'verified' : 'invalid';
}

function liveReferencesFromContext(context: any) {
  return {
    project: context.project_id
      ? pickFields(context, VERSION_REFERENCE_FIELDS.project)
      : null,
    exhibits: (context.exhibits || []).map((row: any) => pickFields(row, VERSION_REFERENCE_FIELDS.exhibits)),
    tanks: (context.tanks || []).map((row: any) => pickFields(row, VERSION_REFERENCE_FIELDS.tanks)),
    systems: (context.systems || []).map((row: any) => pickFields(row, VERSION_REFERENCE_FIELDS.systems)),
    system_links: (context.system_links || []).map((row: any) => pickFields(row, VERSION_REFERENCE_FIELDS.system_links)),
  };
}

function frozenFromSnapshot(snapshot: any) {
  if (snapshot?.frozen) return snapshot.frozen;
  // Keep snapshots made before schema 2 restorable while they are replaced by
  // verified snapshots on the next save.
  return {
    design_book: pickFields(snapshot, ['book_code', 'book_title', 'project_id', 'description', 'revision', 'status', 'notes']),
    species: snapshot?.species || [],
    hydraulics: snapshot?.hydraulics || [],
    substrate: snapshot?.substrate || [],
    ...(Array.isArray(snapshot?.review_handovers) ? { review_handovers: snapshot.review_handovers } : {}),
  };
}

function referencesFromSnapshot(snapshot: any) {
  if (snapshot?.live_references) return snapshot.live_references;
  return {
    project: snapshot?.project_id
      ? pickFields(snapshot, VERSION_REFERENCE_FIELDS.project)
      : null,
    exhibits: (snapshot?.exhibits || []).map((row: any) => pickFields(row, VERSION_REFERENCE_FIELDS.exhibits)),
    tanks: (snapshot?.tanks || []).map((row: any) => pickFields(row, VERSION_REFERENCE_FIELDS.tanks)),
    systems: (snapshot?.systems || []).map((row: any) => pickFields(row, VERSION_REFERENCE_FIELDS.systems)),
    system_links: (snapshot?.system_links || []).map((row: any) => pickFields(row, VERSION_REFERENCE_FIELDS.system_links)),
  };
}

function compareReferenceCollection(captured: any[] = [], current: any[] = []) {
  const capturedById = new Map(captured.filter(row => row?.id).map(row => [row.id, jsonCopy(row)]));
  const currentById = new Map(current.filter(row => row?.id).map(row => [row.id, jsonCopy(row)]));
  const added = current.filter(row => row?.id && !capturedById.has(row.id)).map(row => row.id);
  const removed = captured.filter(row => row?.id && !currentById.has(row.id)).map(row => row.id);
  const changed = captured
    .filter(row => row?.id && currentById.has(row.id))
    .filter(row => canonicalJson(capturedById.get(row.id)) !== canonicalJson(currentById.get(row.id)))
    .map(row => row.id);
  return { added, removed, changed, has_drift: added.length > 0 || removed.length > 0 || changed.length > 0 };
}

function calculateVersionDrift(snapshot: any, currentContext: any) {
  const captured = referencesFromSnapshot(snapshot);
  const current = liveReferencesFromContext(currentContext);
  const collections: Record<string, any> = {};
  for (const key of ['exhibits', 'tanks', 'systems', 'system_links']) {
    collections[key] = compareReferenceCollection(captured[key], current[key]);
  }
  const projectChanged = canonicalJson(captured.project) !== canonicalJson(current.project);
  const unresolved: Array<{ type: string; id: string }> = [];
  for (const key of ['exhibits', 'tanks', 'systems']) {
    for (const id of collections[key].removed) unresolved.push({ type: key.slice(0, -1), id });
  }
  for (const id of collections.system_links.removed) unresolved.push({ type: 'system_link', id });
  if (captured.project?.id && !current.project) unresolved.unshift({ type: 'project', id: captured.project.id });
  return {
    has_drift: projectChanged || Object.values(collections).some((value: any) => value.has_drift),
    project_changed: projectChanged,
    collections,
    unresolved_references: unresolved,
  };
}

function makeVersionSnapshot(context: any, capturedAt = new Date().toISOString()) {
  const snapshot = {
    schema_version: VERSION_SNAPSHOT_SCHEMA,
    captured_at: capturedAt,
    source: {
      design_book_id: context.id,
      project_id: context.project_id || null,
      book_code: context.book_code,
      revision: context.revision,
      project_code: context.project_code || null,
      project_name: context.project_name || null,
    },
    frozen: {
      design_book: pickFields(context, ['book_code', 'book_title', 'project_id', 'description', 'revision', 'status', 'notes']),
      species: jsonCopy(context.species || []),
      hydraulics: jsonCopy(context.hydraulics || []),
      substrate: jsonCopy(context.substrate || []),
      review_handovers: jsonCopy(context.review_handovers || []),
    },
    live_references: liveReferencesFromContext(context),
    scope: {
      frozen: ['book metadata', 'species allocations', 'hydraulics', 'substrate and theming', 'review handovers'],
      live: ['project', 'exhibits', 'tanks', 'LSS systems', 'system-exhibit links'],
      restore_target: 'working_copy',
    },
  };
  return withSnapshotIntegrity(snapshot);
}

function currentRestoreStateDigest(context: any) {
  return crypto.createHash('sha256').update(canonicalJson({
    frozen: {
      design_book: pickFields(context, ['book_code', 'book_title', 'project_id', 'description', 'revision', 'status', 'notes']),
      species: jsonCopy(context.species || []),
      hydraulics: jsonCopy(context.hydraulics || []),
      substrate: jsonCopy(context.substrate || []),
      review_handovers: jsonCopy(context.review_handovers || []),
    },
    live_references: liveReferencesFromContext(context),
  })).digest('hex');
}

function versionPresentation(version: any, currentContext: any) {
  const snapshot = version.snapshot || {};
  const frozen = frozenFromSnapshot(snapshot);
  const drift = calculateVersionDrift(snapshot, currentContext);
  const summary = {
    schema_version: snapshot.schema_version || 1,
    integrity: snapshotIntegrityStatus(
      snapshot,
      version.snapshot_checksum,
      Number(version.snapshot_schema_version || snapshot.schema_version || 1) >= VERSION_SNAPSHOT_SCHEMA,
    ),
    captured_at: snapshot.captured_at || snapshot.snapshotted_at || version.created_at,
    frozen_records: {
      species: (frozen.species || []).length,
      hydraulics: (frozen.hydraulics || []).length,
      substrate_theming: (frozen.substrate || []).length,
      review_handovers: Array.isArray(frozen.review_handovers) ? frozen.review_handovers.length : null,
    },
    live_references: {
      exhibits: (referencesFromSnapshot(snapshot).exhibits || []).length,
      tanks: (referencesFromSnapshot(snapshot).tanks || []).length,
      systems: (referencesFromSnapshot(snapshot).systems || []).length,
      system_links: (referencesFromSnapshot(snapshot).system_links || []).length,
    },
    restorable_records: [
      'book metadata', 'species', 'hydraulics', 'substrate and theming',
      ...(Array.isArray(frozen.review_handovers) ? ['review handovers'] : []),
    ],
    preserved_records: Array.isArray(frozen.review_handovers) ? [] : ['review handovers (not captured by this older version)'],
    live_reference_records: ['project', 'exhibits', 'tanks', 'LSS systems', 'system-exhibit links'],
  };
  return {
    ...version,
    snapshot,
    _snap: snapshot,
    summary,
    drift,
    restore_preview: {
      before: {
        book_title: currentContext.book_title,
        revision: currentContext.revision,
        status: currentContext.status,
        species: (currentContext.species || []).length,
        hydraulics: (currentContext.hydraulics || []).length,
        substrate_theming: (currentContext.substrate || []).length,
        review_handovers: (currentContext.review_handovers || []).length,
      },
      after: {
        book_title: frozen.design_book?.book_title,
        revision: frozen.design_book?.revision,
        status: frozen.design_book?.status,
        species: (frozen.species || []).length,
        hydraulics: (frozen.hydraulics || []).length,
        substrate_theming: (frozen.substrate || []).length,
        review_handovers: Array.isArray(frozen.review_handovers)
          ? frozen.review_handovers.length
          : (currentContext.review_handovers || []).length,
        review_handovers_preserved: !Array.isArray(frozen.review_handovers),
      },
      token: currentRestoreStateDigest(currentContext),
      generated_at: new Date().toISOString(),
    },
  };
}

async function insertVersion(
  runner: DbRunner,
  bookId: string,
  versionLabel: string | null,
  notes: string | null,
  snapshot: any,
  createdBy: string,
  isRecoveryCheckpoint = false,
) {
  await runner('SELECT pg_advisory_xact_lock(hashtext($1))', [bookId]);
  const numberResult = await runner(
    `SELECT COALESCE(MAX(version_number), 0) + 1 AS next
     FROM design_book_versions WHERE design_book_id = $1`,
    [bookId],
  );
  const inserted = await runner(
    `INSERT INTO design_book_versions
       (design_book_id, version_number, version_label, notes, snapshot, created_by,
        snapshot_schema_version, snapshot_checksum, is_recovery_checkpoint)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
     RETURNING id, version_number, version_label, notes, created_at, is_recovery_checkpoint`,
    [
      bookId,
      Number(numberResult.rows[0].next),
      versionLabel,
      notes,
      JSON.stringify(snapshot),
      createdBy,
      snapshot.schema_version || 1,
      snapshot.integrity?.digest || null,
      isRecoveryCheckpoint,
    ],
  );
  return inserted.rows[0];
}

export const versionSnapshotTestUtils = {
  makeVersionSnapshot,
  snapshotIntegrityStatus,
  frozenFromSnapshot,
  calculateVersionDrift,
  currentRestoreStateDigest,
  insertVersion,
  loadReleaseContext,
};

router.get('/design-books/:id/versions', authenticate, async (req: AuthRequest, res: Response) => {
  const currentContext = await loadReleaseContext(routeParam(req.params.id), query, false, true);
  if (!currentContext) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  const result = await query(
    `SELECT v.id, v.version_number, v.version_label, v.notes, v.snapshot, v.created_at,
            v.is_recovery_checkpoint, v.snapshot_schema_version, v.snapshot_checksum,
            u.first_name || ' ' || u.last_name AS created_by_name
     FROM design_book_versions v
     LEFT JOIN users u ON v.created_by = u.id
     WHERE v.design_book_id = $1
     ORDER BY v.version_number DESC`,
    [req.params.id],
  );
  res.json({ items: result.rows.map(version => versionPresentation(version, currentContext)) });
});

router.get('/design-books/:id/versions/:versionId/preview', authenticate, async (req: AuthRequest, res: Response) => {
  const currentContext = await loadReleaseContext(routeParam(req.params.id), query, false, true);
  if (!currentContext) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  const result = await query(
    `SELECT v.*, u.first_name || ' ' || u.last_name AS created_by_name
     FROM design_book_versions v
     LEFT JOIN users u ON v.created_by = u.id
     WHERE v.id=$1 AND v.design_book_id=$2`,
    [req.params.versionId, req.params.id],
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found' } });
  res.json(versionPresentation(result.rows[0], currentContext));
});

router.post('/design-books/:id/versions', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const context = await loadReleaseContext(routeParam(req.params.id), client.query.bind(client) as DbRunner, true, true);
    if (!context) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    }
    if (!isDesignBookContentEditable(context.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Only Draft or In Progress Design Books can be versioned.' },
      });
    }
    const snapshot = makeVersionSnapshot(context);
    const version = await insertVersion(
      client.query.bind(client) as DbRunner,
      routeParam(req.params.id),
      String(req.body.version_label || '').trim() || null,
      String(req.body.notes || '').trim() || null,
      snapshot,
      req.user!.id,
    );
    await insertAudit(client.query.bind(client) as DbRunner, req.user!.id, 'design_book', routeParam(req.params.id), 'VERSION_CREATED', {
      summary: `Design Book version ${version.version_number} created`,
      version_id: version.id,
      version_number: version.version_number,
      schema_version: snapshot.schema_version,
      snapshot_checksum: snapshot.integrity.digest,
    }, req.ip);
    await client.query('COMMIT');
    res.status(201).json({ ...version, summary: versionPresentation({ ...version, snapshot }, context).summary });
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error?.code === '23505') {
      return res.status(409).json({ error: { code: 'VERSION_CONFLICT', message: 'Another version was saved at the same time. Please retry.' } });
    }
    throw error;
  } finally {
    client.release();
  }
});

router.post('/design-books/:id/versions/:versionId/restore', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const versionResult = await client.query(
      'SELECT * FROM design_book_versions WHERE id=$1 AND design_book_id=$2',
      [req.params.versionId, req.params.id],
    );
    if (!versionResult.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found' } });
    }
    const version = versionResult.rows[0];
    const context = await loadReleaseContext(routeParam(req.params.id), client.query.bind(client) as DbRunner, true, true);
    if (!context) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    }
    if (!isDesignBookContentEditable(context.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Only Draft or In Progress Design Books can be restored.' },
      });
    }
    const currentStateToken = currentRestoreStateDigest(context);
    if (!req.body.preview_token || req.body.preview_token !== currentStateToken) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: {
          code: 'RESTORE_PREVIEW_STALE',
          message: 'The working copy changed after the restore preview. Review the refreshed before-and-after comparison.',
        },
      });
    }
    const integrity = snapshotIntegrityStatus(
      version.snapshot,
      version.snapshot_checksum,
      Number(version.snapshot_schema_version || version.snapshot?.schema_version || 1) >= VERSION_SNAPSHOT_SCHEMA,
    );
    if (integrity === 'invalid') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: { code: 'INVALID_SNAPSHOT', message: 'This version failed its integrity check and cannot be restored.' } });
    }
    const drift = calculateVersionDrift(version.snapshot, context);
    if (drift.unresolved_references.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: {
          code: 'UNRESOLVED_REFERENCES',
          message: 'This version refers to project records that no longer exist. Nothing was changed.',
          references: drift.unresolved_references,
        },
        drift,
      });
    }

    const currentSnapshot = makeVersionSnapshot(context);
    const recoverySnapshot = withSnapshotIntegrity({
      ...currentSnapshot,
      recovery: {
        source_version_id: version.id,
        source_version_number: version.version_number,
        created_at: new Date().toISOString(),
      },
    });
    const checkpoint = await insertVersion(
      client.query.bind(client) as DbRunner,
      routeParam(req.params.id),
      `Recovery before restoring v${version.version_number}`,
      `Automatic recovery checkpoint created before restoring version ${version.version_number}.`,
      recoverySnapshot,
      req.user!.id,
      true,
    );
    const frozen = frozenFromSnapshot(version.snapshot);
    const book = frozen.design_book || {};
    const restoredStatus = isDesignBookContentEditable(book.status) ? book.status : context.status;
    await client.query(
      `UPDATE design_books
       SET book_title=$1, revision=$2, status=$3, description=$4, notes=$5, updated_at=NOW()
       WHERE id=$6`,
      [book.book_title, book.revision, restoredStatus, book.description, book.notes, req.params.id],
    );
    await client.query('DELETE FROM design_book_exhibit_species WHERE design_book_id=$1', [req.params.id]);
    for (const sp of frozen.species || []) {
      await client.query(
        `INSERT INTO design_book_exhibit_species
           (design_book_id, exhibit_id, catalog_species_id, species_name, common_name, quantity,
            avg_size_cm, reference_average_mass_kg, biomass_kg, avg_size_override_cm,
            reference_mass_override_kg, biomass_override_kg, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [req.params.id, sp.exhibit_id, sp.catalog_species_id ?? null, sp.species_name, sp.common_name,
          sp.quantity ?? null, sp.avg_size_cm ?? null, sp.reference_average_mass_kg ?? null,
          sp.biomass_kg ?? null, sp.avg_size_override_cm ?? null, sp.reference_mass_override_kg ?? null,
          sp.biomass_override_kg ?? null, sp.notes ?? null, sp.sort_order ?? 0],
      );
    }
    await client.query('DELETE FROM design_book_exhibit_hydraulics WHERE design_book_id=$1', [req.params.id]);
    for (const h of frozen.hydraulics || []) {
      await client.query(
        `INSERT INTO design_book_exhibit_hydraulics
           (design_book_id, exhibit_id, target_turnover_rate, surface_skim_pct, bottom_drain_pct, notes,
            weir_head_mm, weir_length_mm, weir_formula_method, weir_geometry, weir_end_contractions,
            weir_discharge_condition, weir_downstream_head_mm, calculation_version, last_calculated_at,
            calculation_inputs, override_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)`,
        [req.params.id, h.exhibit_id, h.target_turnover_rate ?? null, h.surface_skim_pct ?? 30,
          h.bottom_drain_pct ?? 70, h.notes ?? null, h.weir_head_mm ?? null, h.weir_length_mm ?? null,
          h.weir_formula_method ?? null, h.weir_geometry ?? null, h.weir_end_contractions ?? null,
          h.weir_discharge_condition ?? null, h.weir_downstream_head_mm ?? null, h.calculation_version ?? null,
          h.last_calculated_at ?? null, h.calculation_inputs ? JSON.stringify(h.calculation_inputs) : null,
          h.override_reason ?? null],
      );
    }
    await client.query('DELETE FROM design_book_exhibit_substrate WHERE design_book_id=$1', [req.params.id]);
    for (const s of frozen.substrate || []) {
      await client.query(
        `INSERT INTO design_book_exhibit_substrate
           (design_book_id, exhibit_id, substrate_type, substrate_height_mm, substrate_volume_m3,
            theming_type, theming_height_mm, theming_volume_m3, theming_volume_pct, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [req.params.id, s.exhibit_id, s.substrate_type ?? null, s.substrate_height_mm ?? null,
          s.substrate_volume_m3 ?? null, s.theming_type ?? null, s.theming_height_mm ?? null,
          s.theming_volume_m3 ?? null, s.theming_volume_pct ?? null, s.notes ?? null],
      );
    }
    if (Array.isArray(frozen.review_handovers)) {
      await client.query('DELETE FROM design_book_review_handovers WHERE design_book_id=$1', [req.params.id]);
      for (const handover of frozen.review_handovers) {
        await client.query(
          `INSERT INTO design_book_review_handovers
             (design_book_id, meeting_date, title, attendees, purpose, discussion_summary,
              decisions, action_items, open_items, acceptance_notes, created_by, created_at)
           VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8,$9,$10,$11,COALESCE($12,NOW()))`,
          [req.params.id, handover.meeting_date, handover.title, handover.attendees || [],
            handover.purpose ?? null, handover.discussion_summary ?? null, handover.decisions ?? null,
            handover.action_items ?? null, handover.open_items ?? null, handover.acceptance_notes ?? null,
            handover.created_by ?? null, handover.created_at ?? null],
        );
      }
    }
    await client.query(
      `INSERT INTO design_book_version_restores
         (design_book_id, source_version_id, recovery_checkpoint_id, actor_id, drift, restored_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,NOW())`,
      [req.params.id, version.id, checkpoint.id, req.user!.id, JSON.stringify(drift)],
    );
    await insertAudit(client.query.bind(client) as DbRunner, req.user!.id, 'design_book', routeParam(req.params.id), 'VERSION_RESTORED', {
      summary: `Design Book restored from version ${version.version_number}`,
      source_version_id: version.id,
      source_version_number: version.version_number,
      recovery_checkpoint_id: checkpoint.id,
      drift,
    }, req.ip);
    await client.query('COMMIT');
    res.json({
      restored: true,
      version_number: version.version_number,
      recovery_checkpoint_id: checkpoint.id,
      drift,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

export default router;
