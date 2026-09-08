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
import {
  buildThermalSourceContext,
  calculateThermalCalculation,
  isApprovedThermalCorrelationSnapshot,
  THERMAL_CALCULATION_VERSION,
  THERMAL_CONSTANTS,
} from '../lib/thermalCalculations';
import { calculateSpeciesAllocation } from '../lib/speciesAllocations';
import { PUMP_SELECTION_CALCULATION_VERSION, pumpCircuits, pumpLinesForCircuit } from '../lib/pumpSelections';
import {
  calculateFrictionLoss,
  FRICTION_LOSS_CALCULATION_VERSION,
  frictionSourceFingerprint,
  frictionSourceSnapshot,
} from '../lib/frictionLossCalculations';
import { isLifeSupportSystem } from '../lib/lssSystems';
import { resolveLoopFlows } from '../lib/flowRoute';
import { isRetiredSystem, systemLifecycleError } from '../lib/systemLifecycle';
import {
  calculateUVSelection,
  UV_CALCULATION_VERSION,
  UVStreamInput,
} from '../lib/uvCalculations';
import { pipeVelocity } from '../lib/pipeSizing';

const router = Router();
router.use(authenticate, (req: AuthRequest, res: Response, next) => {
  // Platform Admin governs correlation evidence even when Design Books are
  // hidden for that administrator. All other Design Book routes retain the
  // module visibility gate.
  if (req.user?.role === 'admin' && req.path.startsWith('/thermal-correlations')) {
    return next();
  }
  return requireModuleAccess('design_books')(req, res, next);
});

type DbRunner = (text: string, params?: any[]) => Promise<{ rows: any[] }>;

const routeParam = (value: string | string[]) => Array.isArray(value) ? value[0] : value;

export function isCurrentPumpSelectionReady(selection: any) {
  return !!selection &&
    !!selection.project_equipment_item_id &&
    !!selection.selected_pump &&
    selection.freshness === 'fresh' &&
    selection.status === 'ready' &&
    selection.calculation_version === PUMP_SELECTION_CALCULATION_VERSION;
}

function pumpSelectionPrerequisiteReasons(selection: any) {
  if (!selection) {
    return ['No pump selection is saved for this Flow Route circuit. Open Pump Selection and calculate the circuit pump first.'];
  }
  if (isCurrentPumpSelectionReady(selection)) return [];
  return [
    ...(selection.reasons || []),
    'Complete and recalculate Pump Selection for this Flow Route circuit before calculating friction loss.',
  ].filter((reason, index, reasons) => reasons.indexOf(reason) === index);
}

async function attachSystemSideStreams(runner: DbRunner, systems: any[]) {
  if (!systems.length) return systems;
  const rows = (await runner(
    `SELECT s.*,
            r.id AS uv_rev_id, r.revision_number AS uv_revision_number, r.status AS uv_rev_status,
            pm.lamp_count AS uv_lamp_count, pm.power_kw * 1000 AS uv_lamp_power_w,
            r.effective_reactor_volume_l AS uv_effective_reactor_volume_l,
            r.irradiance_85t_mw_cm2 AS uv_irradiance_85t_mw_cm2,
            r.irradiance_95t_mw_cm2 AS uv_irradiance_95t_mw_cm2,
            r.compatibility AS uv_compatibility, r.arrangement AS uv_arrangement,
            r.source_basis AS uv_source_basis, r.source_evidence AS uv_source_evidence,
            r.approved_per_lamp_flow_exception_m3h AS uv_approved_per_lamp_flow_exception_m3h,
            r.notes AS uv_rev_notes,
            pm.product_code AS uv_product_code, pm.product_name AS uv_product_name,
            pm.manufacturer AS uv_manufacturer, pm.id AS uv_product_master_id,
            pm.primary_material_code AS uv_material_code, pm.power_kw AS uv_rated_power_kw
       FROM system_flow_side_streams s
       LEFT JOIN uv_engineering_revisions r ON r.id=s.uv_revision_id
       LEFT JOIN uv_engineering_catalogs uc ON uc.id=r.catalog_id
       LEFT JOIN product_masters pm ON pm.id=uc.product_master_id
      WHERE s.system_id = ANY($1::uuid[])
      ORDER BY s.parent_loop_number, s.sort_order, s.created_at, s.id`,
    [systems.map(system => system.id)],
  )).rows;
  const fractionators = (await runner(
    `SELECT * FROM system_flow_fractionator_allocations
     WHERE system_id = ANY($1::uuid[]) ORDER BY parent_loop_number`,
    [systems.map(system => system.id)],
  )).rows;
  const sandFilters = (await runner(
    `SELECT * FROM system_flow_sand_filter_allocations
     WHERE system_id = ANY($1::uuid[]) ORDER BY parent_loop_number`,
    [systems.map(system => system.id)],
  )).rows;
  return systems.map(system => ({
    ...system,
    side_streams: rows
      .filter(stream => stream.system_id === system.id)
      .map(row => ({
        ...row,
        uv_revision: row.uv_rev_id ? {
          id: row.uv_rev_id,
          revision_number: row.uv_revision_number,
          status: row.uv_rev_status,
          lamp_count: row.uv_lamp_count,
          lamp_power_w: row.uv_lamp_power_w,
          effective_reactor_volume_l: row.uv_effective_reactor_volume_l,
          irradiance_85t_mw_cm2: row.uv_irradiance_85t_mw_cm2,
          irradiance_95t_mw_cm2: row.uv_irradiance_95t_mw_cm2,
          compatibility: row.uv_compatibility,
          arrangement: row.uv_arrangement,
          source_basis: row.uv_source_basis,
          source_evidence: row.uv_source_evidence,
          approved_per_lamp_flow_exception_m3h: row.uv_approved_per_lamp_flow_exception_m3h,
          notes: row.uv_rev_notes,
          product_code: row.uv_product_code,
          product_name: row.uv_product_name,
          manufacturer: row.uv_manufacturer,
          product_master_id: row.uv_product_master_id,
          material_code: row.uv_material_code,
          rated_power_kw: row.uv_rated_power_kw,
        } : null,
      })),
    fractionator_allocations: fractionators.filter(allocation => allocation.system_id === system.id),
    sand_filter_allocations: sandFilters.filter(allocation => allocation.system_id === system.id),
  }));
}

export async function loadPumpSelections(runner: DbRunner, systems: any[]) {
  if (!systems.length) return [];
  const saved = (await runner(
    'SELECT * FROM system_pump_selections WHERE system_id = ANY($1::uuid[])',
    [systems.map(system => system.id)],
  )).rows;
  return systems.map(system => {
    const rows = saved.filter(row => row.system_id === system.id);
    const circuitMap = new Map(pumpCircuits(system, system.side_streams || []).map(item => [item.circuit_key, item]));
    // Retain orphaned saved rows so stale evidence remains auditable.
    rows.forEach(row => {
      if (!circuitMap.has(row.circuit_key)) circuitMap.set(row.circuit_key, {
        circuit_key: row.circuit_key, circuit_kind: 'orphaned', circuit_name: row.circuit_key,
        circuit_type: null, parent_loop_number: null, side_stream_id: null, flow_m3h: null,
      });
    });
    return {
      system_id: system.id,
      // Flat list: each entry is one (circuit, pump_role) pair.  Non-FF circuits
      // produce one item; Foam Fractionator circuits produce one per saved role.
      items: [...circuitMap.values()].flatMap(circuit =>
        pumpLinesForCircuit(circuit, rows),
      ),
    };
  });
}

export async function loadLssControlSummaries(runner: DbRunner, designBookId: string, systems: any[]) {
  const lssSystems = systems.filter(isLifeSupportSystem);
  if (!lssSystems.length) return [];
  const ids = lssSystems.map(system => system.id);
  const controls = (await runner(
    'SELECT * FROM design_book_lss_controls WHERE design_book_id=$1 AND system_id=ANY($2::uuid[])',
    [designBookId, ids],
  )).rows;
  return lssSystems.map(system => ({
    system_id: system.id,
    control: controls.find(control => control.system_id === system.id) || null,
  }));
}

export async function loadLssControls(runner: DbRunner, designBookId: string, systems: any[]) {
  const summaries = await loadLssControlSummaries(runner, designBookId, systems);
  if (!summaries.length) return [];
  const ids = summaries.map(item => item.system_id);
  const instruments = (await runner(
    `SELECT i.*, pm.product_code, pm.product_name, pm.status AS product_status
     FROM design_book_lss_instruments i LEFT JOIN product_masters pm ON pm.id=i.product_master_id
     WHERE i.design_book_id=$1 AND i.system_id=ANY($2::uuid[])
     ORDER BY i.system_id, i.definition_snapshot->>'tag_code', i.sequence_number`,
    [designBookId, ids],
  )).rows;
  const definitions = (await runner(
    `SELECT * FROM field_instrument_definitions WHERE is_active=true ORDER BY sort_order, tag_code`,
  )).rows;
  return summaries.map(item => ({
    ...item,
    instruments: instruments.filter(instrument => instrument.system_id === item.system_id),
    definitions,
  }));
}

export async function loadFrictionLossPackages(
  runner: DbRunner,
  designBookId: string,
  systems: any[],
) {
  const lifeSupportSystems = systems.filter(isLifeSupportSystem);
  if (!lifeSupportSystems.length) return [];
  const pumpSelectionPackages = await loadPumpSelections(runner, lifeSupportSystems);
  const eligibleCircuitPumps = (await runner(
    `SELECT sps.system_id, sps.circuit_key,
            pei.id, pei.id AS project_equipment_item_id, pei.equip_code, pei.description,
            pm.id AS product_master_id, pm.product_code, pm.product_name,
            pm.manufacturer, pm.model
     FROM system_pump_selections sps
     JOIN project_equipment_items pei
       ON pei.id=sps.project_equipment_item_id AND pei.system_id=sps.system_id
     JOIN systems current_system
       ON current_system.id=sps.system_id AND current_system.project_id=pei.project_id
     JOIN product_masters pm ON pm.id=pei.product_master_id
     LEFT JOIN product_families pf ON pf.id=pm.product_family_id
     WHERE sps.system_id = ANY($1::uuid[])
       AND (sps.pump_role='primary' OR sps.pump_role IS NULL)
       AND (pm.status IS NULL OR pm.status='Active')
       AND (
         UPPER(COALESCE(pm.product_category,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pf.category_code,'')) IN ('PUMP','PUMPS','PUMPING')
         OR UPPER(COALESCE(pf.product_family_code,'')) IN ('PUMP','PUMPS','PUMPING')
         OR ((pm.product_category IS NULL OR BTRIM(pm.product_category)='')
             AND (pf.category_code IS NULL OR BTRIM(pf.category_code)='')
             AND (UPPER(COALESCE(pm.application_type,'')) LIKE '%PUMP%'
                  OR UPPER(pm.product_name) LIKE '%PUMP%'))
       )`,
    [lifeSupportSystems.map(system => system.id)],
  )).rows;
  const savedRows = (await runner(
    `SELECT c.*, sps.project_equipment_item_id AS current_circuit_pump_id,
            pei.equip_code AS current_equip_code, pei.description AS current_pump_description,
            pm.id AS current_pump_product_master_id,
            pm.product_code AS current_pump_product_code, pm.product_name AS current_pump_product_name,
            pm.manufacturer AS current_pump_manufacturer, pm.model AS current_pump_model
     FROM design_book_friction_loss_calculations c
     LEFT JOIN system_pump_selections sps
       ON sps.system_id=c.system_id AND sps.circuit_key=c.circuit_key
      AND (sps.pump_role='primary' OR sps.pump_role IS NULL)
     LEFT JOIN project_equipment_items pei ON pei.id=c.project_equipment_item_id
     LEFT JOIN product_masters pm ON pm.id=pei.product_master_id
     WHERE c.design_book_id=$1 AND c.system_id = ANY($2::uuid[])`,
    [designBookId, lifeSupportSystems.map(system => system.id)],
  )).rows;
  const components = savedRows.length
    ? (await runner(
      `SELECT fc.*, ppi.piping_code AS current_piping_code, ppi.description AS current_description,
              ppi.quantity AS current_project_quantity, ppi.unit AS current_unit,
              ppi.system_id AS current_system_id, pm.product_code AS current_product_code,
              pm.id AS current_product_master_id, pm.product_name AS current_product_name,
              pm.application_type AS current_application_type
       FROM design_book_friction_loss_components fc
       LEFT JOIN project_piping_items ppi ON ppi.id=fc.project_piping_item_id
       LEFT JOIN product_masters pm ON pm.id=ppi.product_master_id
       WHERE fc.calculation_id = ANY($1::uuid[])
       ORDER BY fc.calculation_id, fc.side, fc.sort_order, fc.id`,
      [savedRows.map(row => row.id)],
    )).rows
    : [];
  return lifeSupportSystems.map(system => {
    const rows = savedRows.filter(row => row.system_id === system.id);
    const pumpSelections = pumpSelectionPackages
      .find(entry => entry.system_id === system.id)?.items || [];
    const circuitMap = new Map(pumpCircuits(system, system.side_streams || [])
      .map(circuit => [circuit.circuit_key, circuit]));
    rows.forEach(row => {
      if (!circuitMap.has(row.circuit_key)) {
        circuitMap.set(row.circuit_key, {
          circuit_key: row.circuit_key,
          circuit_kind: 'orphaned',
          circuit_name: row.source_snapshot?.circuit?.circuit_name || row.circuit_key,
          circuit_type: row.source_snapshot?.circuit?.circuit_type || null,
          parent_loop_number: null,
          side_stream_id: null,
          flow_m3h: null,
        });
      }
    });
    return {
      system_id: system.id,
      system,
      items: [...circuitMap.values()].map(circuit => {
        const row = rows.find(value => value.circuit_key === circuit.circuit_key);
        // Friction loss uses the primary supply pump for each circuit.
        const pumpSelection = pumpSelections.find(
          selection => selection.circuit_key === circuit.circuit_key &&
            (selection.pump_role === 'primary' || !selection.pump_role),
        ) || null;
        const eligiblePump = eligibleCircuitPumps.find(candidate =>
          candidate.system_id === system.id &&
          candidate.circuit_key === circuit.circuit_key &&
          candidate.project_equipment_item_id === pumpSelection?.project_equipment_item_id) || null;
        const currentPump = eligiblePump || pumpSelection?.selected_pump || null;
        const currentPumpId = pumpSelection?.project_equipment_item_id || null;
        const pumpReady = isCurrentPumpSelectionReady(pumpSelection) && !!eligiblePump;
        const pumpReasons = !pumpSelection
          ? pumpSelectionPrerequisiteReasons(pumpSelection)
          : !eligiblePump
            ? ['The selected circuit pump is no longer an active eligible pump assigned to this LSS system. Open Pump Selection and select a current pump.']
            : pumpSelectionPrerequisiteReasons(pumpSelection);
        const pumpStatus = pumpReady
          ? pumpSelection.status
          : pumpSelection?.status === 'incompatible' ? 'incompatible' : 'stale';
        const pumpFreshness = pumpReady ? pumpSelection.freshness : 'stale';
        if (!row) {
          const tankBoundaries = {
            start: { tank_id: '', base_elevation_fl0_m: 0, water_depth_m: '', pump_draw_height_m: '', open_to_atmosphere: true, gauge_pressure_kpa: 0 },
            end: { tank_id: '', base_elevation_fl0_m: '', water_depth_m: '', open_to_atmosphere: true, gauge_pressure_kpa: 0 },
          };
          const preview = calculateFrictionLoss({
            flow_m3h: circuit.flow_m3h,
            selected_pump: currentPump,
            components: [],
            tank_boundaries: tankBoundaries,
          });
          const reasons = [...new Set([
            ...pumpReasons,
            ...preview.reasons.filter(reason => reason !== 'Select a pump assigned to this LSS system.'),
          ])];
          return {
            ...circuit,
            status: 'incomplete',
            freshness: 'unsaved',
            reasons,
            calculation_version: FRICTION_LOSS_CALCULATION_VERSION,
            result: { ...preview, reasons },
            components: [],
            project_equipment_item_id: currentPumpId,
            selected_pump: currentPump,
            pump_selection: pumpSelection,
            pump_selection_ready: pumpReady,
            pump_selection_status: pumpSelection ? pumpStatus : 'incomplete',
            pump_selection_freshness: pumpSelection ? pumpFreshness : 'unsaved',
            pump_selection_reasons: pumpReasons,
            tank_boundaries: tankBoundaries,
          };
        }
        const currentComponents = components.filter(component => component.calculation_id === row.id)
          .map(component => {
            const currentSnapshot = component.current_piping_code && component.current_system_id === system.id
              ? {
                  project_piping_item_id: component.project_piping_item_id,
                  id: component.project_piping_item_id,
                  piping_code: component.current_piping_code,
                  description: component.current_description,
                  project_quantity: component.current_project_quantity,
                  unit: component.current_unit,
                  system_id: component.current_system_id,
                  product_master_id: component.current_product_master_id,
                  product_code: component.current_product_code,
                  product_name: component.current_product_name,
                  application_type: component.current_application_type,
                }
              : null;
            return {
              project_piping_item_id: component.project_piping_item_id,
              piping_snapshot: currentSnapshot || component.piping_snapshot,
              side: component.side,
              component_kind: component.component_kind,
              sort_order: component.sort_order,
              internal_diameter_mm: component.internal_diameter_mm,
              straight_length_m: component.straight_length_m,
              material: component.material,
              absolute_roughness_mm: component.absolute_roughness_mm,
              fitting_k_value: component.fitting_k_value,
              quantity: component.quantity,
              reference_valid: !!currentSnapshot,
            };
          });
        const currentSource = frictionSourceSnapshot(
          circuit,
          currentPump,
          currentComponents.map(({ reference_valid, ...item }) => item),
          row.input_snapshot?.tank_boundaries,
        );
        const currentFingerprint = frictionSourceFingerprint(currentSource);
        const stale = circuit.circuit_kind === 'orphaned' ||
          row.calculation_version !== FRICTION_LOSS_CALCULATION_VERSION ||
          row.source_fingerprint !== currentFingerprint ||
          !pumpReady ||
          row.current_circuit_pump_id !== row.project_equipment_item_id ||
          currentPumpId !== row.project_equipment_item_id ||
          currentComponents.some(component => !component.reference_valid);
        const staleReasons = [
          ...(circuit.circuit_kind === 'orphaned' ? ['This saved calculation references a Flow Route circuit that no longer exists.'] : []),
          ...(row.calculation_version !== FRICTION_LOSS_CALCULATION_VERSION ? [`Friction calculation version ${row.calculation_version} is outdated; recalculate using ${FRICTION_LOSS_CALCULATION_VERSION}.`] : []),
          ...pumpReasons,
          ...(row.current_circuit_pump_id !== row.project_equipment_item_id
            ? ['The pump selected for this Flow Route circuit changed after the friction calculation was saved.']
            : []),
          ...(currentPumpId !== row.project_equipment_item_id &&
            currentPumpId === row.current_circuit_pump_id
            ? ['The pump selected for this Flow Route circuit changed after the friction calculation was saved.']
            : []),
          ...(currentComponents.some(component => !component.reference_valid) ? ['One or more assigned pipe or fitting items are no longer available for this LSS system.'] : []),
          ...(row.source_fingerprint !== currentFingerprint && circuit.circuit_kind !== 'orphaned'
            ? ['Flow Route flow, selected pump, or assigned hydraulic inputs changed after this calculation was saved. Recalculate before review or release.']
            : []),
        ];
        return {
          ...circuit,
          calculation_id: row.id,
          project_equipment_item_id: currentPumpId,
          selected_pump: currentPump,
          pump_selection: pumpSelection,
          pump_selection_ready: pumpReady,
          pump_selection_status: pumpSelection ? pumpStatus : 'incomplete',
          pump_selection_freshness: pumpSelection ? pumpFreshness : 'unsaved',
          pump_selection_reasons: pumpReasons,
          tank_boundaries: row.input_snapshot?.tank_boundaries || row.result_snapshot?.inputs?.tank_boundaries,
          components: row.result_snapshot?.components || currentComponents,
          source_fingerprint: row.source_fingerprint,
          current_source_fingerprint: currentFingerprint,
          calculation_version: row.calculation_version,
          freshness: stale ? 'stale' : 'fresh',
          status: stale ? 'stale' : String(row.status || '').toLowerCase(),
          reasons: stale ? staleReasons : (row.result_snapshot?.reasons || []),
          result: {
            ...row.result_snapshot,
            status: stale ? 'stale' : row.result_snapshot?.status,
            reasons: stale ? staleReasons : (row.result_snapshot?.reasons || []),
          },
          calculated_at: row.calculated_at,
        };
      }),
    };
  });
}

async function loadThermalCalculations(
  runner: DbRunner,
  designBookId: string,
  systems: any[],
  links: any[],
  exhibits: any[],
  tanks: any[],
  exhibitCalculations: any[],
  wallConstructions: any[],
  lights: any[] = [],
  pumpSelections?: any[],
  uvSelections?: any[],
) {
  const savedRows = systems.length
    ? (await runner(
      'SELECT * FROM design_book_thermal_calculations WHERE design_book_id=$1 AND system_id = ANY($2::uuid[])',
      [designBookId, systems.map(system => system.id)],
    )).rows
    : [];
  return systems.map(system => {
    const source = buildThermalSourceContext({
      system,
      links: links.filter(link => link.system_id === system.id),
      exhibits,
      tanks,
      exhibitCalculations,
      lights,
      wallConstructions,
      ...(pumpSelections !== undefined || uvSelections !== undefined
        ? {
          pumpSelections: pumpSelections?.find(item => item.system_id === system.id)?.items || [],
          uvSelections: uvSelections?.filter(item => item.system_id === system.id) || [],
        }
        : {}),
    });
    const saved = savedRows.find(row => row.system_id === system.id) || null;
    const correlationSnapshot = saved?.correlation_snapshot ||
      saved?.result_snapshot?.correlation_snapshot ||
      saved?.input_snapshot?.agitation_correlation_snapshot ||
      null;
    const correlationEvidenceMissing = !!saved &&
      !isApprovedThermalCorrelationSnapshot(correlationSnapshot);
    const savedInputs = saved?.input_snapshot || {};
    const preview = calculateThermalCalculation(
      source,
      savedInputs,
    );
    // Re-resolve the wall without the saved default/layer values so a
    // superseded governed default is visible next to the frozen evidence.
    const currentApprovedPreview = saved
      ? calculateThermalCalculation(source, {
          ...savedInputs,
          tank_wall_default_basis: null,
          tank_wall_layers: [],
        })
      : null;
    const wallBasisChange = thermalWallBasisChange(
      saved?.result_snapshot?.wall_construction_basis ||
        saved?.formula_inputs?.wall_construction_basis ||
        savedInputs.wall_construction_basis ||
        saved?.source_snapshot?.wall_construction_basis ||
        null,
      currentApprovedPreview?.wall_construction_basis ||
        preview.wall_construction_basis ||
        null,
      saved?.source_snapshot?.wall_construction_defaults || [],
      source.wall_construction_defaults || [],
    );
    const nonWallSourceChanged = thermalNonWallSourceChanged(
      saved?.source_snapshot,
      source,
    );
    const calculationVersionChanged = !!saved &&
      saved.calculation_version !== THERMAL_CALCULATION_VERSION;
    const stale = !!saved && (
      !!wallBasisChange ||
      nonWallSourceChanged ||
      calculationVersionChanged
    );
    const staleReasons = [
      ...(wallBasisChange
        ? [`The approved Thermal wall basis changed after this calculation was saved (${wallBasisChange.changed_fields.join(', ')}). Review the saved and current wall evidence, then recalculate.`]
        : []),
      ...(!wallBasisChange || nonWallSourceChanged ||
        calculationVersionChanged
        ? ['Linked exhibits, tanks, geometry, or relationships changed since this calculation was saved. Recalculate before review or release.']
        : []),
    ];
    const calculation = saved
      ? {
          ...saved.result_snapshot,
          calculation_version: saved.calculation_version,
          calculated_at: saved.calculated_at,
          source_fingerprint: saved.source_fingerprint,
          status: stale || correlationEvidenceMissing ? 'Blocked' : saved.status,
          freshness: stale ? 'stale' : saved.freshness,
          is_stale: stale,
          reasons: correlationEvidenceMissing
            ? ['Select a current approved shared-library evaporation correlation and recalculate before review or release.']
            : stale
            ? staleReasons
            : (saved.result_snapshot?.reasons || []),
          correlation_snapshot: correlationSnapshot,
          wall_basis_change: wallBasisChange,
        }
      : null;
    return {
      system_id: system.id,
      system,
      source,
      saved,
      calculation,
      current_preview: preview,
      status: stale ? 'Stale' : correlationEvidenceMissing ? 'Blocked' : saved?.status || 'Not configured',
      freshness: stale ? 'stale' : saved?.freshness || 'unsaved',
      source_fingerprint: source.fingerprint,
      wall_basis_change: wallBasisChange,
    };
  });
}

function thermalWallBasisComparable(basis: any) {
  if (!basis) return null;
  const normalizeNumber = (value: any) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const normalizeText = (value: any) => {
    const text = String(value ?? '').trim();
    return text || null;
  };
  const layers = (Array.isArray(basis.effective_layers) && basis.effective_layers.length
    ? basis.effective_layers
    : Array.isArray(basis.layers) ? basis.layers : [])
    .map((layer: any) => ({
      material: normalizeText(layer?.material),
      thickness_mm: normalizeNumber(
        layer?.thickness_mm ?? (layer?.thickness_m == null ? null : Number(layer.thickness_m) * 1000),
      ),
      conductivity_w_m_k: normalizeNumber(layer?.conductivity_w_m_k),
    }));
  const tankBases = (Array.isArray(basis.tank_bases) ? basis.tank_bases : [])
    .map((tank: any) => ({
      tank_id: normalizeText(tank?.tank_id) || normalizeText(tank?.tank_code),
      tank_code: normalizeText(tank?.tank_code),
      material: normalizeText(tank?.material),
      thickness_mm: normalizeNumber(tank?.thickness_mm),
      conductivity_w_m_k: normalizeNumber(tank?.conductivity_w_m_k),
      basis_version: normalizeText(tank?.basis_version),
      layers: (Array.isArray(tank?.layers) ? tank.layers : []).map((layer: any) => ({
        material: normalizeText(layer?.material),
        thickness_mm: normalizeNumber(
          layer?.thickness_mm ?? (layer?.thickness_m == null ? null : Number(layer.thickness_m) * 1000),
        ),
        conductivity_w_m_k: normalizeNumber(layer?.conductivity_w_m_k),
      })),
    }))
    .sort((left: any, right: any) => String(left.tank_id).localeCompare(String(right.tank_id)));
  return {
    basis_version: normalizeText(basis.basis_version ?? basis.version),
    source_basis: normalizeText(basis.source_basis),
    source_reference: normalizeText(basis.source_reference),
    material: normalizeText(basis.material),
    thickness_mm: normalizeNumber(basis.thickness_mm),
    conductivity_w_m_k: normalizeNumber(basis.conductivity_w_m_k),
    layers,
    tank_bases: tankBases,
  };
}

function thermalWallBasisChange(
  savedBasis: any,
  currentBasis: any,
  savedDefaults: readonly any[] = [],
  currentDefaults: readonly any[] = [],
) {
  const savedComparable = thermalWallBasisComparable(savedBasis);
  const currentComparable = thermalWallBasisComparable(currentBasis);
  if (!savedComparable || !currentComparable) return null;
  const applicableCodes = [...new Set([
    savedBasis?.construction_type,
    ...(savedBasis?.tank_bases || []).map((tank: any) => tank?.construction_type),
  ].map((value: any) => String(value || '').trim().toLowerCase()).filter(Boolean))];
  const defaultFor = (defaults: readonly any[], code: string) => defaults.find(defaultBasis =>
    String(defaultBasis?.code || defaultBasis?.construction_code || defaultBasis?.construction_type || '')
      .trim().toLowerCase() === code);
  const changedFields = [
    'basis_version',
    'conductivity_w_m_k',
    'thickness_mm',
    'material',
    'source_basis',
    'source_reference',
    'layers',
  ].filter(field => {
    return applicableCodes.some(code => {
      const savedDefault = thermalWallBasisComparable(defaultFor(savedDefaults, code));
      const currentDefault = thermalWallBasisComparable(defaultFor(currentDefaults, code));
      return !!savedDefault && !!currentDefault &&
        JSON.stringify(savedDefault[field as keyof typeof savedDefault]) !==
          JSON.stringify(currentDefault[field as keyof typeof currentDefault]);
    });
  });
  if (!changedFields.length) return null;
  return {
    changed: true,
    changed_fields: changedFields,
    saved: savedBasis,
    current: currentBasis,
  };
}

function stableThermalSourceValue(value: any): any {
  if (Array.isArray(value)) return value.map(stableThermalSourceValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((normalized: Record<string, any>, key) => {
    normalized[key] = stableThermalSourceValue(value[key]);
    return normalized;
  }, {});
}

function thermalNonWallSourceChanged(savedSource: any, currentSource: any) {
  if (!savedSource || !currentSource) return true;
  const withoutWallEvidence = (source: any) => {
    const {
      fingerprint: _fingerprint,
      wall_construction_defaults: _wallDefaults,
      wall_construction_basis: _wallBasis,
      ...rest
    } = source;
    return {
      ...rest,
      linked_tanks: (rest.linked_tanks || []).map((tank: any) => {
        const {
          wall_construction_basis: _tankWallBasis,
          exposed_wall_source: _exposedWallSource,
          ...tankSource
        } = tank;
        return tankSource;
      }),
    };
  };
  return JSON.stringify(stableThermalSourceValue(withoutWallEvidence(savedSource))) !==
    JSON.stringify(stableThermalSourceValue(withoutWallEvidence(currentSource)));
}

async function insertThermalSnapshotRecord(
  runner: DbRunner,
  designBookId: string,
  item: any,
) {
  const row = item?.saved || item;
  if (!row?.system_id || !row?.calculation_version || !row?.source_fingerprint) return;
  await runner(
    `INSERT INTO design_book_thermal_calculations
       (design_book_id, system_id, calculation_version, status, freshness,
        source_fingerprint, source_snapshot, constants, formula_inputs,
        input_snapshot, result_snapshot, sensitivity_cases, correlation_snapshot,
        deviation_justification, calculated_by, calculated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16)`,
    [
      designBookId,
      row.system_id,
      row.calculation_version,
      row.status || 'Blocked',
      row.freshness === 'stale' ? 'stale' : 'fresh',
      row.source_fingerprint,
      JSON.stringify(row.source_snapshot || item.source || {}),
      JSON.stringify(row.constants || item.calculation?.constants || {}),
      JSON.stringify(row.formula_inputs || item.calculation?.formula_inputs || {}),
      JSON.stringify(row.input_snapshot || item.calculation?.inputs || {}),
      JSON.stringify(row.result_snapshot || item.calculation || {}),
      JSON.stringify(row.sensitivity_cases || item.calculation?.sensitivity_cases || []),
      JSON.stringify(row.correlation_snapshot || item.calculation?.correlation_snapshot ||
        row.input_snapshot?.agitation_correlation_snapshot || {}),
      row.deviation_justification || null,
      row.calculated_by || null,
      row.calculated_at || new Date().toISOString(),
    ],
  );
}

export const thermalCalculationTestUtils = {
  insertThermalSnapshotRecord,
  loadThermalCalculations,
  thermalNonWallSourceChanged,
  thermalWallBasisChange,
};

async function insertFrictionSnapshotRecord(
  runner: DbRunner,
  designBookId: string,
  systemId: string,
  item: any,
) {
  if (!item?.circuit_key || !item?.project_equipment_item_id || !item?.source_fingerprint) return;
  const sourceSnapshot = item.source_snapshot || {
    circuit: {
      circuit_key: item.circuit_key,
      circuit_kind: item.circuit_kind,
      circuit_name: item.circuit_name,
      circuit_type: item.circuit_type,
      parent_loop_number: item.parent_loop_number,
      side_stream_id: item.side_stream_id,
      flow_m3h: item.flow_m3h,
    },
    selected_pump: item.selected_pump,
    components: item.result?.components || item.components || [],
  };
  const result = await runner(
    `INSERT INTO design_book_friction_loss_calculations
       (design_book_id, system_id, circuit_key, project_equipment_item_id,
        calculation_version, status, freshness, source_fingerprint,
        source_snapshot, input_snapshot, result_snapshot, calculated_by, calculated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13)
     RETURNING id`,
    [
      designBookId, systemId, item.circuit_key, item.project_equipment_item_id,
      item.calculation_version || FRICTION_LOSS_CALCULATION_VERSION,
      String(item.status || '').toLowerCase() === 'ready' ? 'Ready' : 'Blocked',
      item.freshness === 'stale' ? 'stale' : 'fresh', item.source_fingerprint,
      JSON.stringify(sourceSnapshot),
      JSON.stringify(item.result?.inputs || {
        flow_m3h: item.flow_m3h,
        components: item.result?.components || item.components || [],
      }),
      JSON.stringify(item.result || {}),
      item.calculated_by || null, item.calculated_at || new Date().toISOString(),
    ],
  );
  const calculationId = result.rows[0]?.id;
  if (!calculationId) return;
  for (const [index, component] of (item.result?.components || item.components || []).entries()) {
    await runner(
      `INSERT INTO design_book_friction_loss_components
         (calculation_id, project_piping_item_id, side, component_kind, sort_order,
          piping_snapshot, internal_diameter_mm, straight_length_m, material,
          absolute_roughness_mm, fitting_k_value, quantity)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)`,
      [
        calculationId, component.project_piping_item_id, component.side,
        component.component_kind, component.sort_order ?? index,
        JSON.stringify(component.piping_snapshot || {}), component.internal_diameter_mm,
        component.straight_length_m, component.material, component.absolute_roughness_mm,
        component.fitting_k_value, component.quantity,
      ],
    );
  }
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

function positiveCorrelationCoefficient(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function thermalWallExpectedCurrentMatches(current: any, expectedCurrentId: string) {
  return current ? expectedCurrentId === current.id : !expectedCurrentId;
}

function thermalWallConstructionDefaultRow(row: any) {
  const thicknessMm = row.thickness_mm == null ? null : Number(row.thickness_mm);
  const conductivity = Number(row.conductivity_w_m_k);
  return {
    id: row.id || null,
    code: row.construction_code || row.code,
    label: row.construction_label || row.label,
    material: row.material,
    thickness_mm: thicknessMm,
    conductivity_w_m_k: conductivity,
    units: 'W/m²·K',
    thickness_units: row.thickness_units || 'mm',
    conductivity_units: row.conductivity_units || 'W/m·K',
    basis_version: row.version || row.basis_version,
    source_basis: row.source_basis || 'AAT Foundations',
    source_reference: row.source_reference,
    notes: row.notes || null,
    assumption_label: row.assumption_label ||
      `Provisional ${row.source_basis || 'AAT Foundations'} starter default — ${row.material} wall`,
    approval: {
      status: row.status || 'approved',
      approved_by: row.approved_by || null,
      approved_at: row.approved_at || null,
      approved_by_name: row.approved_by_name || null,
      approved_by_email: row.approved_by_email || null,
      superseded_by: row.superseded_by || null,
      superseded_at: row.superseded_at || null,
      superseded_by_name: row.superseded_by_name || null,
      superseded_by_email: row.superseded_by_email || null,
    },
  };
}

async function loadThermalWallConstructionDefaults(runner: DbRunner) {
  const result = await runner(
    `SELECT DISTINCT ON (construction_code) *
     FROM thermal_wall_construction_defaults
     WHERE status='approved'
     ORDER BY construction_code, approved_at DESC, created_at DESC, id DESC`,
  );
  return result.rows.map(thermalWallConstructionDefaultRow);
}

async function loadThermalWallConstructionHistory(runner: DbRunner) {
  const result = await runner(
    `SELECT tw.*,
            CONCAT_WS(' ', approved_user.first_name, approved_user.last_name) AS approved_by_name,
            approved_user.email AS approved_by_email,
            CONCAT_WS(' ', superseded_user.first_name, superseded_user.last_name) AS superseded_by_name,
            superseded_user.email AS superseded_by_email
     FROM thermal_wall_construction_defaults tw
     LEFT JOIN users approved_user ON approved_user.id=tw.approved_by
     LEFT JOIN users superseded_user ON superseded_user.id=tw.superseded_by
     ORDER BY tw.construction_code, tw.approved_at DESC, tw.created_at DESC, tw.id DESC`,
  );
  return result.rows.map(thermalWallConstructionDefaultRow);
}

async function resolveThermalWallConstructionInputs(
  runner: DbRunner,
  rawInputs: Record<string, any>,
  editableStatus = 'Draft',
) {
  const constructionCode = String(
    rawInputs.tank_construction_type ?? rawInputs.tank_construction ?? '',
  ).trim().toLowerCase();
  if (!constructionCode) return rawInputs;

  const result = await runner(
    `SELECT *
     FROM thermal_wall_construction_defaults
     WHERE construction_code=$1 AND status='approved'
     ORDER BY approved_at DESC, created_at DESC, id DESC
     LIMIT 1
     FOR SHARE`,
    [constructionCode],
  );
  const defaultRecord = result.rows[0]
    ? thermalWallConstructionDefaultRow(result.rows[0])
    : null;
  if (!defaultRecord) {
    const error: any = new Error('Select a current approved Thermal wall construction default.');
    error.status = 400;
    error.code = 'THERMAL_WALL_CONSTRUCTION_NOT_FOUND';
    throw error;
  }

  const requestedLayers = Array.isArray(rawInputs.tank_wall_layers) &&
    rawInputs.tank_wall_layers.length
    ? rawInputs.tank_wall_layers
    : [];
  if (!requestedLayers.length) {
    return {
      ...rawInputs,
      tank_construction_type: constructionCode,
      tank_wall_default_basis: defaultRecord,
      tank_wall_layers: [],
      tank_wall_layer_overrides: {},
      tank_wall_override_justification: String(
        rawInputs.tank_wall_override_justification ||
        rawInputs.wall_layer_override_justification ||
        '',
      ).trim(),
    };
  }
  if (requestedLayers.length !== 1) {
    const error: any = new Error('A standard Thermal construction requires exactly one effective wall layer.');
    error.status = 400;
    error.code = 'THERMAL_WALL_LAYER_INVALID';
    throw error;
  }
  const requested = requestedLayers[0] || {};
  const material = String(requested.material || '').trim();
  const thickness = positiveCorrelationCoefficient(requested.thickness_mm);
  const conductivity = positiveCorrelationCoefficient(requested.conductivity_w_m_k);
  if (!material || thickness == null || conductivity == null) {
    const error: any = new Error('Wall material and positive thickness and conductivity are required for an explicit wall-layer override.');
    error.status = 400;
    error.code = 'THERMAL_WALL_LAYER_INVALID';
    throw error;
  }
  const overrides = {
    material: material !== defaultRecord.material,
    conductivity_w_m_k: Math.abs(conductivity - defaultRecord.conductivity_w_m_k) > 1e-9,
  };
  if (Object.values(overrides).some(Boolean) && editableStatus !== 'Draft') {
    const error: any = new Error('Thermal wall-layer default overrides are only allowed while the Design Book is in Draft.');
    error.status = 409;
    error.code = 'THERMAL_WALL_LAYER_OVERRIDE_DRAFT_ONLY';
    throw error;
  }

  return {
    ...rawInputs,
    tank_construction_type: constructionCode,
    tank_wall_default_basis: defaultRecord,
    tank_wall_layers: [{
      material,
      thickness_mm: thickness,
      conductivity_w_m_k: conductivity,
    }],
    tank_wall_layer_overrides: overrides,
    tank_wall_override_justification: String(
      rawInputs.tank_wall_override_justification ||
      rawInputs.wall_layer_override_justification ||
      '',
    ).trim(),
  };
}

function correlationLibraryRow(row: any) {
  return {
    id: row.id,
    class_id: row.class_id,
    class_code: row.class_code,
    class_name: row.class_name,
    class_description: row.class_description,
    class_guidance: row.class_guidance || null,
    class_sort_order: row.class_sort_order,
    class_is_active: row.class_is_active,
    version: row.version,
    coefficient_kg_m2_s_kpa: Number(row.coefficient_kg_m2_s_kpa),
    activity_factor: row.activity_factor == null ? null : Number(row.activity_factor),
    base_coefficient_kg_m2_s_kpa: row.base_coefficient_kg_m2_s_kpa == null
      ? null : Number(row.base_coefficient_kg_m2_s_kpa),
    coefficient_unit: row.coefficient_unit || null,
    base_coefficient_unit: row.base_coefficient_unit || null,
    formula_basis: row.formula_basis || null,
    source_basis: row.source_basis || null,
    source_document: row.source_document || null,
    source_revision: row.source_revision || null,
    approving_engineer: row.approving_engineer || null,
    lower_agitation_class_code: row.lower_agitation_class_code || null,
    lower_agitation_class_name: row.lower_agitation_class_name || null,
    lower_class_coefficient_kg_m2_s_kpa: row.lower_class_coefficient_kg_m2_s_kpa == null
      ? null : Number(row.lower_class_coefficient_kg_m2_s_kpa),
    adjustment_value: row.adjustment_value == null ? null : Number(row.adjustment_value),
    adjustment_basis: row.adjustment_basis || null,
    upper_agitation_class_code: row.upper_agitation_class_code || null,
    upper_agitation_class_name: row.upper_agitation_class_name || null,
    upper_class_coefficient_kg_m2_s_kpa: row.upper_class_coefficient_kg_m2_s_kpa == null
      ? null : Number(row.upper_class_coefficient_kg_m2_s_kpa),
    related_agitation_values: row.related_agitation_values || {},
    source_reference: row.source_reference || null,
    notes: row.notes || null,
    status: row.status,
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    superseded_by: row.superseded_by || null,
    superseded_at: row.superseded_at || null,
    created_at: row.created_at,
    usage_count: Number(row.usage_count || 0),
  };
}

async function resolveThermalCorrelationInputs(
  runner: DbRunner,
  rawInputs: Record<string, any>,
  capturedAt = new Date().toISOString(),
  editableStatus = 'Draft',
) {
  const correlationId = String(rawInputs.agitation_correlation_id || '').trim();
  if (!correlationId) {
    const error: any = new Error('Select an approved shared-library evaporation correlation before saving.');
    error.status = 400;
    error.code = 'THERMAL_CORRELATION_REQUIRED';
    throw error;
  }

  const result = await runner(
    `SELECT c.id, c.agitation_class_id AS class_id, c.version,
            c.coefficient_kg_m2_s_kpa, c.source_reference, c.notes,
            c.activity_factor, c.base_coefficient_kg_m2_s_kpa,
            c.coefficient_unit, c.base_coefficient_unit, c.formula_basis,
            c.source_basis, c.source_document, c.source_revision,
            c.approving_engineer,
            c.lower_agitation_class_code, c.lower_agitation_class_name,
            c.lower_class_coefficient_kg_m2_s_kpa, c.adjustment_value, c.adjustment_basis,
            c.upper_agitation_class_code, c.upper_agitation_class_name,
            c.upper_class_coefficient_kg_m2_s_kpa, c.related_agitation_values,
            c.status, c.approved_by, c.approved_at,
            c.agitation_class_code AS class_code,
            c.agitation_class_name AS class_name,
            c.agitation_class_description AS class_description
     FROM thermal_mass_transfer_correlations c
     JOIN thermal_agitation_classes ac ON ac.id=c.agitation_class_id
     WHERE c.id=$1
     FOR SHARE`,
    [correlationId],
  );
  const row = result.rows[0];
  if (!row) {
    const error: any = new Error('The selected evaporation correlation does not exist.');
    error.status = 400;
    error.code = 'THERMAL_CORRELATION_NOT_FOUND';
    throw error;
  }
  if (row.status !== 'approved') {
    const error: any = new Error('The selected evaporation correlation has been superseded. Select the current approved version.');
    error.status = 409;
    error.code = 'THERMAL_CORRELATION_SUPERSEDED';
    throw error;
  }

  const deviation = rawInputs.agitation_correlation_deviation === true;
  const justification = String(rawInputs.deviation_justification || '').trim();
  const requestedOverrides = rawInputs.agitation_correlation_overrides &&
    typeof rawInputs.agitation_correlation_overrides === 'object'
    ? rawInputs.agitation_correlation_overrides : {};
  const overrideKeys = [
    'coefficient_kg_m2_s_kpa',
    'lower_class_coefficient_kg_m2_s_kpa',
    'adjustment_value',
    'upper_class_coefficient_kg_m2_s_kpa',
  ];
  const hasOverride = deviation || overrideKeys.some(key => requestedOverrides[key] === true);
  if (hasOverride && editableStatus !== 'Draft') {
    const error: any = new Error('Correlation default overrides are only allowed while the Design Book is in Draft.');
    error.status = 409;
    error.code = 'THERMAL_CORRELATION_OVERRIDE_DRAFT_ONLY';
    throw error;
  }
  if (hasOverride && !justification) {
    const error: any = new Error('A project-specific correlation deviation requires a justification.');
    error.status = 400;
    error.code = 'THERMAL_CORRELATION_DEVIATION_JUSTIFICATION_REQUIRED';
    throw error;
  }
  const libraryCoefficient = positiveCorrelationCoefficient(row.coefficient_kg_m2_s_kpa);
  const effectiveCoefficient = deviation
    ? positiveCorrelationCoefficient(rawInputs.evaporation_coefficient_kg_m2_s_kpa)
    : libraryCoefficient;
  if (effectiveCoefficient == null) {
    const error: any = new Error('A project-specific correlation deviation requires a positive mass-transfer coefficient.');
    error.status = 400;
    error.code = 'THERMAL_CORRELATION_DEVIATION_COEFFICIENT_REQUIRED';
    throw error;
  }

  const optionalPositive = (value: unknown, label: string) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = positiveCorrelationCoefficient(value);
    if (parsed == null) {
      const error: any = new Error(`${label} must be a positive finite value.`);
      error.status = 400;
      error.code = 'THERMAL_CORRELATION_OVERRIDE_INVALID';
      throw error;
    }
    return parsed;
  };
  const optionalFinite = (value: unknown, label: string) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      const error: any = new Error(`${label} must be a finite value.`);
      error.status = 400;
      error.code = 'THERMAL_CORRELATION_OVERRIDE_INVALID';
      throw error;
    }
    return parsed;
  };
  const defaults = {
    lower_agitation_class_code: row.lower_agitation_class_code || null,
    lower_agitation_class_name: row.lower_agitation_class_name || null,
    lower_class_coefficient_kg_m2_s_kpa: optionalPositive(
      row.lower_class_coefficient_kg_m2_s_kpa, 'Lower-class coefficient',
    ),
    adjustment_value: optionalFinite(row.adjustment_value, 'Adjustment value'),
    adjustment_basis: row.adjustment_basis || null,
    upper_agitation_class_code: row.upper_agitation_class_code || null,
    upper_agitation_class_name: row.upper_agitation_class_name || null,
    upper_class_coefficient_kg_m2_s_kpa: optionalPositive(
      row.upper_class_coefficient_kg_m2_s_kpa, 'Upper-class coefficient',
    ),
    related_agitation_values: row.related_agitation_values || {},
  };
  const effectiveValues = {
    coefficient_kg_m2_s_kpa: effectiveCoefficient,
    lower_class_coefficient_kg_m2_s_kpa: requestedOverrides.lower_class_coefficient_kg_m2_s_kpa === true
      ? optionalPositive(rawInputs.lower_class_coefficient_kg_m2_s_kpa, 'Lower-class coefficient')
      : defaults.lower_class_coefficient_kg_m2_s_kpa,
    adjustment_value: requestedOverrides.adjustment_value === true
      ? optionalFinite(rawInputs.adjustment_value, 'Adjustment value')
      : defaults.adjustment_value,
    upper_class_coefficient_kg_m2_s_kpa: requestedOverrides.upper_class_coefficient_kg_m2_s_kpa === true
      ? optionalPositive(rawInputs.upper_class_coefficient_kg_m2_s_kpa, 'Upper-class coefficient')
      : defaults.upper_class_coefficient_kg_m2_s_kpa,
  };
  if ((requestedOverrides.lower_class_coefficient_kg_m2_s_kpa === true &&
        effectiveValues.lower_class_coefficient_kg_m2_s_kpa == null) ||
      (requestedOverrides.adjustment_value === true &&
        effectiveValues.adjustment_value == null) ||
      (requestedOverrides.upper_class_coefficient_kg_m2_s_kpa === true &&
        effectiveValues.upper_class_coefficient_kg_m2_s_kpa == null)) {
    const error: any = new Error('Every marked correlation override requires a valid value.');
    error.status = 400;
    error.code = 'THERMAL_CORRELATION_OVERRIDE_INVALID';
    throw error;
  }
  const overrides = {
    coefficient_kg_m2_s_kpa: deviation,
    lower_class_coefficient_kg_m2_s_kpa: requestedOverrides.lower_class_coefficient_kg_m2_s_kpa === true,
    adjustment_value: requestedOverrides.adjustment_value === true,
    upper_class_coefficient_kg_m2_s_kpa: requestedOverrides.upper_class_coefficient_kg_m2_s_kpa === true,
  };
  const snapshot = {
    source: deviation ? 'project_deviation' : 'shared_library',
    correlation_id: row.id,
    class_id: row.class_id,
    agitation_class: row.class_code,
    agitation_class_name: row.class_name,
    agitation_class_description: row.class_description || null,
    version: row.version,
    coefficient_kg_m2_s_kpa: libraryCoefficient,
    effective_coefficient_kg_m2_s_kpa: effectiveCoefficient,
    approved: true,
    deviation,
    deviation_justification: deviation ? justification : null,
    source_reference: row.source_reference || null,
    notes: row.notes || null,
    activity_factor: row.activity_factor == null ? null : Number(row.activity_factor),
    base_coefficient_kg_m2_s_kpa: row.base_coefficient_kg_m2_s_kpa == null
      ? null : Number(row.base_coefficient_kg_m2_s_kpa),
    coefficient_unit: row.coefficient_unit || null,
    base_coefficient_unit: row.base_coefficient_unit || null,
    formula_basis: row.formula_basis || null,
    source_basis: row.source_basis || null,
    source_document: row.source_document || null,
    source_revision: row.source_revision || null,
    approving_engineer: row.approving_engineer || null,
    database_defaults: {
      coefficient_kg_m2_s_kpa: libraryCoefficient,
      activity_factor: row.activity_factor == null ? null : Number(row.activity_factor),
      base_coefficient_kg_m2_s_kpa: row.base_coefficient_kg_m2_s_kpa == null
        ? null : Number(row.base_coefficient_kg_m2_s_kpa),
      coefficient_unit: row.coefficient_unit || null,
      base_coefficient_unit: row.base_coefficient_unit || null,
      formula_basis: row.formula_basis || null,
      source_basis: row.source_basis || null,
      source_document: row.source_document || null,
      source_revision: row.source_revision || null,
      approving_engineer: row.approving_engineer || null,
      ...defaults,
    },
    effective_values: effectiveValues,
    overrides,
    coefficient_basis: deviation
      ? 'Project-specific Draft override of the approved shared-library coefficient'
      : 'Approved shared-library coefficient',
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    captured_at: capturedAt,
  };
  const adjacentAgitationClasses = [
    defaults.lower_agitation_class_code,
    defaults.upper_agitation_class_code,
  ].filter(Boolean);
  const agitationCorrelations: Record<string, any> = {
    [row.class_code]: {
      class: row.class_code,
      coefficient_kg_m2_s_kpa: effectiveCoefficient,
      version: row.version,
      approved: true,
      deviation,
      deviation_justification: deviation ? justification : null,
    },
  };
  if (defaults.lower_agitation_class_code &&
      effectiveValues.lower_class_coefficient_kg_m2_s_kpa != null) {
    agitationCorrelations[defaults.lower_agitation_class_code] = {
      class: defaults.lower_agitation_class_code,
      coefficient_kg_m2_s_kpa: effectiveValues.lower_class_coefficient_kg_m2_s_kpa,
      version: row.version,
      approved: true,
      deviation: overrides.lower_class_coefficient_kg_m2_s_kpa,
      deviation_justification: overrides.lower_class_coefficient_kg_m2_s_kpa
        ? justification : null,
    };
  }
  if (defaults.upper_agitation_class_code &&
      effectiveValues.upper_class_coefficient_kg_m2_s_kpa != null) {
    agitationCorrelations[defaults.upper_agitation_class_code] = {
      class: defaults.upper_agitation_class_code,
      coefficient_kg_m2_s_kpa: effectiveValues.upper_class_coefficient_kg_m2_s_kpa,
      version: row.version,
      approved: true,
      deviation: overrides.upper_class_coefficient_kg_m2_s_kpa,
      deviation_justification: overrides.upper_class_coefficient_kg_m2_s_kpa
        ? justification : null,
    };
  }

  return {
    ...rawInputs,
    agitation_class: row.class_code,
    agitation_correlation_class: row.class_code,
    agitation_correlation_version: row.version,
    agitation_correlation_approved: true,
    agitation_correlation_deviation: deviation,
    evaporation_coefficient_kg_m2_s_kpa: effectiveCoefficient,
    lower_agitation_class: defaults.lower_agitation_class_code,
    lower_class_coefficient_kg_m2_s_kpa: effectiveValues.lower_class_coefficient_kg_m2_s_kpa,
    adjustment_value: effectiveValues.adjustment_value,
    upper_agitation_class: defaults.upper_agitation_class_code,
    upper_class_coefficient_kg_m2_s_kpa: effectiveValues.upper_class_coefficient_kg_m2_s_kpa,
    agitation_correlation_overrides: overrides,
    adjacent_agitation_classes: adjacentAgitationClasses,
    agitation_correlations: agitationCorrelations,
    deviation_justification: deviation ? justification : '',
    agitation_correlation_snapshot: snapshot,
  };
}

export const thermalCorrelationTestUtils = {
  resolveThermalCorrelationInputs,
  resolveThermalWallConstructionInputs,
  loadThermalWallConstructionDefaults,
  loadThermalWallConstructionHistory,
  thermalWallExpectedCurrentMatches,
};

router.get('/thermal-wall-constructions', async (_req: AuthRequest, res: Response) => {
  res.json({ items: await loadThermalWallConstructionDefaults(query) });
});

router.get(
  '/thermal-wall-constructions/history',
  requireRole('admin', 'engineer'),
  requireModuleManage('design_books'),
  async (_req: AuthRequest, res: Response) => {
    res.json({ items: await loadThermalWallConstructionHistory(query) });
  },
);

router.post(
  '/thermal-wall-constructions/:constructionCode/versions',
  requireRole('admin', 'engineer'),
  requireModuleManage('design_books'),
  async (req: AuthRequest, res: Response) => {
    const constructionCode = routeParam(req.params.constructionCode).trim().toLowerCase();
    const version = String(req.body.version || '').trim();
    const material = String(req.body.material || '').trim();
    const conductivity = positiveCorrelationCoefficient(req.body.conductivity_w_m_k);
    const sourceBasis = String(req.body.source_basis || '').trim();
    const sourceReference = String(req.body.source_reference || '').trim();
    const expectedCurrentId = String(req.body.expected_current_id || '').trim();
    if (!constructionCode || !version || !material || conductivity == null ||
        !sourceBasis || !sourceReference) {
      return res.status(400).json({
        error: {
          code: 'THERMAL_WALL_CONSTRUCTION_REQUIRED',
          message: 'Version, material, positive conductivity, source basis, and source reference are required.',
        },
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `thermal-wall-construction:${constructionCode}`,
      ]);
      const history = await client.query(
        `SELECT *
         FROM thermal_wall_construction_defaults
         WHERE construction_code=$1
         ORDER BY approved_at DESC, created_at DESC, id DESC
         FOR UPDATE`,
        [constructionCode],
      );
      const current = history.rows.find(row => row.status === 'approved');
      const previous = current || history.rows[0] || null;
      if (!thermalWallExpectedCurrentMatches(current, expectedCurrentId)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: {
            code: 'THERMAL_WALL_CONSTRUCTION_CHANGED',
            message: 'The current wall construction version changed. Refresh the history and review the replacement again.',
          },
        });
      }
      const constructionLabel = String(
        req.body.construction_label || previous?.construction_label || '',
      ).trim();
      if (!constructionLabel) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: {
            code: 'THERMAL_WALL_CONSTRUCTION_LABEL_REQUIRED',
            message: 'Construction label is required for a new wall construction.',
          },
        });
      }
      if (current) {
        await client.query(
          `UPDATE thermal_wall_construction_defaults
           SET status='superseded', superseded_by=$1, superseded_at=NOW(), updated_at=NOW()
           WHERE id=$2`,
          [req.user!.id, current.id],
        );
      }
      const inserted = await client.query(
        `INSERT INTO thermal_wall_construction_defaults
           (construction_code, construction_label, material,
            conductivity_w_m_k, conductivity_units, version,
            source_basis, source_reference, notes, status, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved',$11)
         RETURNING *`,
        [
          constructionCode,
          constructionLabel,
          material,
          conductivity,
          String(req.body.conductivity_units || 'W/m·K').trim() || 'W/m·K',
          version,
          sourceBasis,
          sourceReference,
          String(req.body.notes || '').trim() || null,
          req.user!.id,
        ],
      );
      await insertAudit(
        client.query.bind(client) as DbRunner,
        req.user!.id,
        'thermal_wall_construction',
        inserted.rows[0].id,
        'APPROVE_VERSION',
        {
          summary: `${constructionCode} wall construction ${version} approved`,
          construction_code: constructionCode,
          version,
          superseded_version_id: current?.id || null,
          source_reference: sourceReference,
        },
        req.ip,
      );
      await client.query('COMMIT');
      res.status(201).json(thermalWallConstructionDefaultRow(inserted.rows[0]));
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        return res.status(409).json({
          error: {
            code: 'THERMAL_WALL_CONSTRUCTION_VERSION_EXISTS',
            message: 'That wall construction version already exists.',
          },
        });
      }
      throw error;
    } finally {
      client.release();
    }
  },
);

export async function loadReleaseContext(
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
          mat.material_code,
          mat.material_name,
          COALESCE(t.wall_thickness_mm, pm.wall_thickness_mm) AS eff_wall_thickness_mm,
         COALESCE(t.notes, pm.notes) AS eff_notes,
         COALESCE(t.gross_volume_m3, pm.gross_volume_m3) AS gross_volume_m3,
         COALESCE(t.operating_volume_m3, pm.operating_volume_m3) AS design_volume_m3,
         COALESCE(
           NULLIF(t.surface_area_m2, 0),
           NULLIF(pm.surface_area_m2, 0),
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
        LEFT JOIN materials mat ON mat.id=t.material_id
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
  const lightsResult = await runner(
    `SELECT l.*, pm.product_code AS current_pim_product_code,
            pm.product_name AS current_pim_product_name,
            pm.power_kw AS current_pim_power_kw,
            pe.rated_power_kw AS current_pim_rated_power_kw
     FROM design_book_exhibit_lights l
     LEFT JOIN product_masters pm ON pm.id=l.product_master_id
     LEFT JOIN product_electrical pe ON pe.product_master_id=pm.id
     WHERE l.design_book_id=$1
     ORDER BY l.exhibit_id, l.sort_order, l.created_at, l.id`,
    [id],
  );
  const species = speciesResult.rows.map(speciesValueSources);
  const hydraulics = hydraulicsResult.rows;
  const substrate = substrateResult.rows;
  const lights = lightsResult.rows;
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
  let biologicalMediaRuns: any[] = [];
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
               tp.revision AS tan_profile_revision, tp.status AS tan_profile_status,
               mt.profile_code AS max_tan_profile_code, mt.profile_name AS max_tan_profile_name,
               mt.revision AS max_tan_profile_revision, mt.status AS max_tan_profile_status,
               mt.engineering_note AS max_tan_profile_engineering_note
       FROM lss_biological_media_cases c
       LEFT JOIN lss_biological_media_profiles mp ON mp.id=c.media_profile_revision_id
       LEFT JOIN lss_tan_generation_profiles tp ON tp.id=c.tan_generation_profile_revision_id
        LEFT JOIN lss_max_tan_profiles mt ON mt.id=c.max_tan_profile_revision_id
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
      biologicalMediaRuns = (await runner(
        `SELECT r.*, u.first_name || ' ' || u.last_name AS created_by_name,
                au.first_name || ' ' || au.last_name AS approved_by_name
         FROM lss_biological_media_runs r
         LEFT JOIN users u ON u.id=r.created_by
         LEFT JOIN users au ON au.id=r.approved_by
         WHERE r.case_id = ANY($1::uuid[])
         ORDER BY r.case_id, r.run_number DESC`,
        [biologicalMediaCases.map(item => item.id)],
      )).rows;
    }
  }
  const uvSelections = systems.length
    ? (await runner(
      `SELECT *
       FROM design_book_uv_selections
       WHERE design_book_id=$1 AND system_id = ANY($2::uuid[])
       ORDER BY system_id`,
      [id, systems.map(system => system.id)],
    )).rows
    : [];
  const thermalSelections = systems.length
    ? (await runner(
      `SELECT *
       FROM design_book_thermal_selections
       WHERE design_book_id=$1 AND system_id = ANY($2::uuid[])
       ORDER BY system_id`,
      [id, systems.map(system => system.id)],
    )).rows
    : [];
  const ozoneCalculations = systems.length
    ? (await runner(
      `SELECT * FROM design_book_ozone_calculations
       WHERE design_book_id=$1 AND system_id = ANY($2::uuid[])
       ORDER BY system_id`,
      [id, systems.map(system => system.id)],
    )).rows
    : [];
  const compactUnitIds = systems.map(system => system.compact_unit_id).filter(Boolean);
  const compactUnits = compactUnitIds.length
    ? (await runner(
      `SELECT lcu.*,
          COALESCE((
            SELECT json_agg(e ORDER BY e.sort_order, e.created_at, e.id)
            FROM lss_compact_unit_equipment e
            WHERE e.compact_unit_id=lcu.id
          ), '[]'::json) AS equipment
       FROM lss_compact_units lcu
       WHERE lcu.id = ANY($1::uuid[])`,
      [compactUnitIds],
    )).rows
    : [];
  const systemCalculations = systems.map(system => calculateSystemEngineering(
    system,
    links.filter(link => link.system_id === system.id),
    exhibitCalculations,
    compactUnits.find(unit => unit.id === system.compact_unit_id) || null,
    calculatedAt,
    system.side_streams || [],
    system.fractionator_allocations || [],
    system.sand_filter_allocations || [],
  ));
  const currentSystems = systems.map(system => {
    const calculation = systemCalculations.find(
      item => item.inputs.system_id === system.id);
    return {
      ...system,
      stored_design_flow_m3h: system.design_flow_m3h,
      design_flow_m3h: calculation?.results.design_flow_m3h ?? null,
      design_flow_source: calculation?.inputs.design_flow_source || 'linked_exhibits',
      source_flows_m3h: calculation?.inputs.source_flows_m3h || {},
    };
  });
  const thermalConstructionDefaults = await loadThermalWallConstructionDefaults(runner);
  const pumpSelections = await loadPumpSelections(runner, currentSystems);
  const lssControls = await loadLssControls(runner, id, currentSystems);
  const thermalCalculations = await loadThermalCalculations(
    runner,
    id,
    currentSystems.filter(isLifeSupportSystem),
    links,
    exhibits,
    tanks,
    exhibitCalculations,
    thermalConstructionDefaults,
    lights,
    pumpSelections,
    uvSelections,
  );
  const frictionLossCalculations = await loadFrictionLossPackages(runner, id, currentSystems);

  const liveContext = {
    ...book,
    exhibits,
    tanks,
    systems: currentSystems,
    compact_units: compactUnits,
    system_links: links,
    species,
    hydraulics,
    substrate,
    lights,
    review_handovers: handovers,
    biological_media_cases: biologicalMediaCases,
    biological_media_runs: biologicalMediaRuns,
    uv_selections: uvSelections,
    thermal_selections: thermalSelections,
    ozone_calculations: ozoneCalculations,
    thermal_calculations: thermalCalculations,
    thermal_construction_defaults: thermalConstructionDefaults,
    pump_selections: pumpSelections,
    lss_controls: lssControls,
    // Flat evidence arrays are retained for version snapshot/restore code;
    // the grouped form above is convenient for Design Book aggregate clients.
    lss_control_configurations: lssControls.map(item => ({
      system_id: item.system_id,
      ...(item.control || {}),
    })).filter(item => !!item.id),
    lss_instrument_instances: lssControls.flatMap(item => item.instruments),
    friction_loss_calculations: frictionLossCalculations,
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

const thermalCorrelationUsageRowsCte = `
  WITH thermal_correlation_usage_rows AS (
    SELECT
      db.id AS design_book_id,
      db.status AS design_book_status,
      db.book_code,
      db.book_title,
      db.revision,
      db.project_id,
      p.project_code,
      p.project_name,
      calc.system_id::text AS system_id,
      s.system_code,
      s.system_name,
      COALESCE(
        NULLIF(calc.correlation_snapshot->>'correlation_id', ''),
        NULLIF(calc.result_snapshot->'correlation_snapshot'->>'correlation_id', ''),
        NULLIF(calc.input_snapshot->'agitation_correlation_snapshot'->>'correlation_id', '')
      ) AS correlation_id,
      COALESCE(
        NULLIF(calc.correlation_snapshot->>'captured_at', ''),
        NULLIF(calc.result_snapshot->'correlation_snapshot'->>'captured_at', ''),
        NULLIF(calc.input_snapshot->'agitation_correlation_snapshot'->>'captured_at', ''),
        calc.calculated_at::text
      ) AS captured_at
    FROM design_books db
    JOIN design_book_thermal_calculations calc ON calc.design_book_id=db.id
    LEFT JOIN projects p ON p.id=db.project_id
    LEFT JOIN systems s ON s.id=calc.system_id
    WHERE db.status IN ('Draft', 'In Progress')

    UNION ALL

    SELECT
      db.id AS design_book_id,
      db.status AS design_book_status,
      db.book_code,
      db.book_title,
      db.revision,
      db.project_id,
      p.project_code,
      p.project_name,
      item->>'system_id' AS system_id,
      item->'system'->>'system_code' AS system_code,
      item->'system'->>'system_name' AS system_name,
      COALESCE(
        NULLIF(item->'correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'calculation'->'correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'saved'->'correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'calculation'->'inputs'->'agitation_correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'saved'->'input_snapshot'->'agitation_correlation_snapshot'->>'correlation_id', '')
      ) AS correlation_id,
      COALESCE(
        NULLIF(item->'correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'calculation'->'correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'saved'->'correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'calculation'->'inputs'->'agitation_correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'saved'->'input_snapshot'->'agitation_correlation_snapshot'->>'captured_at', ''),
        db.updated_at::text
      ) AS captured_at
    FROM design_books db
    LEFT JOIN projects p ON p.id=db.project_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(db.review_snapshot->'thermal_calculations') = 'array'
          THEN db.review_snapshot->'thermal_calculations'
        ELSE '[]'::jsonb
      END
    ) AS item
    WHERE db.status IN ('For Review', 'Approved')

    UNION ALL

    SELECT
      db.id AS design_book_id,
      db.status AS design_book_status,
      db.book_code,
      db.book_title,
      db.revision,
      db.project_id,
      p.project_code,
      p.project_name,
      item->>'system_id' AS system_id,
      item->'system'->>'system_code' AS system_code,
      item->'system'->>'system_name' AS system_name,
      COALESCE(
        NULLIF(item->'correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'calculation'->'correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'saved'->'correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'calculation'->'inputs'->'agitation_correlation_snapshot'->>'correlation_id', ''),
        NULLIF(item->'saved'->'input_snapshot'->'agitation_correlation_snapshot'->>'correlation_id', '')
      ) AS correlation_id,
      COALESCE(
        NULLIF(item->'correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'calculation'->'correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'saved'->'correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'calculation'->'inputs'->'agitation_correlation_snapshot'->>'captured_at', ''),
        NULLIF(item->'saved'->'input_snapshot'->'agitation_correlation_snapshot'->>'captured_at', ''),
        db.updated_at::text
      ) AS captured_at
    FROM design_books db
    LEFT JOIN projects p ON p.id=db.project_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(db.release_snapshot->'thermal_calculations') = 'array'
          THEN db.release_snapshot->'thermal_calculations'
        ELSE '[]'::jsonb
      END
    ) AS item
    WHERE db.status='Released'
  ),
  thermal_correlation_usage_counts AS (
    SELECT correlation_id, COUNT(*)::int AS usage_count
    FROM thermal_correlation_usage_rows
    WHERE correlation_id IS NOT NULL
    GROUP BY correlation_id
  )
`;

const thermalCorrelationUsagesSelect = `
${thermalCorrelationUsageRowsCte}
  SELECT design_book_id, design_book_status, book_code, book_title, revision,
         project_id, project_code, project_name, system_id, system_code,
         system_name, correlation_id, captured_at
  FROM thermal_correlation_usage_rows
  WHERE correlation_id=$1
  ORDER BY
    CASE design_book_status
      WHEN 'Draft' THEN 1
      WHEN 'In Progress' THEN 2
      WHEN 'For Review' THEN 3
      WHEN 'Approved' THEN 4
      WHEN 'Released' THEN 5
      ELSE 6
    END,
    COALESCE(project_name, ''),
    COALESCE(book_code, ''),
    COALESCE(system_code, ''),
    captured_at DESC`;

async function lockAndReloadThermalCorrelationUsages(runner: DbRunner, correlationId: string) {
  const initial = await runner(thermalCorrelationUsagesSelect, [correlationId]);
  const designBookIds = [...new Set(
    initial.rows.map(usage => String(usage.design_book_id || '')).filter(Boolean),
  )];
  if (designBookIds.length) {
    await runner(
      `SELECT id FROM design_books
       WHERE id = ANY($1::uuid[])
       ORDER BY id
       FOR SHARE`,
      [designBookIds],
    );
  }
  return (await runner(thermalCorrelationUsagesSelect, [correlationId])).rows;
}

function thermalCorrelationImpactToken(correlationId: string, usages: any[]) {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('SESSION_SECRET or JWT_SECRET is required for thermal correlation impact confirmation.');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(
    usages.map(usage => ({
      design_book_id: usage.design_book_id,
      design_book_status: usage.design_book_status,
      project_id: usage.project_id,
      system_id: usage.system_id,
      captured_at: usage.captured_at,
    })),
  )).digest('hex');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${correlationId}.${fingerprint}`)
    .digest('hex');
  return `${fingerprint}.${signature}`;
}

function thermalCorrelationImpactConfirmed(correlationId: string, usages: any[], token: unknown) {
  const expected = thermalCorrelationImpactToken(correlationId, usages);
  const supplied = String(token || '');
  if (supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function sendThermalCorrelationImpactChanged(res: Response) {
  return res.status(409).json({
    error: {
      code: 'THERMAL_CORRELATION_IMPACT_CHANGED',
      message: 'Correlation usage changed or has not been confirmed. Reopen the usage view before superseding.',
    },
  });
}

const thermalCorrelationLibrarySelect = `
${thermalCorrelationUsageRowsCte}
  SELECT c.id, c.agitation_class_id AS class_id,
         c.agitation_class_code AS class_code,
         c.agitation_class_name AS class_name,
         c.agitation_class_description AS class_description,
         ac.guidance AS class_guidance,
         ac.sort_order AS class_sort_order, ac.is_active AS class_is_active,
         c.version, c.coefficient_kg_m2_s_kpa,
         c.activity_factor, c.base_coefficient_kg_m2_s_kpa,
         c.coefficient_unit, c.base_coefficient_unit, c.formula_basis,
         c.source_basis, c.source_document, c.source_revision,
         c.approving_engineer,
         c.lower_agitation_class_code, c.lower_agitation_class_name,
         c.lower_class_coefficient_kg_m2_s_kpa, c.adjustment_value, c.adjustment_basis,
         c.upper_agitation_class_code, c.upper_agitation_class_name,
         c.upper_class_coefficient_kg_m2_s_kpa, c.related_agitation_values,
         c.source_reference, c.notes,
          c.status, c.approved_by, c.approved_at,
          c.superseded_by, c.superseded_at, c.created_at,
          COALESCE(uc.usage_count, 0)::int AS usage_count
   FROM thermal_mass_transfer_correlations c
   JOIN thermal_agitation_classes ac ON ac.id=c.agitation_class_id
   LEFT JOIN thermal_correlation_usage_counts uc ON uc.correlation_id=c.id::text`;

router.get('/thermal-correlations', async (_req: AuthRequest, res: Response) => {
  const [classes, result] = await Promise.all([
    query(
      `SELECT id, class_code, class_name, description, guidance, sort_order, is_active, created_at, updated_at
       FROM thermal_agitation_classes
       ORDER BY
         CASE class_code
           WHEN 'calm_covered' THEN 1
           WHEN 'normal_circulation' THEN 2
           WHEN 'high_agitation_aerated' THEN 3
           WHEN 'splashing_active' THEN 4
           ELSE 5
         END,
         sort_order, class_name`,
    ),
    query(
      `${thermalCorrelationLibrarySelect}
       ORDER BY ac.sort_order, c.agitation_class_name, c.approved_at DESC, c.created_at DESC`,
    ),
  ]);
  res.json({ classes: classes.rows, items: result.rows.map(correlationLibraryRow) });
});

router.get(
  '/thermal-correlations/versions/:versionId/usages',
  requireRole('admin'),
  async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const correlationResult = await client.query(
        `${thermalCorrelationLibrarySelect} WHERE c.id=$1`,
        [req.params.versionId],
      );
      if (!correlationResult.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: { code: 'THERMAL_CORRELATION_NOT_FOUND', message: 'Thermal correlation version not found.' },
        });
      }
      const usages = await client.query(thermalCorrelationUsagesSelect, [req.params.versionId]);
      await client.query('COMMIT');
      res.json({
        correlation: correlationLibraryRow(correlationResult.rows[0]),
        usages: usages.rows,
        impact_token: thermalCorrelationImpactToken(routeParam(req.params.versionId), usages.rows),
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
  '/thermal-correlations/classes',
  requireRole('admin'),
  async (req: AuthRequest, res: Response) => {
    const classCode = String(req.body.class_code || '').trim();
    const className = String(req.body.class_name || '').trim();
    if (!classCode || !className) {
      return res.status(400).json({
        error: { code: 'THERMAL_CLASS_REQUIRED', message: 'Class code and class name are required.' },
      });
    }
    try {
      const result = await query(
        `INSERT INTO thermal_agitation_classes
           (class_code, class_name, description, guidance, sort_order, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          classCode,
          className,
          String(req.body.description || '').trim() || null,
          String(req.body.guidance || '').trim() || null,
          Number.isInteger(Number(req.body.sort_order)) ? Number(req.body.sort_order) : 0,
          req.user!.id,
        ],
      );
      await insertAudit(query, req.user!.id, 'thermal_agitation_class', result.rows[0].id, 'CREATE', {
        summary: `Thermal agitation class ${classCode} created`,
      }, req.ip);
      res.status(201).json(result.rows[0]);
    } catch (error: any) {
      if (error?.code === '23505') {
        return res.status(409).json({
          error: { code: 'THERMAL_CLASS_EXISTS', message: 'That agitation class code already exists.' },
        });
      }
      throw error;
    }
  },
);

router.put(
  '/thermal-correlations/classes/:classId',
  requireRole('admin'),
  async (req: AuthRequest, res: Response) => {
    const classCode = String(req.body.class_code || '').trim();
    const className = String(req.body.class_name || '').trim();
    if (!classCode || !className) {
      return res.status(400).json({
        error: { code: 'THERMAL_CLASS_REQUIRED', message: 'Class code and class name are required.' },
      });
    }
    const result = await query(
      `UPDATE thermal_agitation_classes
       SET class_code=$1, class_name=$2, description=$3, guidance=$4, sort_order=$5,
           is_active=$6, updated_at=NOW()
       WHERE id=$7
       RETURNING *`,
      [
        classCode,
        className,
        String(req.body.description || '').trim() || null,
        String(req.body.guidance || '').trim() || null,
        Number.isInteger(Number(req.body.sort_order)) ? Number(req.body.sort_order) : 0,
        req.body.is_active !== false,
        req.params.classId,
      ],
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agitation class not found.' } });
    }
    await insertAudit(query, req.user!.id, 'thermal_agitation_class', result.rows[0].id, 'UPDATE', {
      summary: `Thermal agitation class ${classCode} updated; existing correlation versions remain unchanged`,
    }, req.ip);
    res.json(result.rows[0]);
  },
);

router.post(
  '/thermal-correlations/classes/:classId/versions',
  requireRole('admin'),
  async (req: AuthRequest, res: Response) => {
    const version = String(req.body.version || '').trim();
    const coefficient = positiveCorrelationCoefficient(req.body.coefficient_kg_m2_s_kpa);
    const optionalPositiveInput = (value: unknown) =>
      value == null || value === '' ? null : positiveCorrelationCoefficient(value);
    const lowerCoefficient = optionalPositiveInput(req.body.lower_class_coefficient_kg_m2_s_kpa);
    const upperCoefficient = optionalPositiveInput(req.body.upper_class_coefficient_kg_m2_s_kpa);
    const adjustment = req.body.adjustment_value == null || req.body.adjustment_value === ''
      ? null : Number(req.body.adjustment_value);
    const sourceReference = String(req.body.source_reference || '').trim();
    if (!version || coefficient == null || !sourceReference ||
        (req.body.lower_class_coefficient_kg_m2_s_kpa != null &&
          req.body.lower_class_coefficient_kg_m2_s_kpa !== '' && lowerCoefficient == null) ||
        (req.body.upper_class_coefficient_kg_m2_s_kpa != null &&
          req.body.upper_class_coefficient_kg_m2_s_kpa !== '' && upperCoefficient == null) ||
        (adjustment != null && !Number.isFinite(adjustment))) {
      return res.status(400).json({
        error: {
          code: 'THERMAL_CORRELATION_REQUIRED',
          message: 'Version, positive mass-transfer coefficient, and source reference are required.',
        },
      });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const classResult = await client.query(
        'SELECT * FROM thermal_agitation_classes WHERE id=$1 AND is_active=true FOR UPDATE',
        [req.params.classId],
      );
      const agitationClass = classResult.rows[0];
      if (!agitationClass) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Active agitation class not found.' },
        });
      }
      const currentApproved = await client.query(
        `SELECT id FROM thermal_mass_transfer_correlations
         WHERE agitation_class_id=$1 AND status='approved'
         FOR UPDATE`,
        [agitationClass.id],
      );
      if (currentApproved.rows[0]) {
        const usages = await lockAndReloadThermalCorrelationUsages(
          client.query.bind(client) as DbRunner,
          currentApproved.rows[0].id,
        );
        if (!thermalCorrelationImpactConfirmed(
          currentApproved.rows[0].id,
          usages,
          req.body.impact_token,
        )) {
          await client.query('ROLLBACK');
          return sendThermalCorrelationImpactChanged(res);
        }
      }
      await client.query(
        `UPDATE thermal_mass_transfer_correlations
         SET status='superseded', superseded_by=$1, superseded_at=NOW()
         WHERE agitation_class_id=$2 AND status='approved'`,
        [req.user!.id, agitationClass.id],
      );
      const inserted = await client.query(
        `INSERT INTO thermal_mass_transfer_correlations
           (agitation_class_id, agitation_class_code, agitation_class_name,
            agitation_class_description, version, coefficient_kg_m2_s_kpa,
            lower_agitation_class_code, lower_agitation_class_name,
            lower_class_coefficient_kg_m2_s_kpa, adjustment_value, adjustment_basis,
            upper_agitation_class_code, upper_agitation_class_name,
            upper_class_coefficient_kg_m2_s_kpa, related_agitation_values,
            source_reference, notes, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18)
         RETURNING *`,
        [
          agitationClass.id,
          agitationClass.class_code,
          agitationClass.class_name,
          agitationClass.description,
          version,
          coefficient,
          String(req.body.lower_agitation_class_code || '').trim() || null,
          String(req.body.lower_agitation_class_name || '').trim() || null,
          lowerCoefficient,
          adjustment,
          String(req.body.adjustment_basis || '').trim() || null,
          String(req.body.upper_agitation_class_code || '').trim() || null,
          String(req.body.upper_agitation_class_name || '').trim() || null,
          upperCoefficient,
          JSON.stringify(req.body.related_agitation_values &&
            typeof req.body.related_agitation_values === 'object'
            ? req.body.related_agitation_values : {}),
          sourceReference,
          String(req.body.notes || '').trim() || null,
          req.user!.id,
        ],
      );
      await insertAudit(
        client.query.bind(client) as DbRunner,
        req.user!.id,
        'thermal_correlation',
        inserted.rows[0].id,
        'APPROVE_VERSION',
        {
          summary: `${agitationClass.class_code} correlation ${version} approved`,
          agitation_class_id: agitationClass.id,
          coefficient_kg_m2_s_kpa: coefficient,
          source_reference: sourceReference,
        },
        req.ip,
      );
      await client.query('COMMIT');
      const response = await query(
        `${thermalCorrelationLibrarySelect} WHERE c.id=$1`,
        [inserted.rows[0].id],
      );
      res.status(201).json(correlationLibraryRow(response.rows[0]));
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        return res.status(409).json({
          error: { code: 'THERMAL_CORRELATION_VERSION_EXISTS', message: 'That version already exists for this agitation class.' },
        });
      }
      throw error;
    } finally {
      client.release();
    }
  },
);

router.post(
  '/thermal-correlations/versions/:versionId/supersede',
  requireRole('admin'),
  async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      // Read committed is intentional: after the exclusive correlation lock is
      // acquired, the usage query must see any thermal save that committed
      // while this transaction was waiting for that lock.
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const current = await client.query(
        `SELECT id FROM thermal_mass_transfer_correlations
         WHERE id=$1 AND status='approved'
         FOR UPDATE`,
        [req.params.versionId],
      );
      if (!current.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: { code: 'THERMAL_CORRELATION_NOT_APPROVED', message: 'Approved correlation version not found.' },
        });
      }
      const usages = await lockAndReloadThermalCorrelationUsages(
        client.query.bind(client) as DbRunner,
        routeParam(req.params.versionId),
      );
      if (!thermalCorrelationImpactConfirmed(routeParam(req.params.versionId), usages, req.body.impact_token)) {
        await client.query('ROLLBACK');
        return sendThermalCorrelationImpactChanged(res);
      }
      const result = await client.query(
        `UPDATE thermal_mass_transfer_correlations
         SET status='superseded', superseded_by=$1, superseded_at=NOW()
         WHERE id=$2 AND status='approved'
         RETURNING *`,
        [req.user!.id, req.params.versionId],
      );
      await insertAudit(
        client.query.bind(client) as DbRunner,
        req.user!.id,
        'thermal_correlation',
        result.rows[0].id,
        'SUPERSEDE',
        {
          summary: `Thermal correlation ${result.rows[0].version} superseded`,
          reason: String(req.body.reason || '').trim() || null,
          confirmed_usage_count: usages.length,
        },
        req.ip,
      );
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

router.get('/design-books/:id/thermal', authenticate, async (req: AuthRequest, res: Response) => {
  const frozen = await query(
    'SELECT status, review_snapshot, release_snapshot FROM design_books WHERE id=$1',
    [req.params.id],
  );
  if (!frozen.rows[0]) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  }
  const book = frozen.rows[0];
  if (book.status === 'Released' && book.release_snapshot) {
    return res.json({ items: book.release_snapshot.thermal_calculations || [], frozen: true });
  }
  if (['For Review', 'Approved'].includes(book.status) && book.review_snapshot) {
    return res.json({ items: book.review_snapshot.thermal_calculations || [], frozen: true });
  }
  const context = await loadReleaseContext(routeParam(req.params.id), query, false, true);
  res.json({ items: context?.thermal_calculations || [], frozen: false });
});

async function saveThermalCalculation(req: AuthRequest, res: Response) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const context = await loadReleaseContext(
      routeParam(req.params.id),
      client.query.bind(client) as DbRunner,
      true,
      true,
    );
    if (!context) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
    }
    if (!isDesignBookContentEditable(context.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: {
          code: 'DESIGN_BOOK_NOT_EDITABLE',
          message: 'Thermal calculations are read-only while the Design Book is under review, approved, or released.',
        },
      });
    }
    const item = (context.thermal_calculations || []).find(
      (candidate: any) => candidate.system_id === req.params.systemId,
    );
    if (!item) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: { code: 'INVALID_SYSTEM', message: 'The selected LSS system does not belong to this Design Book project.' },
      });
    }
    const lifecycleSystem = (context.systems || []).find(
      (candidate: any) => candidate.id === req.params.systemId,
    );
    if (isRetiredSystem(lifecycleSystem)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: systemLifecycleError(lifecycleSystem) });
    }
    const requestedInputs = req.body?.inputs && typeof req.body.inputs === 'object'
      ? req.body.inputs
      : req.body || {};
    const calculatedAt = new Date().toISOString();
    const inputs = await resolveThermalCorrelationInputs(
      client.query.bind(client) as DbRunner,
      requestedInputs,
      calculatedAt,
      context.status,
    );
    const resolvedInputs = await resolveThermalWallConstructionInputs(
      client.query.bind(client) as DbRunner,
      inputs,
      context.status,
    );
    const calculation = calculateThermalCalculation(
      item.source,
      resolvedInputs,
      calculatedAt,
    );
    const saved = await client.query(
      `INSERT INTO design_book_thermal_calculations
         (design_book_id, system_id, calculation_version, status, freshness,
          source_fingerprint, source_snapshot, constants, formula_inputs,
          input_snapshot, result_snapshot, sensitivity_cases, correlation_snapshot,
          deviation_justification, calculated_by, calculated_at)
       VALUES ($1,$2,$3,$4,'fresh',$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15)
       ON CONFLICT (design_book_id, system_id)
       DO UPDATE SET
         calculation_version=EXCLUDED.calculation_version,
         status=EXCLUDED.status,
         freshness='fresh',
         source_fingerprint=EXCLUDED.source_fingerprint,
         source_snapshot=EXCLUDED.source_snapshot,
         constants=EXCLUDED.constants,
         formula_inputs=EXCLUDED.formula_inputs,
         input_snapshot=EXCLUDED.input_snapshot,
         result_snapshot=EXCLUDED.result_snapshot,
         sensitivity_cases=EXCLUDED.sensitivity_cases,
         correlation_snapshot=EXCLUDED.correlation_snapshot,
         deviation_justification=EXCLUDED.deviation_justification,
         calculated_by=EXCLUDED.calculated_by,
         calculated_at=EXCLUDED.calculated_at,
         updated_at=NOW()
       RETURNING *`,
      [
        req.params.id,
        req.params.systemId,
        calculation.calculation_version,
        calculation.status,
        calculation.source_fingerprint,
        JSON.stringify(calculation.source_snapshot),
        JSON.stringify(calculation.constants),
        JSON.stringify(calculation.formula_inputs),
        JSON.stringify(calculation.inputs),
        JSON.stringify(calculation),
        JSON.stringify(calculation.sensitivity_cases),
        JSON.stringify(calculation.correlation_snapshot || {}),
        String(calculation.inputs.deviation_justification || '').trim() || null,
        req.user!.id,
        calculation.calculated_at,
      ],
    );
    await insertAudit(
      client.query.bind(client) as DbRunner,
      req.user!.id,
      'design_book',
      routeParam(req.params.id),
      'THERMAL_CALCULATED',
      {
        summary: `${item.system.system_code || item.system.system_name} thermal calculation saved`,
        system_id: req.params.systemId,
        calculation_version: calculation.calculation_version,
        calculation_status: calculation.status,
        source_fingerprint: calculation.source_fingerprint,
        correlation_id: calculation.correlation_snapshot?.correlation_id || null,
        correlation_version: calculation.correlation_snapshot?.version || null,
        correlation_deviation: calculation.correlation_snapshot?.deviation || false,
        water_temperature_basis: calculation.water_temperature_basis,
        wall_construction_basis: calculation.wall_construction_basis,
        deviation_justification: String(calculation.inputs.deviation_justification || '').trim() || null,
      },
      req.ip,
    );
    await client.query('COMMIT');
    res.json({
      ...item,
      saved: saved.rows[0],
      calculation,
      current_preview: calculation,
      status: calculation.status,
      freshness: 'fresh',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

router.post(
  '/design-books/:id/thermal/:systemId/calculate',
  authenticate,
  requireRole('admin', 'engineer'),
  requireModuleManage('design_books'),
  saveThermalCalculation,
);
router.put(
  '/design-books/:id/thermal/:systemId',
  authenticate,
  requireRole('admin', 'engineer'),
  requireModuleManage('design_books'),
  saveThermalCalculation,
);

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
          COALESCE(t.wall_thickness_mm, pm.wall_thickness_mm) as eff_wall_thickness_mm,
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
           t.gross_volume_m3,
           pm.gross_volume_m3,
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
           END
        ) as gross_volume_m3,
        COALESCE(
           t.operating_volume_m3,
           pm.operating_volume_m3,
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
           END
        ) as design_volume_m3,
         COALESCE(
           NULLIF(t.surface_area_m2, 0),
           NULLIF(pm.surface_area_m2, 0),
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
  const lightsResult = await query(
    `SELECT l.*, pm.product_code AS current_pim_product_code,
            pm.product_name AS current_pim_product_name,
            pm.power_kw AS current_pim_power_kw,
            pe.rated_power_kw AS current_pim_rated_power_kw
     FROM design_book_exhibit_lights l
     LEFT JOIN product_masters pm ON pm.id=l.product_master_id
     LEFT JOIN product_electrical pe ON pe.product_master_id=pm.id
     WHERE l.design_book_id=$1
     ORDER BY l.exhibit_id, l.sort_order, l.created_at, l.id`,
    [req.params.id],
  );
  const lights = lightsResult.rows;

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
    ? (await query(
      `SELECT lcu.*,
          COALESCE((
            SELECT json_agg(e ORDER BY e.sort_order, e.created_at, e.id)
            FROM lss_compact_unit_equipment e
            WHERE e.compact_unit_id=lcu.id
          ), '[]'::json) AS equipment
       FROM lss_compact_units lcu
       WHERE lcu.id = ANY($1::uuid[])`,
      [compactUnitIds],
    )).rows
    : [];
  const systemCalculations = systems.map(system => calculateSystemEngineering(
    system,
    systemLinks.filter(link => link.system_id === system.id),
    exhibitCalculations,
    compactUnits.find(unit => unit.id === system.compact_unit_id) || null,
    calculationTimestamp,
    system.side_streams || [],
    system.fractionator_allocations || [],
    system.sand_filter_allocations || [],
  ));
  const currentSystems = systems.map(system => {
    const calculation = systemCalculations.find(
      item => item.inputs.system_id === system.id);
    return {
      ...system,
      stored_design_flow_m3h: system.design_flow_m3h,
      design_flow_m3h: calculation?.results.design_flow_m3h ?? null,
      design_flow_source: calculation?.inputs.design_flow_source || 'linked_exhibits',
      source_flows_m3h: calculation?.inputs.source_flows_m3h || {},
    };
  });
  const thermalConstructionDefaults = await loadThermalWallConstructionDefaults(query);
  const pumpSelections = await loadPumpSelections(query, currentSystems);
  const lssControls = await loadLssControlSummaries(query, routeParam(req.params.id), currentSystems);
  const uvSelections = currentSystems.length
    ? (await query(
      `SELECT * FROM design_book_uv_selections
       WHERE design_book_id=$1 AND system_id = ANY($2::uuid[])
       ORDER BY system_id`,
      [routeParam(req.params.id), currentSystems.map(system => system.id)],
    )).rows
    : [];
  const thermalCalculations = await loadThermalCalculations(
    query,
    routeParam(req.params.id),
    currentSystems.filter(isLifeSupportSystem),
    systemLinks,
    exhibits,
    tanks,
    exhibitCalculations,
    thermalConstructionDefaults,
    lights,
    pumpSelections,
    uvSelections,
  );
  const thermalSelections = currentSystems.length
    ? (await query(
      `SELECT * FROM design_book_thermal_selections
       WHERE design_book_id=$1 AND system_id = ANY($2::uuid[])
       ORDER BY system_id`,
      [routeParam(req.params.id), currentSystems.map(system => system.id)],
    )).rows
    : [];
  const frictionLossCalculations = await loadFrictionLossPackages(
    query,
    routeParam(req.params.id),
    currentSystems,
  );

  const livePackage = {
    exhibits,
    tanks,
    systems: currentSystems,
    compact_units: compactUnits,
    system_links: systemLinks,
    species,
    hydraulics,
    substrate,
    lights,
    thermal_calculations: thermalCalculations,
    thermal_selections: thermalSelections,
    thermal_construction_defaults: thermalConstructionDefaults,
    pump_selections: pumpSelections,
    lss_controls: lssControls,
    friction_loss_calculations: frictionLossCalculations,
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
  // Editable books must always expose the current project assembly. In
  // particular, thermal entries are previews derived from eligible current
  // systems and do not depend on a saved thermal row. Frozen packages remain
  // authoritative once the book enters review or is released.
  const responsePackage = row.status === 'Released' && row.release_snapshot
    ? row.release_snapshot
    : ['For Review', 'Approved'].includes(row.status) && row.review_snapshot
      ? row.review_snapshot
      : {
          ...livePackage,
          thermal_calculations: currentSystems
            .filter(isLifeSupportSystem)
            .map(system => thermalCalculations.find(item => item.system_id === system.id))
            .filter(Boolean),
        };

  res.json({
    ...row,
    ...responsePackage,
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

const LIGHTING_TYPES = new Set(['LED', 'T8', 'T5', 'Metal Halide', 'Other']);
const LIGHTING_UNITS = new Set(['W', 'kW']);

function lightResponse(row: any) {
  const quantity = Number(row.quantity);
  const powerKw = Number(row.power_kw);
  const powerValue = Number(row.power_value);
  return {
    ...row,
    quantity,
    power_kw: powerKw,
    power_value: powerValue,
    total_power_kw: quantity * powerKw,
    total_power_value: quantity * powerValue,
    pim_power_kw: row.pim_power_kw == null ? null : Number(row.pim_power_kw),
    source: row.product_master_id ? 'pim' : 'manual',
  };
}

async function ensureLightingExhibit(bookId: string, exhibitId: string, res: Response) {
  const result = await query(
    `SELECT e.id
     FROM exhibits e
     JOIN design_books db ON db.project_id=e.project_id
     WHERE db.id=$1 AND e.id=$2`,
    [bookId, exhibitId],
  );
  if (!result.rows[0]) {
    res.status(404).json({
      error: { code: 'INVALID_EXHIBIT', message: 'The selected exhibit does not belong to this Design Book project.' },
    });
    return false;
  }
  return true;
}

function lightingProductWhere(qParam: unknown) {
  const filters = [
    `(UPPER(COALESCE(pm.product_category,'')) IN ('LIGHTING','LIGHT','LUMINAIRE','LAMP')
      OR UPPER(COALESCE(pm.application_type,'')) LIKE '%LIGHT%'
      OR UPPER(COALESCE(pm.application_type,'')) LIKE '%LAMP%'
      OR UPPER(pm.product_name) LIKE '%LIGHT%'
      OR UPPER(pm.product_name) LIKE '%LAMP%'
      OR UPPER(pm.product_name) LIKE '%LED%'
      OR UPPER(pm.product_name) LIKE '%T8%'
      OR UPPER(pm.product_name) LIKE '%T5%'
      OR UPPER(pm.product_name) LIKE '%METAL HALIDE%')`,
    `(pm.status IS NULL OR UPPER(BTRIM(pm.status))='ACTIVE')`,
    `(pm.standard_status IS NULL OR UPPER(BTRIM(pm.standard_status)) <> 'OBSOLETE')`,
    `COALESCE(pe.rated_power_kw, pm.power_kw) IS NOT NULL`,
    `COALESCE(pe.rated_power_kw, pm.power_kw) > 0`,
  ];
  const params: any[] = [];
  const q = String(qParam || '').trim();
  if (q) {
    params.push(`%${q}%`);
    const p = params.length;
    filters.push(`(pm.product_code ILIKE $${p} OR pm.product_name ILIKE $${p} OR COALESCE(pm.model,'') ILIKE $${p})`);
  }
  return { where: filters.join(' AND '), params };
}

router.get('/design-books/:id/lighting-products', authenticate, async (req: AuthRequest, res: Response) => {
  const book = await query('SELECT id FROM design_books WHERE id=$1', [req.params.id]);
  if (!book.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  const { where, params } = lightingProductWhere(req.query.q);
  const result = await query(
    `SELECT pm.id, pm.product_code, pm.product_name, pm.model, pm.product_category,
            COALESCE(pe.rated_power_kw, pm.power_kw) AS power_kw,
            pe.rated_power_kw, pe.voltage_v, pe.notes AS electrical_notes
     FROM product_masters pm
     LEFT JOIN product_electrical pe ON pe.product_master_id=pm.id
     WHERE ${where}
     ORDER BY pm.product_code, pm.product_name
     LIMIT 50`,
    params,
  );
  res.json({
    items: result.rows.map(row => ({
      ...row,
      model: row.model || row.product_code,
      description: row.product_name,
      power_kw: Number(row.power_kw),
    })),
  });
});

router.get('/design-books/:id/exhibits/:exhibitId/lights', authenticate, async (req: AuthRequest, res: Response) => {
  const book = await query('SELECT id, status, review_snapshot, release_snapshot FROM design_books WHERE id=$1', [req.params.id]);
  if (!book.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  if (!await ensureLightingExhibit(routeParam(req.params.id), routeParam(req.params.exhibitId), res)) return;
  const frozen = book.rows[0].status === 'Released'
    ? book.rows[0].release_snapshot
    : ['For Review', 'Approved'].includes(book.rows[0].status) ? book.rows[0].review_snapshot : null;
  if (frozen && Array.isArray(frozen.lights)) {
    return res.json({ items: frozen.lights.filter((row: any) => row.exhibit_id === req.params.exhibitId).map(lightResponse), frozen: true });
  }
  const result = await query(
    `SELECT l.*, pm.product_code AS current_pim_product_code,
            pm.product_name AS current_pim_product_name,
            pm.power_kw AS current_pim_power_kw,
            pe.rated_power_kw AS current_pim_rated_power_kw
     FROM design_book_exhibit_lights l
     LEFT JOIN product_masters pm ON pm.id=l.product_master_id
     LEFT JOIN product_electrical pe ON pe.product_master_id=pm.id
     WHERE l.design_book_id=$1 AND l.exhibit_id=$2
     ORDER BY l.sort_order, l.created_at, l.id`,
    [req.params.id, req.params.exhibitId],
  );
  res.json({ items: result.rows.map(lightResponse), frozen: false });
});

async function loadEligibleLightingProduct(productMasterId: string) {
  const { where, params } = lightingProductWhere('');
  params.push(productMasterId);
  const result = await query(
    `SELECT pm.id, pm.product_code, pm.product_name, pm.model, pm.product_category,
            COALESCE(pe.rated_power_kw, pm.power_kw) AS power_kw
     FROM product_masters pm
     LEFT JOIN product_electrical pe ON pe.product_master_id=pm.id
     WHERE ${where} AND pm.id=$${params.length}`,
    params,
  );
  return result.rows[0] || null;
}

function parseLightInput(body: any) {
  const model = String(body.model || '').trim();
  const description = String(body.description || '').trim();
  const lightingType = String(body.lighting_type || body.lightingType || '').trim();
  const quantity = Number(body.quantity);
  const powerUnit = String(body.power_unit || body.powerUnit || 'kW');
  const powerValue = Number(body.power_value ?? body.unit_power ?? body.power);
  if (!model || !description || !lightingType) throw new Error('Model, description, lighting type, quantity, and power are required.');
  if (!LIGHTING_TYPES.has(lightingType) && lightingType.length > 100) throw new Error('Lighting type is too long.');
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a positive whole number.');
  if (!LIGHTING_UNITS.has(powerUnit)) throw new Error('Power unit must be W or kW.');
  if (!Number.isFinite(powerValue) || powerValue <= 0) throw new Error('Power must be greater than zero.');
  const powerKw = powerUnit === 'W' ? powerValue / 1000 : powerValue;
  return { model, description, lightingType, quantity, powerUnit, powerValue, powerKw };
}

router.post('/design-books/:id/exhibits/:exhibitId/lights', authenticate, requireRole('admin', 'engineer'), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  if (!await ensureBookEditable(routeParam(req.params.id), res)) return;
  if (!await ensureLightingExhibit(routeParam(req.params.id), routeParam(req.params.exhibitId), res)) return;
  try {
    const productMasterId = String(req.body.product_master_id || '').trim() || null;
    let pim: any = null;
    if (productMasterId) {
      pim = await loadEligibleLightingProduct(productMasterId);
      if (!pim) return res.status(400).json({ error: { code: 'INVALID_LIGHTING_PRODUCT', message: 'Selected Product Master is not an eligible active lighting product with an electrical power rating.' } });
    }
    let input = parseLightInput({
      ...req.body,
      model: pim ? (pim.model || pim.product_code) : req.body.model,
      description: pim ? pim.product_name : req.body.description,
      power_unit: pim ? 'kW' : req.body.power_unit,
      power_value: pim ? Number(pim.power_kw) : req.body.power_value,
    });
    const result = await query(
      `INSERT INTO design_book_exhibit_lights
         (design_book_id, exhibit_id, product_master_id, model, description, lighting_type,
          quantity, power_value, power_unit, power_kw, pim_model, pim_description,
          pim_product_code, pim_power_kw, pim_captured_at, sort_order, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),$15,$16,$16)
       RETURNING *`,
      [req.params.id, req.params.exhibitId, productMasterId, input.model, input.description,
        input.lightingType, input.quantity, input.powerValue, input.powerUnit, input.powerKw,
        pim ? (pim.model || pim.product_code) : null, pim?.product_name || null, pim?.product_code || null,
        pim ? Number(pim.power_kw) : null, Number(req.body.sort_order) || 0, req.user!.id],
    );
    await logAudit(req.user!.id, 'design_book', routeParam(req.params.id), 'LIGHT_ADDED', {
      summary: `${input.model} lighting row added`, exhibit_id: req.params.exhibitId, product_master_id: productMasterId,
    }, req.ip);
    res.status(201).json(lightResponse(result.rows[0]));
  } catch (error: any) {
    res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
  }
});

router.put('/design-books/:id/exhibits/:exhibitId/lights/:lightId', authenticate, requireRole('admin', 'engineer'), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  if (!await ensureBookEditable(routeParam(req.params.id), res)) return;
  if (!await ensureLightingExhibit(routeParam(req.params.id), routeParam(req.params.exhibitId), res)) return;
  try {
    const existingResult = await query(
      'SELECT * FROM design_book_exhibit_lights WHERE id=$1 AND design_book_id=$2 AND exhibit_id=$3',
      [req.params.lightId, req.params.id, req.params.exhibitId],
    );
    const existing = existingResult.rows[0];
    if (!existing) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Exhibit light not found' } });
    const productMasterIdWasProvided = req.body.product_master_id !== undefined;
    const productMasterId = !productMasterIdWasProvided
      ? existing.product_master_id
      : String(req.body.product_master_id || '').trim() || null;
    let pim: any = null;
    const productSelectionChanged = productMasterIdWasProvided
      && productMasterId !== existing.product_master_id;
    if (productMasterId && productSelectionChanged) {
      pim = await loadEligibleLightingProduct(productMasterId);
      if (!pim) return res.status(400).json({ error: { code: 'INVALID_LIGHTING_PRODUCT', message: 'Selected Product Master is not an eligible active lighting product with an electrical power rating.' } });
    }
    const rawRequestedUnit = String(req.body.power_unit ?? existing.power_unit);
    if (!LIGHTING_UNITS.has(rawRequestedUnit)) throw new Error('Power unit must be W or kW.');
    const requestedUnit = rawRequestedUnit as 'W' | 'kW';
    const retainedPimPowerKw = productMasterId && !productSelectionChanged
      ? Number(existing.power_kw)
      : null;
    const input = parseLightInput({
      ...existing,
      ...req.body,
      model: pim ? (pim.model || pim.product_code) : productMasterId ? existing.model : (req.body.model ?? existing.model),
      description: pim ? pim.product_name : productMasterId ? existing.description : (req.body.description ?? existing.description),
      power_value: pim
        ? Number(pim.power_kw)
        : retainedPimPowerKw != null
          ? (requestedUnit === 'W' ? retainedPimPowerKw * 1000 : retainedPimPowerKw)
          : (req.body.power_value ?? req.body.unit_power ?? existing.power_value),
      lighting_type: req.body.lighting_type ?? existing.lighting_type,
      power_unit: pim ? 'kW' : requestedUnit,
    });
    const snapshot = productMasterId
      ? {
          model: pim ? (pim.model || pim.product_code) : existing.pim_model,
          description: pim ? pim.product_name : existing.pim_description,
          code: pim ? pim.product_code : existing.pim_product_code,
          powerKw: pim ? Number(pim.power_kw) : existing.pim_power_kw,
        }
      : { model: null, description: null, code: null, powerKw: null };
    const result = await query(
      `UPDATE design_book_exhibit_lights
       SET product_master_id=$1, model=$2, description=$3, lighting_type=$4, quantity=$5,
           power_value=$6, power_unit=$7, power_kw=$8, pim_model=$9, pim_description=$10,
           pim_product_code=$11, pim_power_kw=$12,
           pim_captured_at=CASE WHEN $1 IS NULL THEN NULL WHEN $1 IS DISTINCT FROM product_master_id THEN NOW() ELSE pim_captured_at END,
           sort_order=$13, updated_by=$14, updated_at=NOW()
       WHERE id=$15 AND design_book_id=$16 AND exhibit_id=$17
       RETURNING *`,
      [productMasterId, input.model, input.description, input.lightingType, input.quantity,
        input.powerValue, input.powerUnit, input.powerKw, snapshot.model,
        snapshot.description, snapshot.code, snapshot.powerKw,
        req.body.sort_order === undefined ? existing.sort_order : Number(req.body.sort_order) || 0,
        req.user!.id, req.params.lightId, req.params.id, req.params.exhibitId],
    );
    res.json(lightResponse(result.rows[0]));
  } catch (error: any) {
    res.status(400).json({ error: { code: 'VALIDATION', message: error.message } });
  }
});

router.delete('/design-books/:id/exhibits/:exhibitId/lights/:lightId', authenticate, requireRole('admin', 'engineer'), requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  if (!await ensureBookEditable(routeParam(req.params.id), res)) return;
  if (!await ensureLightingExhibit(routeParam(req.params.id), routeParam(req.params.exhibitId), res)) return;
  const result = await query(
    'DELETE FROM design_book_exhibit_lights WHERE id=$1 AND design_book_id=$2 AND exhibit_id=$3 RETURNING id',
    [req.params.lightId, req.params.id, req.params.exhibitId],
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Exhibit light not found' } });
  await logAudit(req.user!.id, 'design_book', routeParam(req.params.id), 'LIGHT_REMOVED', {
    summary: 'Exhibit lighting row removed', exhibit_id: req.params.exhibitId, light_id: req.params.lightId,
  }, req.ip);
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
    inlet_pipe_dn, discharge_pipe_dn, bottom_drain_pipe_dn,
  } = req.body;
  const hasField = (field: string) => Object.prototype.hasOwnProperty.call(req.body, field);
  const hasWeirHead = hasField('weir_head_mm');
  const hasWeirLength = hasField('weir_length_mm');
  const hasWeirMethod = hasField('weir_formula_method');
  const hasWeirGeometry = hasField('weir_geometry');
  const hasWeirContractions = hasField('weir_end_contractions');
  const hasWeirDischarge = hasField('weir_discharge_condition');
  const hasWeirDownstreamHead = hasField('weir_downstream_head_mm');
  const hasInletPipeDn = hasField('inlet_pipe_dn');
  const hasDischargePipeDn = hasField('discharge_pipe_dn');
  const hasBottomDrainPipeDn = hasField('bottom_drain_pipe_dn');
  for (const [label, value] of [['Inlet pipe DN', inlet_pipe_dn], ['Discharge pipe DN', discharge_pipe_dn], ['Bottom drain pipe DN', bottom_drain_pipe_dn]] as const) {
    if (value != null && (!Number.isInteger(Number(value)) || Number(value) <= 0)) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: `${label} must be a positive whole DN.` } });
    }
  }
  const existingPipeResult = await query(
    `SELECT inlet_pipe_dn, discharge_pipe_dn, bottom_drain_pipe_dn,
            inlet_pipe_evidence, discharge_pipe_evidence, bottom_drain_pipe_evidence
     FROM design_book_exhibit_hydraulics WHERE design_book_id=$1 AND exhibit_id=$2`,
    [req.params.id, req.params.exhibitId],
  );
  const existingPipe = existingPipeResult.rows[0] || {};
  const effectiveInletPipeDn = hasInletPipeDn ? inlet_pipe_dn : existingPipe.inlet_pipe_dn;
  const effectiveDischargePipeDn = hasDischargePipeDn ? discharge_pipe_dn : existingPipe.discharge_pipe_dn;
  const effectiveBottomDrainPipeDn = hasBottomDrainPipeDn ? bottom_drain_pipe_dn : existingPipe.bottom_drain_pipe_dn;
  const requestedDns = [effectiveInletPipeDn, effectiveDischargePipeDn, effectiveBottomDrainPipeDn].filter(value => value != null).map(Number);
  let inletPipeEvidence: any = null;
  let dischargePipeEvidence: any = null;
  let bottomDrainPipeEvidence: any = null;
  if (requestedDns.length) {
    const standards = await query(`SELECT id, dn, internal_diameter_mm, is_active,
      pressure_velocity_min_m_s, pressure_velocity_max_m_s, gravity_velocity_min_m_s, gravity_velocity_max_m_s
      FROM pipe_sizing_standards WHERE is_active=true OR dn=ANY($1::int[])`, [requestedDns]);
    const explicitlyRequestedDns = [hasInletPipeDn ? inlet_pipe_dn : null, hasDischargePipeDn ? discharge_pipe_dn : null,
      hasBottomDrainPipeDn ? bottom_drain_pipe_dn : null]
      .filter(value => value != null).map(Number);
    if (explicitlyRequestedDns.some(dn => !standards.rows.some(row => Number(row.dn) === dn))) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'Saved pipe DN must exist in the pipe sizing standards.' } });
    }
    if (standards.rows.some(row => pipeVelocity(1, row.internal_diameter_mm) == null)) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'Pipe standard has an invalid internal diameter.' } });
    }
    const context = await loadReleaseContext(routeParam(req.params.id), query, false, true);
    const exhibit = context.exhibits.find((item: any) => item.id === req.params.exhibitId);
    if (!exhibit) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Exhibit not found in this Design Book project.' } });
    const existing = context.hydraulics.find((item: any) => item.exhibit_id === exhibit.id) || {};
    const source = { ...existing, target_turnover_rate: target_turnover_rate ?? existing.target_turnover_rate,
      surface_skim_pct: surface_skim_pct ?? existing.surface_skim_pct, bottom_drain_pct: bottom_drain_pct ?? existing.bottom_drain_pct };
    const calculated = calculateExhibitHydraulics(exhibit, context.tanks.filter((tank: any) => tank.exhibit_id === exhibit.id),
      source, context.substrate.find((item: any) => item.exhibit_id === exhibit.id), new Date().toISOString());
    const evidenceFor = (dn: any, service: 'inlet' | 'discharge' | 'bottom_drain') => {
      if (dn == null) return null;
      const standard = standards.rows.find(row => Number(row.dn) === Number(dn));
      const flow = service === 'inlet' ? calculated.results.total_return_flow_m3h
        : service === 'discharge' ? calculated.results.surface_skim_flow_m3h
          : calculated.results.bottom_drain_flow_m3h;
      const min = Number(standard[service === 'inlet' ? 'pressure_velocity_min_m_s' : 'gravity_velocity_min_m_s']);
      const max = Number(standard[service === 'inlet' ? 'pressure_velocity_max_m_s' : 'gravity_velocity_max_m_s']);
      const computed = pipeVelocity(flow, standard.internal_diameter_mm);
      if (computed == null) return null;
      const active = standards.rows.filter(row => row.is_active !== false).sort((a, b) => Number(a.dn) - Number(b.dn));
      const recommended = active.find(row => {
        const v = pipeVelocity(flow, row.internal_diameter_mm);
        const candidateMin = Number(row[service === 'inlet' ? 'pressure_velocity_min_m_s' : 'gravity_velocity_min_m_s']);
        const candidateMax = Number(row[service === 'inlet' ? 'pressure_velocity_max_m_s' : 'gravity_velocity_max_m_s']);
        return v != null && v >= candidateMin && v <= candidateMax;
      });
      return { standard_id: standard.id, dn: Number(standard.dn), internal_diameter_mm: Number(standard.internal_diameter_mm),
        velocity_min_m_s: min, velocity_max_m_s: max, authoritative_flow_m3h: Number(flow),
        computed_velocity_m_s: computed, within_band: computed >= min && computed <= max,
        selection_mode: Number(recommended?.dn) === Number(dn) ? 'recommended' : 'explicit' };
    };
    inletPipeEvidence = evidenceFor(effectiveInletPipeDn, 'inlet');
    dischargePipeEvidence = evidenceFor(effectiveDischargePipeDn, 'discharge');
    bottomDrainPipeEvidence = evidenceFor(effectiveBottomDrainPipeDn, 'bottom_drain');
    if ((hasInletPipeDn && !inletPipeEvidence) || (hasDischargePipeDn && !dischargePipeEvidence) ||
        (hasBottomDrainPipeDn && !bottomDrainPipeEvidence)) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'Current exhibit flow is unavailable; a finite pipe velocity cannot be saved.' } });
    }
  }
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
           inlet_pipe_dn, discharge_pipe_dn, bottom_drain_pipe_dn,
           inlet_pipe_evidence, discharge_pipe_evidence, bottom_drain_pipe_evidence,
           calculation_version, last_calculated_at, calculation_inputs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19::jsonb,
           '${AQUARIUM_CALCULATION_VERSION}',NOW(),$30)
     ON CONFLICT (design_book_id, exhibit_id)
     DO UPDATE SET
       target_turnover_rate = EXCLUDED.target_turnover_rate,
       surface_skim_pct     = EXCLUDED.surface_skim_pct,
       bottom_drain_pct     = EXCLUDED.bottom_drain_pct,
       notes                = EXCLUDED.notes,
           weir_head_mm = CASE WHEN $23 THEN EXCLUDED.weir_head_mm ELSE design_book_exhibit_hydraulics.weir_head_mm END,
           weir_length_mm = CASE WHEN $24 THEN EXCLUDED.weir_length_mm ELSE design_book_exhibit_hydraulics.weir_length_mm END,
           weir_formula_method = CASE WHEN $25 THEN EXCLUDED.weir_formula_method ELSE design_book_exhibit_hydraulics.weir_formula_method END,
           weir_geometry = CASE WHEN $26 THEN EXCLUDED.weir_geometry ELSE design_book_exhibit_hydraulics.weir_geometry END,
           weir_end_contractions = CASE WHEN $27 THEN EXCLUDED.weir_end_contractions ELSE design_book_exhibit_hydraulics.weir_end_contractions END,
           weir_discharge_condition = CASE WHEN $28 THEN EXCLUDED.weir_discharge_condition ELSE design_book_exhibit_hydraulics.weir_discharge_condition END,
           weir_downstream_head_mm = CASE WHEN $29 THEN EXCLUDED.weir_downstream_head_mm ELSE design_book_exhibit_hydraulics.weir_downstream_head_mm END,
          inlet_pipe_dn = CASE WHEN $20 THEN EXCLUDED.inlet_pipe_dn ELSE design_book_exhibit_hydraulics.inlet_pipe_dn END,
          discharge_pipe_dn = CASE WHEN $21 THEN EXCLUDED.discharge_pipe_dn ELSE design_book_exhibit_hydraulics.discharge_pipe_dn END,
          bottom_drain_pipe_dn = CASE WHEN $22 THEN EXCLUDED.bottom_drain_pipe_dn ELSE design_book_exhibit_hydraulics.bottom_drain_pipe_dn END,
          inlet_pipe_evidence = EXCLUDED.inlet_pipe_evidence,
          discharge_pipe_evidence = EXCLUDED.discharge_pipe_evidence,
           bottom_drain_pipe_evidence = EXCLUDED.bottom_drain_pipe_evidence,
       calculation_version   = EXCLUDED.calculation_version,
       last_calculated_at    = EXCLUDED.last_calculated_at,
       calculation_inputs    = EXCLUDED.calculation_inputs,
       updated_at           = NOW()
     RETURNING *`,
    [req.params.id, req.params.exhibitId,
     target_turnover_rate ?? null, savedSurfacePct, savedBottomPct,
     notes ?? null, weir_head_mm ?? null, weir_length_mm ?? null, weir_formula_method ?? null,
     weir_geometry ?? null, weir_end_contractions ?? null,
       weir_discharge_condition ?? null, weir_downstream_head_mm ?? null, inlet_pipe_dn ?? null, discharge_pipe_dn ?? null,
       bottom_drain_pipe_dn ?? null, inletPipeEvidence ? JSON.stringify(inletPipeEvidence) : null,
       dischargePipeEvidence ? JSON.stringify(dischargePipeEvidence) : null,
       bottomDrainPipeEvidence ? JSON.stringify(bottomDrainPipeEvidence) : null,
       hasInletPipeDn, hasDischargePipeDn, hasBottomDrainPipeDn,
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
               calculation_inputs, override_reason, inlet_pipe_dn, discharge_pipe_dn, bottom_drain_pipe_dn,
               inlet_pipe_evidence, discharge_pipe_evidence, bottom_drain_pipe_evidence)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
          [
            next.id, row.exhibit_id, row.target_turnover_rate, row.surface_skim_pct, row.bottom_drain_pct, row.notes,
            row.weir_head_mm, row.weir_length_mm, row.weir_formula_method, row.weir_geometry, row.weir_end_contractions,
            row.weir_discharge_condition, row.weir_downstream_head_mm, row.calculation_version, row.last_calculated_at,
              row.calculation_inputs, row.override_reason, row.inlet_pipe_dn, row.discharge_pipe_dn, row.bottom_drain_pipe_dn,
              row.inlet_pipe_evidence, row.discharge_pipe_evidence, row.bottom_drain_pipe_evidence,
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
      for (const row of snapshot.lights || []) {
        await client.query(
          `INSERT INTO design_book_exhibit_lights
             (design_book_id, exhibit_id, product_master_id, model, description, lighting_type,
              quantity, power_value, power_unit, power_kw, pim_model, pim_description,
              pim_product_code, pim_power_kw, pim_captured_at, sort_order, created_by, updated_by)
           VALUES ($1,$2,(SELECT id FROM product_masters WHERE id=$3),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,
          [next.id, row.exhibit_id, row.product_master_id ?? null, row.model, row.description,
            row.lighting_type, row.quantity, row.power_value, row.power_unit || 'kW', row.power_kw,
            row.pim_model ?? null, row.pim_description ?? null, row.pim_product_code ?? null,
            row.pim_power_kw ?? null, row.pim_captured_at ?? null, row.sort_order ?? 0, req.user!.id],
        );
      }
      for (const row of snapshot.thermal_calculations || []) {
        await insertThermalSnapshotRecord(
          client.query.bind(client) as DbRunner,
          next.id,
          row,
        );
      }
      for (const group of snapshot.friction_loss_calculations || []) {
        for (const item of group.items || []) {
          await insertFrictionSnapshotRecord(
            client.query.bind(client) as DbRunner,
            next.id,
            group.system_id,
            item,
          );
        }
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

const VERSION_SNAPSHOT_SCHEMA = 12;
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
    'lifecycle_reason', 'lifecycle_changed_at', 'lifecycle_changed_by',
    'superseded_by_system_id', 'supersedes_system_id',
    'replacement_system_code', 'replacement_system_name',
    'predecessor_system_code', 'predecessor_system_name', 'lifecycle_actor_name',
    'calculation_version', 'calculation_inputs', 'loop1_name', 'loop1_flow_source', 'loop1_filtration', 'loop1_flow_mode', 'loop1_match_loop_number',
    'loop1_flow_pct', 'loop1_bio_degas_pct', 'loop1_bio_degas_m3h', 'loop1_link_bio_degas',
    'loop2_name', 'loop2_flow_source', 'loop2_filtration', 'loop2_flow_mode', 'loop2_match_loop_number', 'loop2_flow_pct', 'loop2_bio_degas_pct',
    'loop2_bio_degas_m3h', 'loop2_link_bio_degas', 'loop3_name', 'loop3_flow_source', 'loop3_filtration', 'loop3_flow_mode', 'loop3_match_loop_number',
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
    thermal_calculations: snapshot?.thermal_calculations || [],
    friction_loss_calculations: snapshot?.friction_loss_calculations || [],
    ...(Array.isArray(snapshot?.lights) ? { lights: snapshot.lights } : {}),
    ...(Array.isArray(snapshot?.uv_selections) ? { uv_selections: snapshot.uv_selections } : {}),
    ...(Array.isArray(snapshot?.thermal_selections) ? { thermal_selections: snapshot.thermal_selections } : {}),
    ...(Array.isArray(snapshot?.review_handovers) ? { review_handovers: snapshot.review_handovers } : {}),
    // Control configuration deliberately contains catalog and product snapshots,
    // rather than only their live foreign keys.  An instrument definition or
    // product may be retired after a version is captured.
    ...(Array.isArray(snapshot?.lss_control_configurations)
      ? { lss_control_configurations: snapshot.lss_control_configurations }
      : {}),
    ...(Array.isArray(snapshot?.lss_instrument_instances)
      ? { lss_instrument_instances: snapshot.lss_instrument_instances }
      : {}),
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
      lights: jsonCopy(context.lights || []),
      uv_selections: jsonCopy(context.uv_selections || []),
      thermal_selections: jsonCopy(context.thermal_selections || []),
      thermal_calculations: jsonCopy(context.thermal_calculations || []),
      friction_loss_calculations: jsonCopy(context.friction_loss_calculations || []),
      review_handovers: jsonCopy(context.review_handovers || []),
      lss_control_configurations: jsonCopy(context.lss_control_configurations || []),
      lss_instrument_instances: jsonCopy(context.lss_instrument_instances || []),
    },
    live_references: liveReferencesFromContext(context),
      scope: {
        frozen: ['book metadata', 'species allocations', 'hydraulics', 'substrate and theming', 'lighting schedule', 'UV selections', 'Thermal selections', 'thermal calculations', 'friction loss calculations', 'review handovers', 'LSS control-panel selections and field-instrument catalog/product evidence'],
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
      lights: jsonCopy(context.lights || []),
      uv_selections: jsonCopy(context.uv_selections || []),
      thermal_selections: jsonCopy(context.thermal_selections || []),
      thermal_calculations: jsonCopy(context.thermal_calculations || []),
      friction_loss_calculations: jsonCopy(context.friction_loss_calculations || []),
      review_handovers: jsonCopy(context.review_handovers || []),
      lss_control_configurations: jsonCopy(context.lss_control_configurations || []),
      lss_instrument_instances: jsonCopy(context.lss_instrument_instances || []),
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
      lights: (frozen.lights || []).length,
      uv_selections: (frozen.uv_selections || []).length,
      thermal_calculations: (frozen.thermal_calculations || []).length,
      friction_loss_calculations: (frozen.friction_loss_calculations || []).reduce(
        (sum: number, group: any) => sum + (group.items || []).length,
        0,
      ),
      review_handovers: Array.isArray(frozen.review_handovers) ? frozen.review_handovers.length : null,
      lss_control_configurations: Array.isArray(frozen.lss_control_configurations)
        ? frozen.lss_control_configurations.length : null,
      lss_instrument_instances: Array.isArray(frozen.lss_instrument_instances)
        ? frozen.lss_instrument_instances.length : null,
    },
    live_references: {
      exhibits: (referencesFromSnapshot(snapshot).exhibits || []).length,
      tanks: (referencesFromSnapshot(snapshot).tanks || []).length,
      systems: (referencesFromSnapshot(snapshot).systems || []).length,
      system_links: (referencesFromSnapshot(snapshot).system_links || []).length,
    },
    restorable_records: [
      'book metadata', 'species', 'hydraulics', 'substrate and theming', 'thermal calculations', 'friction loss calculations',
      ...(Array.isArray(frozen.lights) ? ['lighting schedule'] : []),
      ...(Array.isArray(frozen.uv_selections) ? ['UV selections'] : []),
      ...(Array.isArray(frozen.review_handovers) ? ['review handovers'] : []),
       ...(Array.isArray(frozen.lss_control_configurations)
         ? ['LSS control-panel selections'] : []),
       ...(Array.isArray(frozen.lss_instrument_instances)
         ? ['LSS field instruments with catalog/product evidence'] : []),
    ],
    preserved_records: [
      ...(!Array.isArray(frozen.lights) ? ['lighting schedule (not captured by this older version)'] : []),
      ...(!Array.isArray(frozen.uv_selections) ? ['UV selections (not captured by this older version)'] : []),
      ...(!Array.isArray(frozen.review_handovers) ? ['review handovers (not captured by this older version)'] : []),
       ...(!Array.isArray(frozen.lss_control_configurations)
         ? ['LSS control-panel selections (not captured by this older version)'] : []),
       ...(!Array.isArray(frozen.lss_instrument_instances)
         ? ['LSS field instruments (not captured by this older version)'] : []),
    ],
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
        lights: (currentContext.lights || []).length,
        uv_selections: (currentContext.uv_selections || []).length,
        thermal_calculations: (currentContext.thermal_calculations || []).length,
        review_handovers: (currentContext.review_handovers || []).length,
        lss_control_configurations: (currentContext.lss_control_configurations || []).length,
        lss_instrument_instances: (currentContext.lss_instrument_instances || []).length,
      },
      after: {
        book_title: frozen.design_book?.book_title,
        revision: frozen.design_book?.revision,
        status: frozen.design_book?.status,
        species: (frozen.species || []).length,
        hydraulics: (frozen.hydraulics || []).length,
        substrate_theming: (frozen.substrate || []).length,
        lights: Array.isArray(frozen.lights)
          ? frozen.lights.length
          : (currentContext.lights || []).length,
        lights_preserved: !Array.isArray(frozen.lights),
        uv_selections: Array.isArray(frozen.uv_selections)
          ? frozen.uv_selections.length
          : (currentContext.uv_selections || []).length,
        uv_selections_preserved: !Array.isArray(frozen.uv_selections),
        thermal_calculations: (frozen.thermal_calculations || []).length,
        review_handovers: Array.isArray(frozen.review_handovers)
          ? frozen.review_handovers.length
          : (currentContext.review_handovers || []).length,
        review_handovers_preserved: !Array.isArray(frozen.review_handovers),
        lss_control_configurations: Array.isArray(frozen.lss_control_configurations)
          ? frozen.lss_control_configurations.length
          : (currentContext.lss_control_configurations || []).length,
        lss_control_configurations_preserved: !Array.isArray(frozen.lss_control_configurations),
        lss_instrument_instances: Array.isArray(frozen.lss_instrument_instances)
          ? frozen.lss_instrument_instances.length
          : (currentContext.lss_instrument_instances || []).length,
        lss_instrument_instances_preserved: !Array.isArray(frozen.lss_instrument_instances),
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
              calculation_inputs, override_reason, inlet_pipe_dn, discharge_pipe_dn, bottom_drain_pipe_dn,
              inlet_pipe_evidence, discharge_pipe_evidence, bottom_drain_pipe_evidence)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23::jsonb)`,
        [req.params.id, h.exhibit_id, h.target_turnover_rate ?? null, h.surface_skim_pct ?? 30,
          h.bottom_drain_pct ?? 70, h.notes ?? null, h.weir_head_mm ?? null, h.weir_length_mm ?? null,
          h.weir_formula_method ?? null, h.weir_geometry ?? null, h.weir_end_contractions ?? null,
          h.weir_discharge_condition ?? null, h.weir_downstream_head_mm ?? null, h.calculation_version ?? null,
          h.last_calculated_at ?? null, h.calculation_inputs ? JSON.stringify(h.calculation_inputs) : null,
            h.override_reason ?? null, h.inlet_pipe_dn ?? null, h.discharge_pipe_dn ?? null, h.bottom_drain_pipe_dn ?? null,
           h.inlet_pipe_evidence ? JSON.stringify(h.inlet_pipe_evidence) : null,
            h.discharge_pipe_evidence ? JSON.stringify(h.discharge_pipe_evidence) : null,
            h.bottom_drain_pipe_evidence ? JSON.stringify(h.bottom_drain_pipe_evidence) : null],
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
    if (Array.isArray(frozen.lights)) {
      await client.query('DELETE FROM design_book_exhibit_lights WHERE design_book_id=$1', [req.params.id]);
      for (const light of frozen.lights) {
        await client.query(
          `INSERT INTO design_book_exhibit_lights
             (design_book_id, exhibit_id, product_master_id, model, description, lighting_type,
              quantity, power_value, power_unit, power_kw, pim_model, pim_description,
              pim_product_code, pim_power_kw, pim_captured_at, sort_order, created_by, updated_by,
              created_at, updated_at)
           VALUES ($1,$2,(SELECT id FROM product_masters WHERE id=$3),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                   COALESCE($19,NOW()),COALESCE($20,NOW()))`,
          [req.params.id, light.exhibit_id, light.product_master_id ?? null, light.model,
            light.description, light.lighting_type, light.quantity, light.power_value,
            light.power_unit || 'kW', light.power_kw, light.pim_model ?? null,
            light.pim_description ?? null, light.pim_product_code ?? null, light.pim_power_kw ?? null,
            light.pim_captured_at ?? null, light.sort_order ?? 0, light.created_by ?? req.user!.id,
            req.user!.id, light.created_at ?? null, light.updated_at ?? null],
        );
      }
    }
    if (Array.isArray(frozen.uv_selections)) {
      await client.query('DELETE FROM design_book_uv_selections WHERE design_book_id=$1', [req.params.id]);
      for (const selection of frozen.uv_selections) {
        await client.query(
          `INSERT INTO design_book_uv_selections
             (design_book_id, system_id, target_fluence_mj_cm2, input_snapshot, result_snapshot,
              calculation_version, freshness, calculated_by, calculated_at, created_at, updated_at)
           SELECT $1, s.id, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9,
                  COALESCE($10,NOW()), COALESCE($11,NOW())
             FROM systems s
            WHERE s.id=$2 AND s.project_id=(SELECT project_id FROM design_books WHERE id=$1)`,
          [req.params.id, selection.system_id, selection.target_fluence_mj_cm2,
            JSON.stringify(selection.input_snapshot || {}), JSON.stringify(selection.result_snapshot || {}),
            selection.calculation_version ?? null, selection.freshness || 'stale',
            selection.calculated_by ?? null, selection.calculated_at ?? null,
            selection.created_at ?? null, selection.updated_at ?? null],
        );
      }
    }
    if (Array.isArray(frozen.thermal_selections)) {
      await client.query('DELETE FROM design_book_thermal_selections WHERE design_book_id=$1', [req.params.id]);
      for (const selection of frozen.thermal_selections) {
        await client.query(
          `INSERT INTO design_book_thermal_selections
             (design_book_id, system_id, product_master_id, side_stream_id,
              required_capacity_kw, plate_flow_m3h, duty, input_snapshot,
              product_snapshot, result_snapshot, freshness, calculated_by,
              calculated_at, created_at, updated_at)
           SELECT $1, s.id,
                  (SELECT id FROM product_masters WHERE id=$3),
                  (SELECT id FROM system_flow_side_streams WHERE id=$4 AND system_id=s.id),
                  $5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,
                  COALESCE($14,NOW()),COALESCE($15,NOW())
             FROM systems s
            WHERE s.id=$2 AND s.project_id=(SELECT project_id FROM design_books WHERE id=$1)`,
          [req.params.id, selection.system_id, selection.product_master_id ?? null,
            selection.side_stream_id ?? null, selection.required_capacity_kw,
            selection.plate_flow_m3h, selection.duty,
            JSON.stringify(selection.input_snapshot || {}),
            JSON.stringify(selection.product_snapshot || {}),
            JSON.stringify(selection.result_snapshot || {}),
            selection.freshness || 'stale', selection.calculated_by ?? null,
            selection.calculated_at ?? null, selection.created_at ?? null,
            selection.updated_at ?? null],
        );
      }
    }
    await client.query('DELETE FROM design_book_thermal_calculations WHERE design_book_id=$1', [req.params.id]);
    for (const thermal of frozen.thermal_calculations || []) {
      await insertThermalSnapshotRecord(
        client.query.bind(client) as DbRunner,
        routeParam(req.params.id),
        thermal,
      );
    }
    await client.query('DELETE FROM design_book_friction_loss_calculations WHERE design_book_id=$1', [req.params.id]);
    for (const group of frozen.friction_loss_calculations || []) {
      for (const item of group.items || []) {
        await insertFrictionSnapshotRecord(
          client.query.bind(client) as DbRunner,
          routeParam(req.params.id),
          group.system_id,
          item,
        );
      }
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
    if (Array.isArray(frozen.lss_control_configurations)) {
      await client.query('DELETE FROM design_book_lss_controls WHERE design_book_id=$1', [req.params.id]);
      for (const control of frozen.lss_control_configurations) {
        await client.query(
          `INSERT INTO design_book_lss_controls
             (design_book_id,system_id,panel_type,updated_by,created_at,updated_at)
           VALUES ($1,$2,$3,$4,COALESCE($5,NOW()),COALESCE($6,NOW()))`,
          [req.params.id, control.system_id, control.panel_type, control.updated_by ?? null,
            control.created_at ?? null, control.updated_at ?? null],
        );
      }
    }
    if (Array.isArray(frozen.lss_instrument_instances)) {
      await client.query('DELETE FROM design_book_lss_instruments WHERE design_book_id=$1', [req.params.id]);
      for (const instrument of frozen.lss_instrument_instances) {
        await client.query(
          `INSERT INTO design_book_lss_instruments
              (design_book_id,system_id,definition_id,tag,sequence_number,control_logic,range_min,range_max,unit,
               calibration_required,calibration_interval_days,calibration_procedure,datasheet_reference,product_master_id,
               definition_snapshot,product_snapshot,created_by,updated_by,created_at,updated_at)
            VALUES ($1,$2,
              (SELECT id FROM field_instrument_definitions WHERE id=$3),
              $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
              (SELECT id FROM product_masters WHERE id=$14),
              $15::jsonb,$16::jsonb,$17,$18,COALESCE($19,NOW()),COALESCE($20,NOW()))`,
          [req.params.id, instrument.system_id, instrument.definition_id ?? null, instrument.tag,
             instrument.sequence_number, instrument.control_logic ?? null, instrument.range_min ?? null,
             instrument.range_max ?? null, instrument.unit ?? null, instrument.calibration_required === true,
             instrument.calibration_interval_days ?? null, instrument.calibration_procedure ?? null,
             instrument.datasheet_reference ?? null, instrument.product_master_id ?? null,
            JSON.stringify(instrument.definition_snapshot || {}), JSON.stringify(instrument.product_snapshot || null),
             instrument.created_by ?? null, instrument.updated_by ?? null, instrument.created_at ?? null, instrument.updated_at ?? null],
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

// ─── UV Selection ──────────────────────────────────────────────────────────────

// ─── Thermal Selection ─────────────────────────────────────────────────────────

function thermalSelectionDuty(item: any) {
  const results = item?.calculation?.results || item?.result_snapshot?.results || {};
  const net = Number(results.net_total_load_kw);
  if (!Number.isFinite(net) || net === 0) return null;
  const duty = net > 0 ? 'Cooling' : 'Heating';
  const required = duty === 'Cooling'
    ? Number(results.margin_adjusted_cooling_kw)
    : Number(results.margin_adjusted_steady_state_heating_kw ?? results.margin_adjusted_heating_kw);
  return Number.isFinite(required) && required > 0
    ? { duty, required_capacity_kw: required, net_total_load_kw: net }
    : null;
}

function thermalSelectionStream(system: any, stream: any) {
  const resolvedLoops = resolveLoopFlows(
    system,
    system?.design_flow_m3h,
    system?.source_flows_m3h || {},
  );
  const loop = resolvedLoops.find(item => item.loop_number === Number(stream.parent_loop_number));
  const percentage = stream.flow_pct == null ? null : Number(stream.flow_pct);
  const flow = loop?.flow_m3h != null && Number.isFinite(percentage)
    ? Number(loop.flow_m3h) * percentage / 100
    : null;
  return {
    id: stream.id,
    parent_loop_number: Number(stream.parent_loop_number),
    name: stream.name,
    preset: stream.preset,
    flow_pct: percentage,
    flow_m3h: flow != null && Number.isFinite(flow) ? Number(flow.toFixed(3)) : null,
    loop_flow_m3h: loop?.flow_m3h ?? null,
    loop_flow_available: loop?.flow_m3h != null,
    notes: stream.notes || null,
  };
}

function thermalProductDto(row: any) {
  return {
    id: row.id,
    product_master_id: row.product_master_id,
    product_code: row.product_code,
    product_name: row.product_name,
    model: row.model,
    manufacturer: row.manufacturer,
    standard_status: row.standard_status,
    product_category: row.product_category,
    thermal_capacity_kw: row.thermal_capacity_kw == null ? null : Number(row.thermal_capacity_kw),
    duty: row.duty || null,
    primary_fluid: row.primary_fluid || null,
    secondary_fluid: row.secondary_fluid || null,
    flow_rate_m3h: row.flow_rate_m3h == null ? null : Number(row.flow_rate_m3h),
    pressure_rating_bar: row.pressure_rating_bar == null ? null : Number(row.pressure_rating_bar),
    efficiency_pct: row.efficiency_pct == null ? null : Number(row.efficiency_pct),
    primary_inlet_dn_mm: row.primary_inlet_dn_mm == null ? null : Number(row.primary_inlet_dn_mm),
    primary_outlet_dn_mm: row.primary_outlet_dn_mm == null ? null : Number(row.primary_outlet_dn_mm),
    secondary_inlet_dn_mm: row.secondary_inlet_dn_mm == null ? null : Number(row.secondary_inlet_dn_mm),
    secondary_outlet_dn_mm: row.secondary_outlet_dn_mm == null ? null : Number(row.secondary_outlet_dn_mm),
    flow_switch_status: row.flow_switch_status || null,
    notes: row.notes || null,
  };
}

async function loadThermalSelectionContext(bookId: string, systemId: string, frozen = false) {
  let context: any;
  if (frozen) {
    const book = (await query(
      'SELECT status, review_snapshot, release_snapshot FROM design_books WHERE id=$1',
      [bookId],
    )).rows[0];
    context = book?.status === 'Released'
      ? book.release_snapshot
      : book?.review_snapshot;
  } else {
    context = await loadReleaseContext(bookId, query, false, true);
  }
  if (!context) return null;
  const system = (context.systems || []).find((item: any) => item.id === systemId);
  if (!system) return null;
  const thermalCalculation = (context.thermal_calculations || [])
    .find((item: any) => item.system_id === systemId);
  const saved = (context.thermal_selections || [])
    .find((item: any) => item.system_id === systemId) || null;
  const duty = thermalSelectionDuty(thermalCalculation);
  const sideStreams = (system.side_streams || [])
    .filter((stream: any) => stream.preset === 'Thermal')
    .map((stream: any) => thermalSelectionStream(system, stream));
  return { context, system, thermalCalculation, saved, duty, sideStreams };
}

export const thermalSelectionTestUtils = {
  thermalSelectionDuty,
  thermalSelectionStream,
  thermalProductDto,
};

router.get('/design-books/:id/thermal-selection/:systemId', async (req: AuthRequest, res: Response) => {
  const bookId = routeParam(req.params.id);
  const systemId = routeParam(req.params.systemId);
  const bookResult = await query('SELECT id, status FROM design_books WHERE id=$1', [bookId]);
  if (!bookResult.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book not found' } });
  const frozen = !isDesignBookContentEditable(bookResult.rows[0].status);
  const loaded = await loadThermalSelectionContext(bookId, systemId, frozen);
  if (!loaded) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System does not belong to this Design Book project' } });

  const products = frozen
    ? []
    : (await query(
      `SELECT pm.id, pm.product_code, pm.product_name, pm.model, pm.manufacturer,
              pm.standard_status, pm.product_category, pt.*
         FROM product_masters pm
         JOIN product_thermal pt ON pt.product_master_id=pm.id
        WHERE LOWER(BTRIM(pm.product_category))='thermal'
          AND LOWER(BTRIM(pm.standard_status))='active'
          AND pt.thermal_capacity_kw > 0
        ORDER BY pt.thermal_capacity_kw, pm.product_code`,
    )).rows.map(thermalProductDto);
  const savedProduct = loaded.saved?.product_snapshot || null;
  const savedSideStream = loaded.saved?.input_snapshot?.side_stream || null;
  const savedDto = loaded.saved ? {
    ...loaded.saved,
    required_capacity_kw: Number(loaded.saved.required_capacity_kw),
    plate_flow_m3h: Number(loaded.saved.plate_flow_m3h),
    product_snapshot: savedProduct,
    side_stream: savedSideStream,
  } : null;
  res.json({
    duty: loaded.duty,
    thermal_calculation: loaded.thermalCalculation?.calculation || null,
    thermal_status: loaded.thermalCalculation?.status || 'Not configured',
    thermal_freshness: loaded.thermalCalculation?.freshness || 'unsaved',
    side_streams: loaded.sideStreams,
    products,
    saved: savedDto,
    frozen,
  });
});

router.post(
  '/design-books/:id/thermal-selection/:systemId',
  requireRole('admin', 'engineer'),
  requireModuleManage('design_books'),
  async (req: AuthRequest, res: Response) => {
    const bookId = routeParam(req.params.id);
    const systemId = routeParam(req.params.systemId);
    if (!await ensureBookEditable(bookId, res)) return;
    const loaded = await loadThermalSelectionContext(bookId, systemId, false);
    if (!loaded) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System does not belong to this Design Book project' } });
    const thermal = loaded.thermalCalculation;
    if (!thermal?.calculation || thermal.status !== 'Ready' || thermal.freshness !== 'fresh'
      || thermal.calculation.is_stale === true) {
      return res.status(409).json({
        error: { code: 'THERMAL_CALCULATION_NOT_READY', message: 'Save a current Ready Thermal calculation before selecting a plate.' },
      });
    }
    const duty = loaded.duty;
    if (!duty) {
      return res.status(409).json({
        error: { code: 'THERMAL_DUTY_UNAVAILABLE', message: 'The active Thermal duty is unavailable or has no positive required capacity.' },
      });
    }
    const productId = String(req.body?.product_master_id || '');
    const sideStreamId = String(req.body?.side_stream_id || '');
    const stream = loaded.sideStreams.find((item: any) => item.id === sideStreamId);
    if (!stream) {
      return res.status(400).json({ error: { code: 'INVALID_THERMAL_STREAM', message: 'Select a Thermal side stream from the current Flow Route.' } });
    }
    if (stream.flow_m3h == null || stream.flow_m3h <= 0) {
      return res.status(409).json({ error: { code: 'THERMAL_STREAM_FLOW_UNAVAILABLE', message: 'The selected Thermal side stream does not have a resolved positive flow. Review Flow Route allocations first.' } });
    }
    const productResult = await query(
      `SELECT pm.id, pm.product_code, pm.product_name, pm.model, pm.manufacturer,
              pm.standard_status, pm.product_category, pt.*
         FROM product_masters pm
         JOIN product_thermal pt ON pt.product_master_id=pm.id
        WHERE pm.id=$1
          AND LOWER(BTRIM(pm.product_category))='thermal'
          AND LOWER(BTRIM(pm.standard_status))='active'
          AND pt.thermal_capacity_kw > 0`,
      [productId],
    );
    const product = productResult.rows[0];
    if (!product) {
      return res.status(400).json({ error: { code: 'INELIGIBLE_THERMAL_PRODUCT', message: 'The selected Thermal Product Master record is not active or has no positive capacity.' } });
    }
    const productDto = thermalProductDto(product);
    const productDuty = String(productDto.duty || '').trim().toLowerCase();
    if (productDuty && productDuty !== duty.duty.toLowerCase()) {
      return res.status(400).json({ error: { code: 'THERMAL_DUTY_MISMATCH', message: `This product is marked for ${productDto.duty}, not ${duty.duty}.` } });
    }
    if (Number(productDto.thermal_capacity_kw) < duty.required_capacity_kw) {
      return res.status(400).json({ error: { code: 'THERMAL_CAPACITY_INSUFFICIENT', message: `The selected product capacity (${Number(productDto.thermal_capacity_kw).toFixed(2)} kW) is below the required ${duty.required_capacity_kw.toFixed(2)} kW.` } });
    }
    const inputSnapshot = {
      thermal_calculation_id: thermal.saved?.id || null,
      thermal_calculation_version: thermal.calculation.calculation_version || null,
      thermal_source_fingerprint: thermal.calculation.source_fingerprint || thermal.source_fingerprint || null,
      duty: duty.duty,
      required_capacity_kw: duty.required_capacity_kw,
      net_total_load_kw: duty.net_total_load_kw,
      side_stream: stream,
    };
    const resultSnapshot = {
      capacity_kw: productDto.thermal_capacity_kw,
      capacity_margin_kw: Number(productDto.thermal_capacity_kw) - duty.required_capacity_kw,
      flow_m3h: stream.flow_m3h,
      product: productDto,
    };
    const saved = await query(
      `INSERT INTO design_book_thermal_selections
         (design_book_id, system_id, product_master_id, side_stream_id,
          required_capacity_kw, plate_flow_m3h, duty, input_snapshot,
          product_snapshot, result_snapshot, freshness, calculated_by, calculated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,'fresh',$11,NOW())
       ON CONFLICT (design_book_id, system_id) DO UPDATE
         SET product_master_id=$3, side_stream_id=$4, required_capacity_kw=$5,
             plate_flow_m3h=$6, duty=$7, input_snapshot=$8::jsonb,
             product_snapshot=$9::jsonb, result_snapshot=$10::jsonb,
             freshness='fresh', calculated_by=$11, calculated_at=NOW(), updated_at=NOW()
       RETURNING *`,
      [bookId, systemId, productId, sideStreamId, duty.required_capacity_kw, stream.flow_m3h,
        duty.duty, JSON.stringify(inputSnapshot), JSON.stringify(productDto),
        JSON.stringify(resultSnapshot), req.user!.id],
    );
    await logAudit(req.user!.id, 'design_book_thermal', bookId, 'SELECT', {
      summary: `Thermal plate selection saved for system ${systemId}`,
      system_id: systemId,
      product_master_id: productId,
      side_stream_id: sideStreamId,
      duty: duty.duty,
      required_capacity_kw: duty.required_capacity_kw,
      plate_flow_m3h: stream.flow_m3h,
    });
    res.json({ saved: saved.rows[0], product: productDto, side_stream: stream, duty });
  },
);

router.get(
  '/design-books/:id/uv/:systemId',
  async (req: AuthRequest, res: Response) => {
    const bookId = routeParam(req.params.id);
    const systemId = routeParam(req.params.systemId);
    // Verify book exists and system belongs to the same project.
    const book = await query(
      `SELECT db.id, db.status FROM design_books db
        JOIN systems s ON s.project_id=db.project_id
       WHERE db.id=$1 AND s.id=$2`,
      [bookId, systemId],
    );
    if (!book.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design book or system not found' } });

    // Load UV side streams for this system (with revision details joined)
    const streamsResult = await query(
      `SELECT s.*,
              r.id AS rev_id, r.revision_number, r.status AS rev_status,
              pm.lamp_count, pm.power_kw * 1000 AS lamp_power_w, r.effective_reactor_volume_l,
              r.irradiance_85t_mw_cm2, r.irradiance_95t_mw_cm2,
              r.compatibility, r.arrangement, r.source_evidence, r.source_basis,
              r.approved_per_lamp_flow_exception_m3h, r.notes AS rev_notes,
              pm.id AS product_master_id, pm.product_code, pm.product_name, pm.manufacturer,
              pm.primary_material_code AS material_code, pm.power_kw AS rated_power_kw
         FROM system_flow_side_streams s
         LEFT JOIN uv_engineering_revisions r ON r.id=s.uv_revision_id
         LEFT JOIN uv_engineering_catalogs c ON c.id=r.catalog_id
         LEFT JOIN product_masters pm ON pm.id=c.product_master_id
        WHERE s.system_id=$1 AND s.preset='UV'
        ORDER BY s.parent_loop_number, s.sort_order, s.created_at, s.id`,
      [systemId],
    );

    // Load approved selectable revisions for the product picker
    const selectableResult = await query(
      `SELECT c.id AS catalog_id, r.id AS revision_id, r.revision_number,
              pm.lamp_count, pm.power_kw * 1000 AS lamp_power_w, r.effective_reactor_volume_l,
              r.irradiance_85t_mw_cm2, r.irradiance_95t_mw_cm2,
              r.source_evidence, r.source_basis,
              r.approved_per_lamp_flow_exception_m3h, r.notes,
              pm.id AS product_master_id, pm.product_code, pm.product_name, pm.manufacturer,
              pm.primary_material_code AS material_code, pm.power_kw AS rated_power_kw,
              pm.status AS pim_status
         FROM uv_engineering_catalogs c
         JOIN product_masters pm ON pm.id=c.product_master_id
         JOIN product_families pf ON pf.id=pm.product_family_id
         JOIN LATERAL (
           SELECT * FROM uv_engineering_revisions
           WHERE catalog_id=c.id AND status='Approved'
           ORDER BY revision_number DESC LIMIT 1
         ) r ON true
        WHERE c.needs_review=false AND pm.status='Active' AND pf.product_family_code='PFM-UV'
          AND NULLIF(BTRIM(pm.product_code),'') IS NOT NULL
          AND NULLIF(BTRIM(pm.product_name),'') IS NOT NULL
          AND NULLIF(BTRIM(pm.primary_material_code),'') IS NOT NULL
          AND pm.power_kw > 0 AND pm.lamp_count > 0 AND r.effective_reactor_volume_l > 0
          AND r.irradiance_85t_mw_cm2 > 0 AND r.irradiance_95t_mw_cm2 > 0
          AND r.source_basis='AAT Foundations' AND r.source_basis_verified=true
          AND EXISTS (SELECT 1 FROM material_water_compatibility mwc
                      WHERE mwc.material_code=pm.primary_material_code AND mwc.allowed=true)
        ORDER BY pm.product_code`,
    );

    // Load saved selection
    const savedResult = await query(
      'SELECT * FROM design_book_uv_selections WHERE design_book_id=$1 AND system_id=$2',
      [bookId, systemId],
    );

    res.json({
      streams: streamsResult.rows.map(row => ({
        id: row.id,
        parent_loop_number: Number(row.parent_loop_number),
        name: row.name,
        preset: row.preset,
        flow_pct: row.flow_pct != null ? Number(row.flow_pct) : null,
        notes: row.notes,
        sort_order: Number(row.sort_order),
        uv_revision_id: row.uv_revision_id,
        uv_unit_quantity: row.uv_unit_quantity != null ? Number(row.uv_unit_quantity) : null,
        uvt_basis: row.uvt_basis || '85T',
        uv_revision: row.rev_id ? {
          id: row.rev_id,
          revision_number: Number(row.revision_number),
          status: row.rev_status,
          lamp_count: Number(row.lamp_count),
          lamp_power_w: Number(row.lamp_power_w),
          effective_reactor_volume_l: Number(row.effective_reactor_volume_l),
          irradiance_85t_mw_cm2: Number(row.irradiance_85t_mw_cm2),
          irradiance_95t_mw_cm2: Number(row.irradiance_95t_mw_cm2),
          compatibility: row.compatibility,
          arrangement: row.arrangement,
          source_evidence: row.source_evidence,
          source_basis: row.source_basis,
          approved_per_lamp_flow_exception_m3h: row.approved_per_lamp_flow_exception_m3h != null
            ? Number(row.approved_per_lamp_flow_exception_m3h) : null,
          notes: row.rev_notes,
          product_code: row.product_code,
          product_name: row.product_name,
          manufacturer: row.manufacturer,
          product_master_id: row.product_master_id,
          material_code: row.material_code,
          rated_power_kw: row.rated_power_kw != null ? Number(row.rated_power_kw) : null,
        } : null,
      })),
      selectable_revisions: selectableResult.rows.map(row => ({
        catalog_id: row.catalog_id,
        revision_id: row.revision_id,
        revision_number: Number(row.revision_number),
        lamp_count: Number(row.lamp_count),
        lamp_power_w: Number(row.lamp_power_w),
        effective_reactor_volume_l: Number(row.effective_reactor_volume_l),
        irradiance_85t_mw_cm2: Number(row.irradiance_85t_mw_cm2),
        irradiance_95t_mw_cm2: Number(row.irradiance_95t_mw_cm2),
        compatibility: row.compatibility,
        arrangement: row.arrangement,
        source_evidence: row.source_evidence,
        source_basis: row.source_basis,
        approved_per_lamp_flow_exception_m3h: row.approved_per_lamp_flow_exception_m3h != null
          ? Number(row.approved_per_lamp_flow_exception_m3h) : null,
        notes: row.notes,
        product_code: row.product_code,
        product_name: row.product_name,
        manufacturer: row.manufacturer,
        product_master_id: row.product_master_id,
        material_code: row.material_code,
        rated_power_kw: row.rated_power_kw != null ? Number(row.rated_power_kw) : null,
        pim_status: row.pim_status,
      })),
      saved: savedResult.rows[0] ? {
        id: savedResult.rows[0].id,
        target_fluence_mj_cm2: Number(savedResult.rows[0].target_fluence_mj_cm2),
        calculation_version: savedResult.rows[0].calculation_version,
        freshness: savedResult.rows[0].freshness,
        calculated_at: savedResult.rows[0].calculated_at,
        result_snapshot: savedResult.rows[0].result_snapshot,
        input_snapshot: savedResult.rows[0].input_snapshot,
      } : null,
    });
  },
);

router.post(
  '/design-books/:id/uv/:systemId',
  requireRole('admin', 'engineer'),
  requireModuleManage('design_books'),
  async (req: AuthRequest, res: Response) => {
    const bookId = routeParam(req.params.id);
    const systemId = routeParam(req.params.systemId);
    // Verify book is editable and system belongs to the same project as the book.
    if (!await ensureBookEditable(bookId, res)) return;
    const ownershipCheck = await query(
      `SELECT s.id FROM systems s
        JOIN design_books db ON db.project_id=s.project_id
       WHERE db.id=$1 AND s.id=$2`,
      [bookId, systemId],
    );
    if (!ownershipCheck.rows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System does not belong to this Design Book\'s project.' } });
    }

    const rawTarget = req.body.target_fluence_mj_cm2;
    const targetFluence = rawTarget != null && rawTarget !== '' ? Number(rawTarget) : 50.0;
    if (!Number.isFinite(targetFluence) || targetFluence <= 0 || targetFluence > 10000) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'Target fluence must be a positive number (mJ/cm²).' },
      });
    }

    // Load system and its UV side streams with flow calculations
    const systemResult = await query(
      `SELECT s.*,
              s.calculation_inputs->>'design_flow_source' AS design_flow_source,
              s.loop1_flow_pct, s.loop2_flow_pct, s.loop3_flow_pct
         FROM systems s
        WHERE s.id=$1`,
      [systemId],
    );
    if (!systemResult.rows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System not found' } });
    }
    const system = systemResult.rows[0];
    if (isRetiredSystem(system)) {
      return res.status(409).json({ error: systemLifecycleError(system) });
    }

    // Resolve the same authoritative system flow shown by the Flow Route.
    // Exhibit hydraulic rows store inputs, not a result JSON column, so derive
    // current exhibit flows through the shared engineering calculator.
    const linksResult = await query(
      `SELECT sel.*, e.exhibit_code
         FROM system_exhibit_links sel
         LEFT JOIN exhibits e ON e.id=sel.exhibit_id
        WHERE sel.system_id=$1`,
      [systemId],
    );
    const links = linksResult.rows;
    const exhibitIds = links.map(link => link.exhibit_id).filter(Boolean);
    const [exhibitsResult, tanksResult, hydraulicsResult, substrateResult] = exhibitIds.length
      ? await Promise.all([
        query('SELECT * FROM exhibits WHERE id=ANY($1::uuid[])', [exhibitIds]),
        query('SELECT * FROM tanks WHERE exhibit_id=ANY($1::uuid[])', [exhibitIds]),
        query('SELECT * FROM design_book_exhibit_hydraulics WHERE design_book_id=$1 AND exhibit_id=ANY($2::uuid[])', [bookId, exhibitIds]),
        query('SELECT * FROM design_book_exhibit_substrate WHERE design_book_id=$1 AND exhibit_id=ANY($2::uuid[])', [bookId, exhibitIds]),
      ])
      : [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];
    const calculatedAt = new Date().toISOString();
    const exhibitCalculations = exhibitsResult.rows.map(exhibit => calculateExhibitHydraulics(
      exhibit,
      tanksResult.rows.filter(tank => tank.exhibit_id === exhibit.id),
      hydraulicsResult.rows.find(record => record.exhibit_id === exhibit.id),
      substrateResult.rows.find(record => record.exhibit_id === exhibit.id),
      calculatedAt,
    ));
    const systemCalculation = calculateSystemEngineering(
      system,
      links,
      exhibitCalculations,
      null,
      calculatedAt,
    );
    const designFlowSource = systemCalculation.inputs.design_flow_source || 'linked_exhibits';
    const designFlowM3h = systemCalculation.results.design_flow_m3h != null
      ? Number(systemCalculation.results.design_flow_m3h)
      : null;

    // Load UV side streams with revision details
    const streamsResult = await query(
      `SELECT s.*,
              r.id AS rev_id, r.revision_number, r.status AS rev_status,
              pm.lamp_count, pm.power_kw * 1000 AS lamp_power_w, r.effective_reactor_volume_l,
              r.irradiance_85t_mw_cm2, r.irradiance_95t_mw_cm2,
              r.compatibility, r.arrangement, r.source_evidence, r.source_basis,
              r.approved_per_lamp_flow_exception_m3h, r.notes AS rev_notes,
              pm.id AS product_master_id, pm.product_code, pm.product_name, pm.manufacturer,
              pm.primary_material_code AS material_code, pm.power_kw AS rated_power_kw,
              COALESCE(uvc.allowed, mwc.allowed) AS compatibility_allowed,
              CASE
                WHEN $2='Marine' THEN 'Seawater'
                WHEN $2='Salt Water' THEN 'Saltwater'
                WHEN $2='Brackish' THEN 'Brackish water'
                WHEN $2 IN ('Freshwater', 'Blackwater') THEN 'Freshwater'
                ELSE $2
              END AS mapped_water_type
         FROM system_flow_side_streams s
         LEFT JOIN uv_engineering_revisions r ON r.id=s.uv_revision_id
         LEFT JOIN uv_engineering_catalogs c ON c.id=r.catalog_id
         LEFT JOIN product_masters pm ON pm.id=c.product_master_id
         LEFT JOIN material_water_compatibility mwc
           ON mwc.material_code=pm.primary_material_code
          AND mwc.water_type=CASE
                WHEN $2='Marine' THEN 'Seawater'
                WHEN $2='Salt Water' THEN 'Saltwater'
                WHEN $2='Brackish' THEN 'Brackish water'
                WHEN $2 IN ('Freshwater', 'Blackwater') THEN 'Freshwater'
                ELSE $2
              END
          LEFT JOIN uv_engineering_revision_compatibility uvc
            ON uvc.revision_id=r.id
           AND uvc.water_type=CASE
                WHEN $2='Marine' THEN 'Seawater'
                WHEN $2='Salt Water' THEN 'Saltwater'
                WHEN $2='Brackish' THEN 'Brackish water'
                WHEN $2 IN ('Freshwater', 'Blackwater') THEN 'Freshwater'
                ELSE $2
              END
        WHERE s.system_id=$1 AND s.preset='UV'
        ORDER BY s.parent_loop_number, s.sort_order, s.created_at, s.id`,
      [systemId, system.water_type],
    );

    // Build UVStreamInput objects
    const uvSourceFlows: Record<string, number | null> = {};
    if (links.length > 0) {
      const aggregateUvSourceFlow = (resultKey: string): number | null => {
        const linkedCalculations = links.map(link => exhibitCalculations.find(
          calculation => calculation.inputs.exhibit_id === link.exhibit_id,
        ));
        if (linkedCalculations.some(calculation =>
          !calculation || calculation.status !== 'valid' ||
          calculation.is_stale === true || calculation.freshness === 'stale' ||
          calculation.results?.[resultKey] == null,
        )) return null;
        return linkedCalculations.reduce(
          (total, calculation) => total + Number(calculation!.results[resultKey]),
          0,
        );
      };
      uvSourceFlows['Surface Skim'] = aggregateUvSourceFlow('surface_skim_flow_m3h');
      uvSourceFlows['Bottom Drain'] = aggregateUvSourceFlow('bottom_drain_flow_m3h');
      uvSourceFlows['Both Integrated'] = aggregateUvSourceFlow('total_return_flow_m3h');
    }
    const resolvedLoopFlows = resolveLoopFlows(system, designFlowM3h, uvSourceFlows);
    const streamInputs: UVStreamInput[] = streamsResult.rows.map(row => {
      const loopFlowM3h = row.parent_loop_number != null
        ? resolvedLoopFlows[Number(row.parent_loop_number) - 1]?.flow_m3h ?? null : null;
      const streamPct = row.flow_pct != null ? Number(row.flow_pct) : null;
      const streamFlowM3h = loopFlowM3h != null && streamPct != null
        ? loopFlowM3h * streamPct / 100
        : null;

      return {
        side_stream_id: String(row.id),
        side_stream_name: row.name,
        flow_m3h: streamFlowM3h,
        uv_unit_quantity: row.uv_unit_quantity != null ? Number(row.uv_unit_quantity) : null,
        uvt_basis: row.uvt_basis === '95T' ? '95T' : '85T',
        uvt_85t_pct: null,
        uvt_95t_pct: null,
        uv_revision: row.rev_id ? {
          id: row.rev_id,
          catalog_id: row.catalog_id,
          revision_number: Number(row.revision_number),
          status: row.rev_status,
          lamp_count: Number(row.lamp_count),
          lamp_power_w: Number(row.lamp_power_w),
          effective_reactor_volume_l: Number(row.effective_reactor_volume_l),
          irradiance_85t_mw_cm2: Number(row.irradiance_85t_mw_cm2),
          irradiance_95t_mw_cm2: Number(row.irradiance_95t_mw_cm2),
          compatibility: row.compatibility,
          arrangement: row.arrangement,
          source_evidence: row.source_evidence,
          source_basis: row.source_basis,
          approved_per_lamp_flow_exception_m3h: row.approved_per_lamp_flow_exception_m3h != null
            ? Number(row.approved_per_lamp_flow_exception_m3h) : null,
          notes: row.rev_notes,
          product_code: row.product_code,
          product_name: row.product_name,
          manufacturer: row.manufacturer,
          product_master_id: row.product_master_id,
          material_code: row.material_code,
          rated_power_kw: row.rated_power_kw != null ? Number(row.rated_power_kw) : null,
          compatibility_allowed: row.compatibility_allowed,
          compatibility_reason: row.mapped_water_type == null
            ? `No governed material compatibility mapping exists for ${row.material_code || 'the selected material'} and ${system.water_type || 'the system water type'}.`
            : row.compatibility_allowed === false
              ? `${row.material_code} is not approved for ${system.water_type}.`
              : null,
        } : null,
      };
    });

    if (streamInputs.length === 0) {
      return res.status(400).json({
        error: {
          code: 'NO_UV_STREAMS',
          message: 'This system has no UV side streams. Add a UV side stream in the Flow Route tab first.',
        },
      });
    }

    // Validate every assigned revision is still Approved and from an eligible catalog.
    const assignedRevisionIds = streamInputs
      .map(s => s.uv_revision?.id)
      .filter(Boolean) as string[];
    if (assignedRevisionIds.length > 0) {
      const eligibleCheck = await query(
        `SELECT r.id FROM uv_engineering_revisions r
          JOIN uv_engineering_catalogs c ON c.id=r.catalog_id
          JOIN product_masters pm ON pm.id=c.product_master_id
          JOIN product_families pf ON pf.id=pm.product_family_id
         WHERE r.id = ANY($1::uuid[]) AND r.status='Approved'
           AND c.needs_review=false AND pm.status='Active'
           AND pf.product_family_code='PFM-UV'
           AND NULLIF(BTRIM(pm.product_code),'') IS NOT NULL
           AND NULLIF(BTRIM(pm.product_name),'') IS NOT NULL
           AND NULLIF(BTRIM(pm.primary_material_code),'') IS NOT NULL
           AND pm.power_kw > 0 AND pm.lamp_count > 0
           AND r.effective_reactor_volume_l > 0
           AND r.irradiance_85t_mw_cm2 > 0 AND r.irradiance_95t_mw_cm2 > 0
           AND r.source_basis='AAT Foundations' AND r.source_basis_verified=true`,
        [assignedRevisionIds],
      );
      const eligibleIds = new Set(eligibleCheck.rows.map(r => r.id));
      const ineligible = assignedRevisionIds.filter(id => !eligibleIds.has(id));
      if (ineligible.length > 0) {
        return res.status(400).json({
          error: {
            code: 'INELIGIBLE_UV_REVISION',
            message: 'One or more assigned UV revisions are no longer Approved or eligible. Please re-select products before calculating.',
          },
        });
      }
    }

    const result = calculateUVSelection(streamInputs, targetFluence, system.water_type);
    const inputSnapshot = {
      target_fluence_mj_cm2: targetFluence,
      design_flow_m3h: designFlowM3h,
      water_type: system.water_type,
      streams: streamInputs.map(s => ({
        side_stream_id: s.side_stream_id,
        side_stream_name: s.side_stream_name,
        flow_m3h: s.flow_m3h,
        uv_revision_id: s.uv_revision?.id || null,
        uv_unit_quantity: s.uv_unit_quantity,
        uvt_basis: s.uvt_basis || '85T',
        product_master_id: s.uv_revision?.product_master_id || null,
        product_code: s.uv_revision?.product_code || null,
        product_name: s.uv_revision?.product_name || null,
        manufacturer: s.uv_revision?.manufacturer || null,
        material_code: s.uv_revision?.material_code || null,
        rated_power_kw: s.uv_revision?.rated_power_kw ?? null,
        lamp_count: s.uv_revision?.lamp_count ?? null,
        engineering_revision_number: s.uv_revision?.revision_number ?? null,
        effective_reactor_volume_l: s.uv_revision?.effective_reactor_volume_l ?? null,
        irradiance_85t_mw_cm2: s.uv_revision?.irradiance_85t_mw_cm2 ?? null,
        irradiance_95t_mw_cm2: s.uv_revision?.irradiance_95t_mw_cm2 ?? null,
        source_basis: s.uv_revision?.source_basis || null,
        source_evidence: s.uv_revision?.source_evidence || null,
        compatibility_allowed: s.uv_revision?.compatibility_allowed ?? null,
      })),
    };

    await query(
      `INSERT INTO design_book_uv_selections
         (design_book_id, system_id, target_fluence_mj_cm2, input_snapshot, result_snapshot,
          calculation_version, freshness, calculated_by, calculated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,'fresh',$7,NOW())
       ON CONFLICT (design_book_id, system_id) DO UPDATE
         SET target_fluence_mj_cm2=$3, input_snapshot=$4::jsonb, result_snapshot=$5::jsonb,
             calculation_version=$6, freshness='fresh', calculated_by=$7,
             calculated_at=NOW(), updated_at=NOW()`,
      [bookId, systemId, targetFluence, JSON.stringify(inputSnapshot),
        JSON.stringify(result), UV_CALCULATION_VERSION, req.user!.id],
    );

    await logAudit(req.user!.id, 'design_book_uv', bookId, 'CALCULATE', {
      summary: `UV fluence selection calculated for system ${systemId}`,
      system_id: systemId,
      target_fluence_mj_cm2: targetFluence,
      overall_status: result.overall_status,
      stream_count: streamInputs.length,
    });

    const saved = await query(
      'SELECT * FROM design_book_uv_selections WHERE design_book_id=$1 AND system_id=$2',
      [bookId, systemId],
    );
    res.json({ result, saved: saved.rows[0] });
  },
);

export default router;
