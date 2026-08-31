import { Router, Response } from 'express';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage, requireRole } from '../middleware/auth';
import pool, { query } from '../db';
import { calculateExhibitHydraulics } from '../lib/aquariumCalculations';
import {
  calculateBiologicalMediaPreview,
  normalizeBiologicalMediaInput,
} from '../lib/biologicalMediaCalculations';

const router = Router();
router.use(authenticate, requireModuleAccess('design_books'));
type DbRunner = (sql: string, params?: any[]) => Promise<{ rows: any[] }>;

const PROFILE_STATUSES = ['Draft', 'In Review', 'Approved', 'Retired'];
export const TAN_COEFFICIENT_UNIT = 'kg TAN-N/kg feed protein';
const MEDIA_SIZING_FIELDS = [
  'overall_vtr_g_tan_n_m3_d', 'default_safety_factor', 'minimum_media_m3',
  'module_increment_m3', 'media_fill_fraction', 'operating_min_ph', 'operating_max_ph',
  'operating_min_tan_mg_n_l', 'operating_max_tan_mg_n_l', 'operating_min_do_mg_l',
  'operating_max_do_mg_l', 'operating_min_flow_m3_h', 'operating_max_flow_m3_h',
];
const routeParam = (value: string | string[]) => Array.isArray(value) ? value[0] : value;

function text(value: unknown): string | null {
  if (value == null) return null;
  const result = String(value).trim();
  return result || null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function arrayOfText(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
}

function rangeError(min: number | null, max: number | null, label: string): string | null {
  return min != null && max != null && min > max
    ? `${label} minimum cannot exceed maximum.`
    : null;
}

function previewStatusLabel(status: string) {
  return status === 'VALID' ? 'Valid'
    : status === 'VALID_WITH_WARNINGS' ? 'Valid with Warnings'
      : status === 'BLOCKED' ? 'Blocked' : 'Incomplete';
}

function jsonCopy<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function biologicalMediaInputFromCase(record: any, context: any) {
  return normalizeBiologicalMediaInput({
    biomass: {
      method: record?.biomass_method,
      water_volume_m3: context?.total_operating_volume_m3,
      stocking_density_kg_m3: record?.stocking_density_kg_m3,
      species: record?.species_rows || [],
    },
    feeding: {
      mode: record?.feeding_mode || 'GLOBAL',
      feed_rate_pct_biomass_day: record?.feed_rate_pct_biomass_day,
      protein_pct: record?.protein_pct,
      manual_daily_feed_kg_d: record?.manual_daily_feed_kg_d,
      tan_generation_profile_revision_id: record?.tan_generation_profile_revision_id,
    },
    water: {
      water_type: context?.system_water_type,
      temperature_c: record?.temperature_c,
      ph: record?.ph,
      salinity_ppt: record?.salinity_ppt,
      tan_target_mg_n_l: record?.max_tan_mg_n_l,
      do_in_mg_l: record?.do_in_mg_l,
      do_out_min_mg_l: record?.do_out_min_mg_l,
      alkalinity_mg_l_caco3: record?.alkalinity_mg_l_caco3,
      system_flow_m3_h: record?.actual_flow_m3_h,
    },
    filter: {
      reactor_type: record?.reactor_type,
      media_profile_revision_id: record?.media_profile_revision_id,
      safety_factor: record?.safety_factor,
    },
  });
}

function getPath(value: any, path: string): any {
  return path.split('.').reduce((current, key) => current == null ? undefined : current[key], value);
}

function setPath(value: any, path: string, replacement: any): boolean {
  const parts = path.split('.');
  let current = value;
  for (const part of parts.slice(0, -1)) {
    if (!current || typeof current !== 'object') return false;
    current = current[part];
  }
  if (!current || typeof current !== 'object') return false;
  current[parts[parts.length - 1]] = replacement;
  return true;
}

function runIsStale(run: any, currentInput: any, context: any) {
  if (!run) return false;
  const savedContext = run.linked_volume_context_snapshot || {};
  const sourceInput = jsonCopy(run.normalized_input_snapshot || {});
  for (const override of (run.overrides_snapshot || [])) {
    if (override?.field_path && Object.prototype.hasOwnProperty.call(override, 'original_value')) {
      setPath(sourceInput, override.field_path, override.original_value);
    }
  }
  return canonicalJson(sourceInput) !== canonicalJson(currentInput)
    || numberOrNull(savedContext.total_operating_volume_m3) !== numberOrNull(context?.total_operating_volume_m3)
    || String(savedContext.system_water_type || '').toUpperCase()
      !== String(context?.system_water_type || '').toUpperCase();
}

function runPresentation(run: any, currentInput: any, context: any) {
  return {
    ...run,
    is_stale: runIsStale(run, currentInput, context),
    profile_revision: run.media_profile_snapshot?.revision ?? null,
    tan_profile_revision: run.tan_profile_snapshot?.revision ?? null,
  };
}

async function loadBiologicalMediaCase(systemId: string, designBookId: string, runner: DbRunner = query) {
  const result = await runner(
    `SELECT c.*, mp.profile_code AS media_profile_code, mp.profile_name AS media_profile_name,
            mp.revision AS media_profile_revision, mp.status AS media_profile_status,
            tp.profile_code AS tan_profile_code, tp.profile_name AS tan_profile_name,
            tp.revision AS tan_profile_revision, tp.status AS tan_profile_status
     FROM lss_biological_media_cases c
     LEFT JOIN lss_biological_media_profiles mp ON mp.id=c.media_profile_revision_id
     LEFT JOIN lss_tan_generation_profiles tp ON tp.id=c.tan_generation_profile_revision_id
     WHERE c.system_id=$1 AND c.design_book_id=$2`,
    [systemId, designBookId],
  );
  const record = result.rows[0] || null;
  if (record) {
    const speciesResult = await runner(
      `SELECT s.*, c.common_name AS catalog_common_name, c.scientific_name AS catalog_scientific_name,
              c.active AS catalog_active
       FROM lss_biological_media_species s
       LEFT JOIN aquarium_species_catalog c ON c.id=s.species_profile_id
       WHERE s.case_id=$1 ORDER BY s.sort_order, s.id`,
      [record.id],
    );
    record.species_rows = speciesResult.rows;
  }
  return record;
}

async function loadRunHistory(caseId: string | null, currentInput: any, context: any) {
  if (!caseId) return [];
  const result = await query(
    `SELECT r.*, u.first_name || ' ' || u.last_name AS created_by_name,
            au.first_name || ' ' || au.last_name AS approved_by_name,
            wu.first_name || ' ' || wu.last_name AS warning_acknowledged_by_name
     FROM lss_biological_media_runs r
     LEFT JOIN users u ON u.id=r.created_by
     LEFT JOIN users au ON au.id=r.approved_by
     LEFT JOIN users wu ON wu.id=r.warning_acknowledged_by
     WHERE r.case_id=$1 ORDER BY r.run_number DESC`,
    [caseId],
  );
  return result.rows.map(run => runPresentation(run, currentInput, context));
}

function changedSnapshotValues(left: any, right: any) {
  const leftObject = left && typeof left === 'object' ? left : {};
  const rightObject = right && typeof right === 'object' ? right : {};
  const keys = [...new Set([...Object.keys(leftObject), ...Object.keys(rightObject)])].sort();
  return keys.filter(key => canonicalJson(leftObject[key]) !== canonicalJson(rightObject[key]))
    .map(key => ({ field: key, before: leftObject[key] ?? null, after: rightObject[key] ?? null }));
}

export function compareBiologicalMediaRuns(left: any, right: any) {
  return {
    left: {
      id: left.id,
      run_number: left.run_number,
      status: left.status,
      executed_at: left.executed_at,
      approved_at: left.approved_at,
      approved_by_name: left.approved_by_name || null,
    },
    right: {
      id: right.id,
      run_number: right.run_number,
      status: right.status,
      executed_at: right.executed_at,
      approved_at: right.approved_at,
      approved_by_name: right.approved_by_name || null,
    },
    changes: {
      inputs: changedSnapshotValues(left.normalized_input_snapshot, right.normalized_input_snapshot),
      linked_context: changedSnapshotValues(left.linked_volume_context_snapshot, right.linked_volume_context_snapshot),
      media_profile: changedSnapshotValues(left.media_profile_snapshot, right.media_profile_snapshot),
      tan_profile: changedSnapshotValues(left.tan_profile_snapshot, right.tan_profile_snapshot),
      results: changedSnapshotValues(left.result_snapshot, right.result_snapshot),
      assumptions: canonicalJson(left.assumptions) === canonicalJson(right.assumptions) ? [] : [{
        field: 'assumptions', before: left.assumptions, after: right.assumptions,
      }],
      warnings: canonicalJson(left.messages) === canonicalJson(right.messages) ? [] : [{
        field: 'messages', before: left.messages, after: right.messages,
      }],
      overrides: canonicalJson(left.overrides_snapshot) === canonicalJson(right.overrides_snapshot) ? [] : [{
        field: 'overrides', before: left.overrides_snapshot, after: right.overrides_snapshot,
      }],
      approval: changedSnapshotValues({
        status: left.status,
        warning_acknowledged: left.warning_acknowledged,
        approved_at: left.approved_at,
        approved_by: left.approved_by,
        review_notes: left.review_notes,
      }, {
        status: right.status,
        warning_acknowledged: right.warning_acknowledged,
        approved_at: right.approved_at,
        approved_by: right.approved_by,
        review_notes: right.review_notes,
      }),
    },
  };
}

export function renderBiologicalMediaRunSummary(run: any) {
  const result = run.result_snapshot || {};
  const lines = [
    `Biological Media Calculation Run ${run.run_number}`,
    `Run ID: ${run.id}`,
    `Status: ${run.status}`,
    `Calculation status: ${run.calculation_status}`,
    `Executed: ${run.executed_at}`,
    `Engine release: ${run.engine_version}`,
    `Author: ${run.created_by_name || run.author_snapshot?.email || run.created_by || 'Unknown'}`,
    '',
    'Calculation basis',
    'TAN nitrogen is the sizing mass basis. NH3 molecular-mass values are display-only.',
    `Linked effective volume: ${run.linked_volume_context_snapshot?.total_operating_volume_m3 ?? '—'} m3`,
    `Water type: ${run.linked_volume_context_snapshot?.system_water_type || '—'}`,
    '',
    'Controlled profile evidence',
    `Media profile: ${run.media_profile_snapshot?.profile_code || '—'} r${run.media_profile_snapshot?.revision ?? '—'}`,
    `Media evidence: ${run.media_profile_snapshot?.evidence_reference || '—'}`,
    `TAN profile: ${run.tan_profile_snapshot?.profile_code || '—'} r${run.tan_profile_snapshot?.revision ?? '—'}`,
    `TAN evidence: ${run.tan_profile_snapshot?.evidence_reference || '—'}`,
    '',
    'Result values',
    `Design biomass: ${result.biomass?.design_biomass_kg ?? '—'} kg`,
    `Daily feed: ${result.feeding?.total_feed_kg_d ?? '—'} kg/day`,
    `TAN nitrogen load: ${result.feeding?.tan_load_g_n_d ?? '—'} g N/day`,
    `Required media: ${result.media?.required_media_l ?? '—'} L`,
    `Installed media: ${result.media?.installed_media_l ?? '—'} L`,
    '',
    'Assumptions',
    ...(run.assumptions || []).map((assumption: string) => `- ${assumption}`),
    '',
    'Messages and warnings',
    ...(run.messages || []).length
      ? (run.messages || []).map((message: any) => `- ${message.severity} ${message.code}: ${message.message}`)
      : ['- None'],
    '',
    'Engineering overrides',
    ...(run.overrides_snapshot || []).length
      ? (run.overrides_snapshot || []).map((override: any) =>
        `- ${override.field_path}: ${JSON.stringify(override.original_value)} -> ${JSON.stringify(override.replacement_value)}; ${override.reason}; authorized by ${override.authorized_by || '—'} (${override.authorization_role || '—'}) at ${override.authorized_at || '—'}; reference ${override.authorization_reference || '—'}`)
      : ['- None'],
    '',
    'Approval',
    `Warning acknowledgement: ${run.warning_acknowledged ? 'Recorded' : 'Not required / not recorded'}`,
    `Approved by: ${run.approved_by_name || run.approved_by || '—'}`,
    `Approved at: ${run.approved_at || '—'}`,
    `Review notes: ${run.review_notes || '—'}`,
  ];
  return `${lines.join('\n')}\n`;
}

export function isBiologicalMediaPreviewStale(record: any, context: any) {
  if (!record?.preview_result) return false;
  if (record.preview_stale) return true;
  const snapshot = record.preview_input_snapshot;
  if (!snapshot?.biomass || !snapshot?.water) return true;
  const savedVolume = numberOrNull(snapshot.biomass.water_volume_m3);
  const currentVolume = numberOrNull(context?.total_operating_volume_m3);
  if (savedVolume == null || currentVolume == null || Math.abs(savedVolume - currentVolume) > 1e-9) return true;
  const savedWaterType = String(snapshot.water.water_type || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const currentWaterType = String(context?.system_water_type || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return !savedWaterType || savedWaterType !== currentWaterType;
}

export function validateMediaProfile(body: any, approving = body.status === 'Approved'): string[] {
  const errors: string[] = [];
  if (!text(body.profile_code)) errors.push('Profile code is required.');
  if (!text(body.profile_name)) errors.push('Profile name is required.');
  if (!arrayOfText(body.water_types).length) errors.push('Select at least one compatible water type.');
  if (!arrayOfText(body.reactor_types).length) errors.push('Select at least one compatible reactor type.');
  if (!text(body.capacity_model)) errors.push('Capacity model metadata is required.');
  if (!text(body.capacity_model_version)) errors.push('Capacity model version is required.');
  if (!text(body.capacity_basis_unit)) errors.push('Capacity basis unit is required.');
  const ranges: Array<[string, unknown, unknown, string]> = [
    ['operating_min_temperature_c', body.operating_min_temperature_c, body.operating_max_temperature_c, 'Operating temperature'],
    ['operating_min_salinity_ppt', body.operating_min_salinity_ppt, body.operating_max_salinity_ppt, 'Operating salinity'],
    ['media_min_depth_mm', body.media_min_depth_mm, body.media_max_depth_mm, 'Media depth'],
  ];
  for (const [, minValue, maxValue, label] of ranges) {
    const min = numberOrNull(minValue);
    const max = numberOrNull(maxValue);
    if ((minValue != null && minValue !== '' && min == null) || (maxValue != null && maxValue !== '' && max == null)) {
      errors.push(`${label} bounds must be numbers.`);
    } else {
      const error = rangeError(min, max, label);
      if (error) errors.push(error);
      if (min != null && min < 0 || max != null && max < 0) errors.push(`${label} bounds cannot be negative.`);
    }
  }
  const voidFraction = numberOrNull(body.media_void_fraction);
  if (voidFraction != null && (voidFraction < 0 || voidFraction > 1)) errors.push('Media void fraction must be between 0 and 1.');
  if (body.media_bulk_density_kg_m3 != null && body.media_bulk_density_kg_m3 !== ''
      && (numberOrNull(body.media_bulk_density_kg_m3) == null || Number(body.media_bulk_density_kg_m3) < 0)) {
    errors.push('Media bulk density must be a non-negative number.');
  }
  if (approving && !text(body.evidence_reference)) errors.push('Evidence reference is required.');
  if (body.is_provisional && !text(body.provisional_label)) errors.push('Provisional profiles require an explicit provisional label.');
  for (const [field, label, maximum] of [
    ['overall_vtr_g_tan_n_m3_d', 'Overall VTR', null],
    ['default_safety_factor', 'Default safety factor', null],
    ['module_increment_m3', 'Module increment', null],
    ['media_fill_fraction', 'Media fill fraction', 1],
  ] as Array<[string, string, number | null]>) {
    if (body[field] != null && body[field] !== '') {
      const value = numberOrNull(body[field]);
      if (value == null || value <= 0 || maximum != null && value > maximum) {
        errors.push(`${label} must be greater than zero${maximum != null ? ` and no greater than ${maximum}` : ''}.`);
      }
    }
  }
  if (body.minimum_media_m3 != null && body.minimum_media_m3 !== ''
      && (numberOrNull(body.minimum_media_m3) == null || Number(body.minimum_media_m3) < 0)) {
    errors.push('Minimum media volume must be a non-negative number.');
  }
  for (const [minField, maxField, label] of [
    ['operating_min_ph', 'operating_max_ph', 'Operating pH'],
    ['operating_min_tan_mg_n_l', 'operating_max_tan_mg_n_l', 'Operating TAN'],
    ['operating_min_do_mg_l', 'operating_max_do_mg_l', 'Operating dissolved oxygen'],
    ['operating_min_flow_m3_h', 'operating_max_flow_m3_h', 'Operating flow'],
  ]) {
    const min = numberOrNull(body[minField]);
    const max = numberOrNull(body[maxField]);
    const error = rangeError(min, max, label);
    if (error) errors.push(error);
  }
  if (approving) {
    for (const [field, label] of [
      ['operating_min_temperature_c', 'Minimum operating temperature'],
      ['operating_max_temperature_c', 'Maximum operating temperature'],
      ['operating_min_salinity_ppt', 'Minimum operating salinity'],
      ['operating_max_salinity_ppt', 'Maximum operating salinity'],
      ['media_min_depth_mm', 'Minimum media depth'],
      ['media_max_depth_mm', 'Maximum media depth'],
      ['media_void_fraction', 'Media void fraction'],
      ['media_bulk_density_kg_m3', 'Media bulk density'],
    ]) {
      if (numberOrNull(body[field]) == null) errors.push(`${label} is required before approval.`);
    }
    if (String(body.capacity_model || '').toUpperCase().replace(/[\s-]+/g, '_') === 'OVERALL_VTR') {
      for (const [field, label] of [
        ['overall_vtr_g_tan_n_m3_d', 'Overall VTR'],
        ['default_safety_factor', 'Default safety factor'],
        ['minimum_media_m3', 'Minimum media volume'],
        ['module_increment_m3', 'Module increment'],
        ['media_fill_fraction', 'Media fill fraction'],
        ['operating_min_ph', 'Minimum operating pH'],
        ['operating_max_ph', 'Maximum operating pH'],
        ['operating_min_tan_mg_n_l', 'Minimum operating TAN'],
        ['operating_max_tan_mg_n_l', 'Maximum operating TAN'],
      ]) {
        if (numberOrNull(body[field]) == null) errors.push(`${label} is required before approval.`);
      }
    }
  }
  return errors;
}

export function validateTanProfile(body: any, approving = body.status == null ? true : body.status === 'Approved'): string[] {
  const errors: string[] = [];
  if (!text(body.profile_code)) errors.push('Profile code is required.');
  if (!text(body.profile_name)) errors.push('Profile name is required.');
  const coefficient = numberOrNull(body.coefficient);
  if (coefficient == null || coefficient <= 0) errors.push('Coefficient must be greater than zero.');
  if (!text(body.coefficient_unit)) errors.push('Coefficient unit is required.');
  else if (text(body.coefficient_unit) !== TAN_COEFFICIENT_UNIT) {
    errors.push(`Coefficient unit must be ${TAN_COEFFICIENT_UNIT}.`);
  }
  if (!text(body.scope_type)) errors.push('Scope type is required.');
  const min = numberOrNull(body.scope_min);
  const max = numberOrNull(body.scope_max);
  if ((body.scope_min != null && body.scope_min !== '' && min == null) || (body.scope_max != null && body.scope_max !== '' && max == null)) {
    errors.push('Scope range bounds must be numbers.');
  } else {
    const error = rangeError(min, max, 'Scope range');
    if (error) errors.push(error);
    if (min != null && min < 0 || max != null && max < 0) errors.push('Scope range cannot be negative.');
  }
  if (approving && !text(body.evidence_reference)) errors.push('Evidence reference is required.');
  return errors;
}

function databaseProfileError(error: any) {
  if (error?.code === '23505') return { code: 'DUPLICATE_REVISION', message: 'That profile code and revision already exists.' };
  if (error?.code === '23514') return { code: 'VALIDATION', message: 'The profile contains a contradictory value or range.' };
  if (error?.code === '55000') return { code: 'IMMUTABLE_REVISION', message: error.message };
  return null;
}

async function nextRevision(table: string, code: string) {
  const result = await query(`SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM ${table} WHERE profile_code=$1`, [code]);
  return Number(result.rows[0].revision);
}

async function profileRevision(table: string, id: string) {
  const result = await query(`SELECT * FROM ${table} WHERE id=$1`, [id]);
  return result.rows[0] || null;
}

async function requireApprovedProfile(table: string, id: string | null, label: string) {
  if (!id) return null;
  const result = await query(`SELECT * FROM ${table} WHERE id=$1`, [id]);
  const profile = result.rows[0];
  if (!profile) return `${label} was not found.`;
  if (profile.status !== 'Approved') return `${label} must be an approved revision; ${profile.status.toLowerCase()} revisions cannot be used here.`;
  if (table === 'lss_tan_generation_profiles' && profile.coefficient_unit !== TAN_COEFFICIENT_UNIT) {
    return `${label} uses an unsupported coefficient unit; approved references must use ${TAN_COEFFICIENT_UNIT}.`;
  }
  return null;
}

async function linkedVolumeContext(systemId: string, designBookId: string, runner: DbRunner = query) {
  const book = await runner('SELECT id, project_id FROM design_books WHERE id=$1', [designBookId]);
  const system = await runner('SELECT id, project_id, water_type FROM systems WHERE id=$1', [systemId]);
  if (!book.rows[0] || !system.rows[0]) return { error: { code: 'NOT_FOUND', message: 'System or Design Book not found.' } };
  if (book.rows[0].project_id !== system.rows[0].project_id) {
    return { error: { code: 'CONTEXT_MISMATCH', message: 'The Design Book and LSS system must belong to the same project.' } };
  }
  const links = await runner(
    `SELECT sel.exhibit_id, e.exhibit_code, e.exhibit_name, e.water_type
     FROM system_exhibit_links sel JOIN exhibits e ON e.id=sel.exhibit_id
     WHERE sel.system_id=$1 ORDER BY sel.sort_order, e.exhibit_code`,
    [systemId],
  );
  const exhibitIds = links.rows.map((link: any) => link.exhibit_id);
  if (!exhibitIds.length) {
    return {
      system_water_type: system.rows[0].water_type,
      linked_exhibits: [],
      total_operating_volume_m3: null,
      status: 'blocked',
      reasons: ['No linked exhibits are configured for this system.'],
    };
  }
  const [exhibits, tanks, hydraulics, substrate] = await Promise.all([
    runner('SELECT * FROM exhibits WHERE id = ANY($1::uuid[])', [exhibitIds]),
    runner(
      `SELECT t.*, t.operating_volume_m3 AS project_operating_volume_m3,
              pm.operating_volume_m3 AS pim_operating_volume_m3,
              COALESCE(t.shape_type, pm.shape_type) AS eff_shape,
              COALESCE(t.length_mm, pm.length_mm) AS eff_length_mm,
              COALESCE(t.width_mm, pm.width_mm) AS eff_width_mm,
              COALESCE(t.height_mm, pm.height_mm) AS eff_height_mm,
              COALESCE(t.design_water_level_mm, pm.design_water_level_mm) AS eff_water_level_mm
       FROM tanks t LEFT JOIN product_masters pm ON pm.id=t.product_master_id
       WHERE t.exhibit_id = ANY($1::uuid[])`,
      [exhibitIds],
    ),
    runner('SELECT * FROM design_book_exhibit_hydraulics WHERE design_book_id=$1 AND exhibit_id = ANY($2::uuid[])', [designBookId, exhibitIds]),
    runner('SELECT * FROM design_book_exhibit_substrate WHERE design_book_id=$1 AND exhibit_id = ANY($2::uuid[])', [designBookId, exhibitIds]),
  ]);
  const linkedExhibits = links.rows.map((link: any) => {
    const exhibit = exhibits.rows.find((item: any) => item.id === link.exhibit_id);
    const exhibitTanks = tanks.rows.filter((item: any) => item.exhibit_id === link.exhibit_id);
    const calculation = calculateExhibitHydraulics(
      exhibit,
      exhibitTanks,
      hydraulics.rows.find((item: any) => item.exhibit_id === link.exhibit_id),
      substrate.rows.find((item: any) => item.exhibit_id === link.exhibit_id),
    );
    return {
      exhibit_id: link.exhibit_id,
      exhibit_code: link.exhibit_code,
      exhibit_name: link.exhibit_name,
      water_type: exhibit?.water_type || link.water_type,
      operating_volume_m3: Number(calculation.results.operating_volume_m3) > 0
        ? calculation.results.operating_volume_m3
        : null,
    };
  });
  const usable = linkedExhibits.every(item => item.operating_volume_m3 != null && item.operating_volume_m3 > 0);
  return {
    system_water_type: system.rows[0].water_type,
    linked_exhibits: linkedExhibits,
    total_operating_volume_m3: usable
      ? linkedExhibits.reduce((sum, item) => sum + Number(item.operating_volume_m3), 0)
      : null,
    status: usable ? 'ready' : 'blocked',
    reasons: usable ? [] : ['Every linked exhibit needs a positive current operating water volume.'],
  };
}

async function caseResponse(systemId: string, designBookId: string) {
  const bookPackageResult = await query(
    'SELECT status, review_snapshot, release_snapshot FROM design_books WHERE id=$1',
    [designBookId],
  );
  const bookPackage = bookPackageResult.rows[0];
  if (!bookPackage) return { error: { code: 'NOT_FOUND', message: 'Design Book not found.' } };
  const snapshot = bookPackage.status === 'Released'
    ? bookPackage.release_snapshot
    : ['For Review', 'Approved'].includes(bookPackage.status)
      ? bookPackage.review_snapshot
      : null;
  if (snapshot) {
    const snapshotSystem = (snapshot.systems || []).find((item: any) => item.id === systemId);
    if (!snapshotSystem) return { error: { code: 'NOT_FOUND', message: 'System is not included in this frozen Design Book package.' } };
    const snapshotLinks = (snapshot.system_links || []).filter((item: any) => item.system_id === systemId);
    const snapshotCalculations = snapshot.engineering_calculations?.exhibits || [];
    const linkedExhibits = snapshotLinks.map((link: any) => {
      const exhibit = (snapshot.exhibits || []).find((item: any) => item.id === link.exhibit_id);
      const calculation = snapshotCalculations.find((item: any) => item.inputs?.exhibit_id === link.exhibit_id);
      const volume = Number(calculation?.results?.operating_volume_m3);
      return {
        exhibit_id: link.exhibit_id,
        exhibit_code: link.exhibit_code || exhibit?.exhibit_code,
        exhibit_name: exhibit?.exhibit_name,
        water_type: exhibit?.water_type,
        operating_volume_m3: Number.isFinite(volume) && volume > 0 ? volume : null,
      };
    });
    const usable = linkedExhibits.length > 0
      && linkedExhibits.every((item: any) => item.operating_volume_m3 != null);
    const context = {
      system_water_type: snapshotSystem.water_type,
      linked_exhibits: linkedExhibits,
      total_operating_volume_m3: usable
        ? linkedExhibits.reduce((sum: number, item: any) => sum + Number(item.operating_volume_m3), 0)
        : null,
      status: usable ? 'ready' : 'blocked',
      reasons: usable ? [] : ['The frozen package has no complete linked-exhibit operating water-volume context.'],
      source: 'frozen_design_book_package',
    };
    const record = (snapshot.biological_media_cases || []).find((item: any) =>
      item.system_id === systemId && item.design_book_id === designBookId) || null;
    if (record) record.species_rows = record.species_rows || record.species || [];
    const missingInputs: string[] = [];
    if (!record) missingInputs.push('Create the biological media draft.');
    if (record && !record.reactor_type) missingInputs.push('Choose a reactor type.');
    if (record && !record.media_profile_revision_id) missingInputs.push('Select an approved media profile revision.');
    if (record && !record.tan_generation_profile_revision_id) missingInputs.push('Select an approved TAN generation profile revision.');
    const previewStale = isBiologicalMediaPreviewStale(record, context);
    const readinessStatus = !usable ? 'Blocked' : missingInputs.length ? 'Incomplete' : previewStale ? 'Draft' : record?.status || 'Draft';
    const currentInput = record ? biologicalMediaInputFromCase(record, context) : null;
    const runs = ((snapshot.biological_media_runs || []).filter((run: any) =>
      run.system_id === systemId && run.design_book_id === designBookId
    )).map((run: any) => runPresentation(run, currentInput, context));
    return {
      case: record,
      preview: record?.preview_result ? { ...record.preview_result, is_stale: previewStale } : null,
      context,
      readiness_status: readinessStatus,
      input_completeness: { complete: missingInputs.length === 0 && usable, missing: missingInputs },
      runs,
      latest_run: runs[0] || null,
    };
  }
  const [caseResult, context] = await Promise.all([
    query(
      `SELECT c.*, mp.profile_code AS media_profile_code, mp.profile_name AS media_profile_name,
              mp.revision AS media_profile_revision, mp.status AS media_profile_status,
              tp.profile_code AS tan_profile_code, tp.profile_name AS tan_profile_name,
              tp.revision AS tan_profile_revision, tp.status AS tan_profile_status
       FROM lss_biological_media_cases c
       LEFT JOIN lss_biological_media_profiles mp ON mp.id=c.media_profile_revision_id
       LEFT JOIN lss_tan_generation_profiles tp ON tp.id=c.tan_generation_profile_revision_id
       WHERE c.system_id=$1 AND c.design_book_id=$2`,
      [systemId, designBookId],
    ),
    linkedVolumeContext(systemId, designBookId),
  ]);
  if ('error' in context) return context;
  const record = caseResult.rows[0] || null;
  if (record) {
    const speciesResult = await query(
      `SELECT s.*, c.common_name AS catalog_common_name, c.scientific_name AS catalog_scientific_name,
              c.active AS catalog_active
       FROM lss_biological_media_species s
       LEFT JOIN aquarium_species_catalog c ON c.id=s.species_profile_id
       WHERE s.case_id=$1 ORDER BY s.sort_order, s.id`,
      [record.id],
    );
    record.species_rows = speciesResult.rows;
  }
  const missingInputs: string[] = [];
  if (!record) missingInputs.push('Create the biological media draft.');
  if (record && !record.reactor_type) missingInputs.push('Choose a reactor type.');
  if (record && !record.media_profile_revision_id) missingInputs.push('Select an approved media profile revision.');
  if (record && !record.tan_generation_profile_revision_id) missingInputs.push('Select an approved TAN generation profile revision.');
  const blocked = context.status === 'blocked';
  const previewStale = isBiologicalMediaPreviewStale(record, context);
  const readinessStatus = blocked ? 'Blocked' : missingInputs.length ? 'Incomplete' : previewStale ? 'Draft' : record?.status || 'Draft';
  const currentInput = record ? biologicalMediaInputFromCase(record, context) : null;
  const runs = await loadRunHistory(record?.id || null, currentInput, context);
  const latestRun = runs[0] || null;
  return {
    case: record,
    preview: record?.preview_result ? { ...record.preview_result, is_stale: previewStale } : null,
    context,
    readiness_status: readinessStatus,
    input_completeness: { complete: missingInputs.length === 0 && !blocked, missing: missingInputs },
    runs,
    latest_run: latestRun,
  };
}

router.get('/systems/:id/biological-media', async (req: AuthRequest, res: Response) => {
  const designBookId = text(req.query.design_book_id);
  if (!designBookId) return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
  const result = await caseResponse(routeParam(req.params.id), designBookId);
  if ('error' in result) return res.status(result.error.code === 'NOT_FOUND' ? 404 : 409).json({ error: result.error });
  res.json(result);
});

router.put('/systems/:id/biological-media', requireModuleManage('design_books'), requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const designBookId = text(req.body.design_book_id);
  if (!designBookId) return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
  const editable = await query(
    `SELECT db.status AS book_status, s.status AS system_status
     FROM design_books db JOIN systems s ON s.project_id=db.project_id
     WHERE db.id=$1 AND s.id=$2`,
    [designBookId, routeParam(req.params.id)],
  );
  if (!editable.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System or Design Book not found.' } });
  if (!['Draft', 'In Progress'].includes(editable.rows[0].book_status)
      || ['For Review', 'Approved', 'Released'].includes(editable.rows[0].system_status)) {
    return res.status(409).json({ error: { code: 'DESIGN_BOOK_NOT_EDITABLE', message: 'Biological Media drafts are read-only for frozen Design Books or reviewed systems.' } });
  }
  const reactorType = text(req.body.reactor_type);
  if (reactorType && reactorType.length > 120) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Reactor type must be 120 characters or fewer.' } });
  const mediaId = text(req.body.media_profile_revision_id);
  const tanId = text(req.body.tan_generation_profile_revision_id);
  const mediaError = await requireApprovedProfile('lss_biological_media_profiles', mediaId, 'Media profile');
  const tanError = await requireApprovedProfile('lss_tan_generation_profiles', tanId, 'TAN generation profile');
  if (mediaError || tanError) return res.status(409).json({ error: { code: 'PROFILE_NOT_APPROVED', message: mediaError || tanError } });
  const systemId = routeParam(req.params.id);
  const context = await linkedVolumeContext(systemId, designBookId);
  if ('error' in context) return res.status(context.error.code === 'NOT_FOUND' ? 404 : 409).json({ error: context.error });
  if (mediaId) {
    const selected = await profileRevision('lss_biological_media_profiles', mediaId);
    const waterCompatible = selected.water_types.includes(context.system_water_type)
      || selected.water_types.includes('Universal');
    const reactorCompatible = !reactorType || selected.reactor_types.includes(reactorType);
    if (!waterCompatible || !reactorCompatible) {
      return res.status(409).json({
        error: {
          code: 'PROFILE_INCOMPATIBLE',
          message: !waterCompatible
            ? `The selected media profile is not approved for ${context.system_water_type || 'this system water type'}.`
            : `The selected media profile is not approved for reactor type ${reactorType}.`,
        },
      });
    }
  }
  const status = context.status === 'blocked' || !reactorType || !mediaId || !tanId ? (context.status === 'blocked' ? 'Blocked' : 'Incomplete') : 'Draft';
  const contextVolume = Number(context.total_operating_volume_m3);
  try {
    const result = await query(
      `INSERT INTO lss_biological_media_cases
       (system_id, design_book_id, reactor_type, media_profile_revision_id, tan_generation_profile_revision_id, status, notes, created_by,
        biomass_method, water_volume_m3, stocking_density_kg_m3, feed_rate_pct_biomass_day, protein_pct,
        manual_daily_feed_kg_d, water_type, temperature_c, ph, salinity_ppt, max_tan_mg_n_l, do_in_mg_l,
        do_out_min_mg_l, alkalinity_mg_l_caco3, actual_flow_m3_h, safety_factor, preview_stale)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       ON CONFLICT (system_id, design_book_id) DO UPDATE SET
         reactor_type=EXCLUDED.reactor_type,
         media_profile_revision_id=EXCLUDED.media_profile_revision_id,
         tan_generation_profile_revision_id=EXCLUDED.tan_generation_profile_revision_id,
          status=EXCLUDED.status, notes=EXCLUDED.notes, biomass_method=EXCLUDED.biomass_method,
          water_volume_m3=EXCLUDED.water_volume_m3, stocking_density_kg_m3=EXCLUDED.stocking_density_kg_m3,
          feed_rate_pct_biomass_day=EXCLUDED.feed_rate_pct_biomass_day, protein_pct=EXCLUDED.protein_pct,
          manual_daily_feed_kg_d=EXCLUDED.manual_daily_feed_kg_d, water_type=EXCLUDED.water_type,
          temperature_c=EXCLUDED.temperature_c, ph=EXCLUDED.ph, salinity_ppt=EXCLUDED.salinity_ppt,
          max_tan_mg_n_l=EXCLUDED.max_tan_mg_n_l, do_in_mg_l=EXCLUDED.do_in_mg_l,
          do_out_min_mg_l=EXCLUDED.do_out_min_mg_l, alkalinity_mg_l_caco3=EXCLUDED.alkalinity_mg_l_caco3,
          actual_flow_m3_h=EXCLUDED.actual_flow_m3_h, safety_factor=EXCLUDED.safety_factor,
          preview_stale=true, updated_at=NOW()
       RETURNING *`,
      [systemId, designBookId, reactorType, mediaId, tanId, status, text(req.body.notes), req.user!.id,
        text(req.body.biomass_method), numberOrNull(req.body.water_volume_m3)
          ?? (Number.isFinite(contextVolume) && contextVolume > 0 ? contextVolume : null),
        numberOrNull(req.body.stocking_density_kg_m3), numberOrNull(req.body.feed_rate_pct_biomass_day),
        numberOrNull(req.body.protein_pct), numberOrNull(req.body.manual_daily_feed_kg_d),
        text(req.body.water_type) || context.system_water_type, numberOrNull(req.body.temperature_c),
        numberOrNull(req.body.ph), numberOrNull(req.body.salinity_ppt), numberOrNull(req.body.max_tan_mg_n_l),
        numberOrNull(req.body.do_in_mg_l), numberOrNull(req.body.do_out_min_mg_l),
        numberOrNull(req.body.alkalinity_mg_l_caco3), numberOrNull(req.body.actual_flow_m3_h),
        numberOrNull(req.body.safety_factor), true],
    );
    const caseId = result.rows[0].id;
    await query('DELETE FROM lss_biological_media_species WHERE case_id=$1', [caseId]);
    const speciesRows = Array.isArray(req.body.species_rows) ? req.body.species_rows : [];
    for (let index = 0; index < speciesRows.length; index += 1) {
      const row = speciesRows[index] || {};
      const commonName = text(row.common_name_snapshot || row.common_name || row.species_name);
      if (!commonName) continue;
      await query(
        `INSERT INTO lss_biological_media_species
         (case_id, species_profile_id, common_name_snapshot, scientific_name_snapshot, life_stage,
          quantity, design_weight_kg, entered_weight_kg, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [caseId, text(row.species_profile_id || row.catalog_species_id), commonName,
          text(row.scientific_name_snapshot || row.scientific_name), text(row.life_stage),
          numberOrNull(row.quantity), numberOrNull(row.design_weight_kg),
          numberOrNull(row.entered_weight_kg ?? row.design_weight_kg), text(row.notes), index],
      );
    }
    res.json(await caseResponse(systemId, designBookId));
  } catch (error: any) {
    const mapped = databaseProfileError(error);
    if (mapped) return res.status(mapped.code === 'IMMUTABLE_REVISION' ? 409 : 400).json({ error: mapped });
    throw error;
  }
});

router.post('/systems/:id/biological-media/preview', requireModuleManage('design_books'), requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const designBookId = text(req.body.design_book_id);
  if (!designBookId) return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
  const systemId = routeParam(req.params.id);
  const editable = await query(
    `SELECT db.status AS book_status, s.status AS system_status
     FROM design_books db JOIN systems s ON s.project_id=db.project_id
     WHERE db.id=$1 AND s.id=$2`,
    [designBookId, systemId],
  );
  if (!editable.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System or Design Book not found.' } });
  if (!['Draft', 'In Progress'].includes(editable.rows[0].book_status)
      || ['For Review', 'Approved', 'Released'].includes(editable.rows[0].system_status)) {
    return res.status(409).json({
      error: {
        code: 'DESIGN_BOOK_NOT_EDITABLE',
        message: 'Biological Media previews cannot update frozen Design Books or reviewed systems.',
      },
    });
  }
  const context = await linkedVolumeContext(systemId, designBookId);
  if ('error' in context) return res.status(context.error.code === 'NOT_FOUND' ? 404 : 409).json({ error: context.error });
  if (context.status === 'blocked') {
    const message = context.reasons.join(' ');
    return res.status(409).json({
      error: { code: 'WATER_CONTEXT_BLOCKED', message },
      status: 'BLOCKED',
      messages: [{ code: 'WATER_CONTEXT_BLOCKED', severity: 'BLOCKING', message }],
    });
  }
  const mediaId = text(req.body.media_profile_revision_id);
  const tanId = text(req.body.tan_generation_profile_revision_id);
  const [mediaResult, tanResult] = await Promise.all([
    mediaId ? query('SELECT * FROM lss_biological_media_profiles WHERE id=$1', [mediaId]) : Promise.resolve({ rows: [] }),
    tanId ? query('SELECT * FROM lss_tan_generation_profiles WHERE id=$1', [tanId]) : Promise.resolve({ rows: [] }),
  ]);
  const mediaProfile = mediaResult.rows[0] || null;
  const tanProfile = tanResult.rows[0] || null;
  const body = {
    ...req.body,
    biomass: {
      ...(req.body.biomass || {}),
      method: req.body.biomass_method || req.body.biomass?.method,
      water_volume_m3: context.total_operating_volume_m3,
      stocking_density_kg_m3: req.body.biomass?.stocking_density_kg_m3 ?? req.body.stocking_density_kg_m3,
      species: req.body.species_rows || req.body.biomass?.species || [],
    },
    feeding: {
      ...(req.body.feeding || {}),
      mode: req.body.feeding?.mode || 'GLOBAL',
      feed_rate_pct_biomass_day: req.body.feeding?.feed_rate_pct_biomass_day ?? req.body.feed_rate_pct_biomass_day,
      protein_pct: req.body.feeding?.protein_pct ?? req.body.protein_pct,
      manual_daily_feed_kg_d: req.body.feeding?.manual_daily_feed_kg_d ?? req.body.manual_daily_feed_kg_d,
      tan_generation_profile_revision_id: tanId,
    },
    water: {
      ...(req.body.water || {}),
      water_type: context.system_water_type,
      temperature_c: req.body.water?.temperature_c ?? req.body.temperature_c,
      ph: req.body.water?.ph ?? req.body.ph,
      salinity_ppt: req.body.water?.salinity_ppt ?? req.body.salinity_ppt,
      tan_target_mg_n_l: req.body.water?.tan_target_mg_n_l ?? req.body.max_tan_mg_n_l,
      do_in_mg_l: req.body.water?.do_in_mg_l ?? req.body.do_in_mg_l,
      do_out_min_mg_l: req.body.water?.do_out_min_mg_l ?? req.body.do_out_min_mg_l,
      alkalinity_mg_l_caco3: req.body.water?.alkalinity_mg_l_caco3 ?? req.body.alkalinity_mg_l_caco3,
      system_flow_m3_h: req.body.water?.system_flow_m3_h ?? req.body.actual_flow_m3_h,
    },
    filter: {
      ...(req.body.filter || {}),
      reactor_type: req.body.reactor_type || req.body.filter?.reactor_type,
      media_profile_revision_id: mediaId,
      safety_factor: req.body.safety_factor,
    },
  };
  const result = calculateBiologicalMediaPreview(body, { mediaProfile, tanProfile });
  const currentCase = await query(
    'SELECT id FROM lss_biological_media_cases WHERE system_id=$1 AND design_book_id=$2',
    [systemId, designBookId],
  );
  if (currentCase.rows[0]) {
    await query(
      `UPDATE lss_biological_media_cases SET preview_result=$1, preview_input_snapshot=$2,
       previewed_at=NOW(), preview_stale=false, status=$3, updated_at=NOW() WHERE id=$4`,
      [result, normalizeBiologicalMediaInput(body), previewStatusLabel(result.status), currentCase.rows[0].id],
    );
  }
  res.json({
    ...result,
    status_label: previewStatusLabel(result.status),
    is_preview: true,
    is_stale: false,
    profile: mediaProfile ? {
      id: mediaProfile.id,
      profile_code: mediaProfile.profile_code,
      profile_name: mediaProfile.profile_name,
      revision: mediaProfile.revision,
    } : null,
  });
});

const ENGINEERING_OVERRIDE_FIELDS = new Set([
  'biomass.stocking_density_kg_m3',
  'feeding.feed_rate_fraction_day',
  'feeding.protein_fraction',
  'feeding.manual_feed_check_kg_d',
  'water.temperature_c',
  'water.ph',
  'water.salinity_ppt',
  'water.tan_target_mg_n_l',
  'water.do_in_mg_l',
  'water.do_out_min_mg_l',
  'water.alkalinity_mg_l_caco3',
  'water.system_flow_m3_h',
  'filter.safety_factor',
]);

async function editableRunContext(systemId: string, designBookId: string, runner: DbRunner = query) {
  const result = await runner(
    `SELECT db.status AS book_status, s.status AS system_status
     FROM design_books db JOIN systems s ON s.project_id=db.project_id
     WHERE db.id=$1 AND s.id=$2`,
    [designBookId, systemId],
  );
  const row = result.rows[0];
  if (!row) return { error: { status: 404, code: 'NOT_FOUND', message: 'System or Design Book not found.' } };
  if (!['Draft', 'In Progress'].includes(row.book_status)
      || ['For Review', 'Approved', 'Released'].includes(row.system_status)) {
    return {
      error: {
        status: 409,
        code: 'DESIGN_BOOK_NOT_EDITABLE',
        message: 'Calculation runs can only be created from an editable Biological Media draft.',
      },
    };
  }
  return { row };
}

async function loadRun(systemId: string, designBookId: string, runId: string) {
  const result = await query(
    `SELECT r.*, u.first_name || ' ' || u.last_name AS created_by_name,
            au.first_name || ' ' || au.last_name AS approved_by_name,
            wu.first_name || ' ' || wu.last_name AS warning_acknowledged_by_name
     FROM lss_biological_media_runs r
     LEFT JOIN users u ON u.id=r.created_by
     LEFT JOIN users au ON au.id=r.approved_by
     LEFT JOIN users wu ON wu.id=r.warning_acknowledged_by
     WHERE r.id=$1 AND r.system_id=$2 AND r.design_book_id=$3`,
    [runId, systemId, designBookId],
  );
  return result.rows[0] || null;
}

function biologicalMediaApiError(status: number, code: string, message: string) {
  const error: any = new Error(message);
  error.httpStatus = status;
  error.apiCode = code;
  return error;
}

async function withLockedRun<T>(
  systemId: string,
  designBookId: string,
  runId: string,
  action: (client: any, run: any) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const book = await client.query('SELECT status FROM design_books WHERE id=$1 FOR UPDATE', [designBookId]);
    if (!book.rows[0]) throw biologicalMediaApiError(404, 'NOT_FOUND', 'Design Book not found.');
    if (!['Draft', 'In Progress'].includes(book.rows[0].status)) {
      throw biologicalMediaApiError(
        409,
        'DESIGN_BOOK_NOT_EDITABLE',
        'Run review actions cannot change evidence after the Design Book package has been frozen.',
      );
    }
    const result = await client.query(
      `SELECT * FROM lss_biological_media_runs
       WHERE id=$1 AND system_id=$2 AND design_book_id=$3 FOR UPDATE`,
      [runId, systemId, designBookId],
    );
    if (!result.rows[0]) throw biologicalMediaApiError(404, 'NOT_FOUND', 'Calculation run not found.');
    const output = await action(client, result.rows[0]);
    await client.query('COMMIT');
    return output;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function sendBiologicalMediaApiError(error: any, res: Response) {
  if (!error?.httpStatus) return false;
  res.status(error.httpStatus).json({ error: { code: error.apiCode, message: error.message } });
  return true;
}

router.post(
  '/systems/:id/biological-media/runs',
  requireModuleManage('design_books'),
  requireRole('admin', 'engineer'),
  async (req: AuthRequest, res: Response) => {
    const systemId = routeParam(req.params.id);
    const designBookId = text(req.body.design_book_id);
    if (!designBookId) return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
    const editable = await editableRunContext(systemId, designBookId);
    if ('error' in editable) {
      return res.status(editable.error.status).json({ error: { code: editable.error.code, message: editable.error.message } });
    }
    const context = await linkedVolumeContext(systemId, designBookId);
    if ('error' in context) return res.status(context.error.code === 'NOT_FOUND' ? 404 : 409).json({ error: context.error });
    if (context.status !== 'ready' || numberOrNull(context.total_operating_volume_m3) == null) {
      return res.status(409).json({
        error: { code: 'WATER_CONTEXT_BLOCKED', message: context.reasons.join(' ') || 'Linked effective volume is not ready.' },
      });
    }
    const record = await loadBiologicalMediaCase(systemId, designBookId);
    if (!record) {
      return res.status(409).json({ error: { code: 'DRAFT_REQUIRED', message: 'Create and save the Biological Media draft before creating a run.' } });
    }
    const baseInput = biologicalMediaInputFromCase(record, context);
    if (!record.preview_result || !record.preview_input_snapshot || !record.previewed_at) {
      return res.status(409).json({ error: { code: 'PREVIEW_REQUIRED', message: 'Calculate a current preview before creating a run.' } });
    }
    if (isBiologicalMediaPreviewStale(record, context)
        || canonicalJson(record.preview_input_snapshot) !== canonicalJson(baseInput)
        || (req.body.previewed_at && new Date(req.body.previewed_at).getTime() !== new Date(record.previewed_at).getTime())) {
      return res.status(409).json({
        error: { code: 'RUN_PREVIEW_STALE', message: 'The draft or linked context changed after the preview. Calculate a new preview before creating a run.' },
      });
    }
    const [mediaResult, tanResult] = await Promise.all([
      query('SELECT * FROM lss_biological_media_profiles WHERE id=$1', [record.media_profile_revision_id]),
      query('SELECT * FROM lss_tan_generation_profiles WHERE id=$1', [record.tan_generation_profile_revision_id]),
    ]);
    const mediaProfile = mediaResult.rows[0] || null;
    const tanProfile = tanResult.rows[0] || null;
    if (!mediaProfile || mediaProfile.status !== 'Approved' || !tanProfile || tanProfile.status !== 'Approved') {
      return res.status(409).json({
        error: { code: 'PROFILE_NOT_APPROVED', message: 'Both controlled profile revisions must still be approved when the run is executed.' },
      });
    }

    const runInput = jsonCopy(baseInput);
    const requestedOverrides = Array.isArray(req.body.overrides) ? req.body.overrides : [];
    const overrides: any[] = [];
    for (const requested of requestedOverrides) {
      const fieldPath = text(requested?.field_path);
      const reason = text(requested?.reason);
      if (!fieldPath || !ENGINEERING_OVERRIDE_FIELDS.has(fieldPath)) {
        return res.status(400).json({
          error: { code: 'INVALID_OVERRIDE', message: 'Overrides may only replace approved calculation input fields; profile revisions and historical results cannot be overridden.' },
        });
      }
      if (!reason) {
        return res.status(400).json({ error: { code: 'INVALID_OVERRIDE', message: `A reason is required for the ${fieldPath} override.` } });
      }
      if (!Object.prototype.hasOwnProperty.call(requested, 'replacement_value')
          || !setPath(runInput, fieldPath, requested.replacement_value)) {
        return res.status(400).json({ error: { code: 'INVALID_OVERRIDE', message: `The ${fieldPath} replacement value is missing or invalid.` } });
      }
      overrides.push({
        field_path: fieldPath,
        original_value: getPath(baseInput, fieldPath) ?? null,
        replacement_value: requested.replacement_value,
        reason,
        authorization_reference: text(requested.authorization_reference),
        authorized_by: req.user!.id,
        authorization_role: req.user!.role,
        authorized_at: new Date().toISOString(),
      });
    }
    const normalizedRunInput = normalizeBiologicalMediaInput(runInput);
    const result = calculateBiologicalMediaPreview(normalizedRunInput, { mediaProfile, tanProfile });
    if (result.status === 'BLOCKED') {
      return res.status(409).json({
        error: { code: 'RUN_BLOCKED', message: 'The server revalidation found blocking items. Update the draft and calculate a new preview.' },
        status: result.status,
        messages: result.messages,
      });
    }
    const creationWarningAcknowledgement = text(req.body.warning_acknowledgement);
    const warningAcknowledged = result.status === 'VALID_WITH_WARNINGS'
      && req.body.acknowledge_warnings === true && !!creationWarningAcknowledgement;
    const authorSnapshot = {
      id: req.user!.id,
      email: req.user!.email,
      role: req.user!.role,
    };
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query('SELECT id FROM lss_biological_media_cases WHERE id=$1 FOR UPDATE', [record.id]);
      const runner = client.query.bind(client) as DbRunner;
      const [lockedEditable, lockedContext, lockedRecord, lockedMediaResult, lockedTanResult] = await Promise.all([
        editableRunContext(systemId, designBookId, runner),
        linkedVolumeContext(systemId, designBookId, runner),
        loadBiologicalMediaCase(systemId, designBookId, runner),
        runner('SELECT * FROM lss_biological_media_profiles WHERE id=$1', [record.media_profile_revision_id]),
        runner('SELECT * FROM lss_tan_generation_profiles WHERE id=$1', [record.tan_generation_profile_revision_id]),
      ]);
      const lockedMediaProfile = lockedMediaResult.rows[0];
      const lockedTanProfile = lockedTanResult.rows[0];
      const lockedInput = lockedRecord && !('error' in lockedContext)
        ? biologicalMediaInputFromCase(lockedRecord, lockedContext)
        : null;
      if ('error' in lockedEditable || 'error' in lockedContext || !lockedRecord
          || canonicalJson(lockedInput) !== canonicalJson(baseInput)
          || canonicalJson(lockedRecord.preview_input_snapshot) !== canonicalJson(baseInput)
          || isBiologicalMediaPreviewStale(lockedRecord, lockedContext)
          || lockedMediaProfile?.status !== 'Approved' || lockedTanProfile?.status !== 'Approved'
          || canonicalJson(lockedMediaProfile) !== canonicalJson(mediaProfile)
          || canonicalJson(lockedTanProfile) !== canonicalJson(tanProfile)) {
        const staleError: any = new Error('The draft or linked context changed while the run was being created.');
        staleError.httpStatus = 409;
        staleError.apiCode = 'RUN_PREVIEW_STALE';
        throw staleError;
      }
      const numberResult = await client.query(
        'SELECT COALESCE(MAX(run_number), 0) + 1 AS run_number FROM lss_biological_media_runs WHERE case_id=$1',
        [record.id],
      );
      const runNumber = Number(numberResult.rows[0].run_number);
      const inserted = await client.query(
        `INSERT INTO lss_biological_media_runs
         (case_id, system_id, design_book_id, run_number, status, calculation_status,
          warning_acknowledged, warning_acknowledged_by, warning_acknowledged_at,
          normalized_input_snapshot, linked_volume_context_snapshot, species_snapshot,
          feeding_snapshot, media_profile_snapshot, tan_profile_snapshot, engine_version,
          assumptions, messages, result_snapshot, overrides_snapshot, author_snapshot,
          created_by, executed_at)
         VALUES ($1,$2,$3,$4,'Pending Review',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
         RETURNING *`,
        [
          record.id, systemId, designBookId, runNumber, result.status,
          warningAcknowledged, warningAcknowledged ? req.user!.id : null,
          warningAcknowledged ? new Date().toISOString() : null,
          normalizedRunInput, jsonCopy(context), normalizedRunInput.biomass.species,
          result.feeding, jsonCopy(mediaProfile), jsonCopy(tanProfile), result.engine_version,
          result.assumptions, result.messages, result, overrides, authorSnapshot, req.user!.id,
        ],
      );
      await client.query(
        `INSERT INTO lss_biological_media_run_audit (run_id, action, actor_id, details)
         VALUES ($1,'RUN_CREATED',$2,$3)`,
        [inserted.rows[0].id, req.user!.id, {
          calculation_status: result.status,
          engine_version: result.engine_version,
          warning_acknowledged: warningAcknowledged,
          warning_acknowledgement: creationWarningAcknowledgement,
          override_count: overrides.length,
        }],
      );
      await client.query('COMMIT');
      return res.status(201).json(runPresentation(inserted.rows[0], baseInput, context));
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') {
        return res.status(409).json({ error: { code: 'RUN_CONFLICT', message: 'Another run was created at the same time. Refresh and try again.' } });
      }
      if (error?.code === '40001') {
        return res.status(409).json({ error: { code: 'RUN_CONFLICT', message: 'The draft changed while the run was being created. Refresh and try again.' } });
      }
      if (error?.httpStatus) {
        return res.status(error.httpStatus).json({ error: { code: error.apiCode, message: error.message } });
      }
      throw error;
    } finally {
      client.release();
    }
  },
);

router.get('/systems/:id/biological-media/runs', async (req: AuthRequest, res: Response) => {
  const systemId = routeParam(req.params.id);
  const designBookId = text(req.query.design_book_id);
  if (!designBookId) return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
  const response = await caseResponse(systemId, designBookId);
  if ('error' in response) return res.status(response.error.code === 'NOT_FOUND' ? 404 : 409).json({ error: response.error });
  res.json({ items: (response as any).runs || [] });
});

router.get('/systems/:id/biological-media/runs/compare', async (req: AuthRequest, res: Response) => {
  const systemId = routeParam(req.params.id);
  const designBookId = text(req.query.design_book_id);
  const leftId = text(req.query.left_id);
  const rightId = text(req.query.right_id);
  if (!designBookId || !leftId || !rightId) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id, left_id, and right_id are required.' } });
  }
  const [left, right] = await Promise.all([
    loadRun(systemId, designBookId, leftId),
    loadRun(systemId, designBookId, rightId),
  ]);
  if (!left || !right) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'One or both calculation runs were not found.' } });
  res.json(compareBiologicalMediaRuns(left, right));
});

router.get('/systems/:id/biological-media/runs/:runId', async (req: AuthRequest, res: Response) => {
  const designBookId = text(req.query.design_book_id);
  if (!designBookId) return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
  const run = await loadRun(routeParam(req.params.id), designBookId, routeParam(req.params.runId));
  if (!run) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Calculation run not found.' } });
  const audit = await query(
    `SELECT a.*, u.first_name || ' ' || u.last_name AS actor_name
     FROM lss_biological_media_run_audit a LEFT JOIN users u ON u.id=a.actor_id
     WHERE a.run_id=$1 ORDER BY a.created_at, a.id`,
    [run.id],
  );
  res.json({ ...run, audit: audit.rows });
});

router.post(
  '/systems/:id/biological-media/runs/:runId/acknowledge-warnings',
  requireModuleManage('design_books'),
  requireRole('admin', 'engineer'),
  async (req: AuthRequest, res: Response) => {
    const designBookId = text(req.body.design_book_id);
    if (!designBookId) return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
    const editable = await editableRunContext(routeParam(req.params.id), designBookId);
    if ('error' in editable) {
      return res.status(editable.error.status).json({ error: { code: editable.error.code, message: editable.error.message } });
    }
    const note = text(req.body.acknowledgement);
    try {
      const updated = await withLockedRun(
        routeParam(req.params.id), designBookId, routeParam(req.params.runId),
        async (client, run) => {
          if (run.status !== 'Pending Review') {
            throw biologicalMediaApiError(409, 'RUN_IMMUTABLE', 'Only a pending run can receive a warning acknowledgement.');
          }
          if (run.calculation_status === 'VALID_WITH_WARNINGS' && !note) {
            throw biologicalMediaApiError(400, 'WARNING_ACKNOWLEDGEMENT_REQUIRED', 'Record an explicit warning acknowledgement.');
          }
          const result = await client.query(
            `UPDATE lss_biological_media_runs
             SET warning_acknowledged=true, warning_acknowledged_by=$1, warning_acknowledged_at=NOW(),
                 review_notes=COALESCE($2, review_notes), updated_at=NOW()
             WHERE id=$3 AND status='Pending Review' RETURNING *`,
            [req.user!.id, note, run.id],
          );
          if (!result.rows[0]) throw biologicalMediaApiError(409, 'INVALID_RUN_STATE', 'The run changed before acknowledgement.');
          await client.query(
            `INSERT INTO lss_biological_media_run_audit (run_id, action, actor_id, details)
             VALUES ($1,'WARNINGS_ACKNOWLEDGED',$2,$3)`,
            [run.id, req.user!.id, { acknowledgement: note, warning_codes: (run.messages || [])
              .filter((message: any) => message.severity === 'WARNING').map((message: any) => message.code) }],
          );
          return result.rows[0];
        },
      );
      res.json(updated);
    } catch (error) {
      if (!sendBiologicalMediaApiError(error, res)) throw error;
    }
  },
);

router.post(
  '/systems/:id/biological-media/runs/:runId/approve',
  requireModuleManage('design_books'),
  requireRole('admin', 'engineer'),
  async (req: AuthRequest, res: Response) => {
    const designBookId = text(req.body.design_book_id);
    if (!designBookId) return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
    const editable = await editableRunContext(routeParam(req.params.id), designBookId);
    if ('error' in editable) {
      return res.status(editable.error.status).json({ error: { code: editable.error.code, message: editable.error.message } });
    }
    const acknowledgement = text(req.body.warning_acknowledgement);
    const reviewNotes = text(req.body.review_notes);
    try {
      const updated = await withLockedRun(
        routeParam(req.params.id), designBookId, routeParam(req.params.runId),
        async (client, run) => {
          if (run.status !== 'Pending Review') {
            throw biologicalMediaApiError(409, 'INVALID_RUN_STATE', 'Only a pending calculation run can be approved.');
          }
          if (run.calculation_status === 'BLOCKED') {
            throw biologicalMediaApiError(409, 'RUN_BLOCKED', 'Blocked calculation runs cannot be approved.');
          }
          const acknowledgeNow = run.calculation_status === 'VALID_WITH_WARNINGS'
            && req.body.acknowledge_warnings === true && !!acknowledgement;
          if (run.calculation_status === 'VALID_WITH_WARNINGS' && !run.warning_acknowledged && !acknowledgeNow) {
            throw biologicalMediaApiError(409, 'WARNING_ACKNOWLEDGEMENT_REQUIRED', 'Review and explicitly acknowledge every warning before approval.');
          }
          const result = await client.query(
            `UPDATE lss_biological_media_runs SET status='Approved',
             warning_acknowledged=CASE WHEN $1 THEN true ELSE warning_acknowledged END,
             warning_acknowledged_by=CASE WHEN $1 THEN $2 ELSE warning_acknowledged_by END,
             warning_acknowledged_at=CASE WHEN $1 THEN NOW() ELSE warning_acknowledged_at END,
             approved_by=$2, approved_at=NOW(), review_notes=COALESCE($3, review_notes), updated_at=NOW()
             WHERE id=$4 AND status='Pending Review' AND calculation_status <> 'BLOCKED' RETURNING *`,
            [acknowledgeNow, req.user!.id, reviewNotes || acknowledgement, run.id],
          );
          if (!result.rows[0]) throw biologicalMediaApiError(409, 'INVALID_RUN_STATE', 'The run changed before approval.');
          await client.query(
            `INSERT INTO lss_biological_media_run_audit (run_id, action, actor_id, details)
             VALUES ($1,'RUN_APPROVED',$2,$3)`,
            [run.id, req.user!.id, {
              review_notes: reviewNotes,
              warning_acknowledged: run.warning_acknowledged || acknowledgeNow,
              warning_acknowledgement: acknowledgement,
            }],
          );
          return result.rows[0];
        },
      );
      res.json(updated);
    } catch (error) {
      if (!sendBiologicalMediaApiError(error, res)) throw error;
    }
  },
);

router.post(
  '/systems/:id/biological-media/runs/:runId/reject',
  requireModuleManage('design_books'),
  requireRole('admin', 'engineer'),
  async (req: AuthRequest, res: Response) => {
    const designBookId = text(req.body.design_book_id);
    const reason = text(req.body.reason);
    if (!designBookId || !reason) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id and a rejection reason are required.' } });
    }
    const editable = await editableRunContext(routeParam(req.params.id), designBookId);
    if ('error' in editable) {
      return res.status(editable.error.status).json({ error: { code: editable.error.code, message: editable.error.message } });
    }
    try {
      const updated = await withLockedRun(
        routeParam(req.params.id), designBookId, routeParam(req.params.runId),
        async (client, run) => {
          if (run.status !== 'Pending Review') {
            throw biologicalMediaApiError(409, 'INVALID_RUN_STATE', 'Only a pending calculation run can be rejected.');
          }
          const result = await client.query(
            `UPDATE lss_biological_media_runs
             SET status='Rejected', rejection_reason=$1, review_notes=$2, updated_at=NOW()
             WHERE id=$3 AND status='Pending Review' RETURNING *`,
            [reason, text(req.body.review_notes), run.id],
          );
          if (!result.rows[0]) throw biologicalMediaApiError(409, 'INVALID_RUN_STATE', 'The run changed before rejection.');
          await client.query(
            `INSERT INTO lss_biological_media_run_audit (run_id, action, actor_id, details)
             VALUES ($1,'RUN_REJECTED',$2,$3)`,
            [run.id, req.user!.id, { reason, review_notes: text(req.body.review_notes) }],
          );
          return result.rows[0];
        },
      );
      res.json(updated);
    } catch (error) {
      if (!sendBiologicalMediaApiError(error, res)) throw error;
    }
  },
);

router.get('/systems/:id/biological-media/runs/:runId/export', async (req: AuthRequest, res: Response) => {
  const designBookId = text(req.query.design_book_id);
  if (!designBookId) return res.status(400).json({ error: { code: 'VALIDATION', message: 'design_book_id is required.' } });
  const run = await loadRun(routeParam(req.params.id), designBookId, routeParam(req.params.runId));
  if (!run) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Calculation run not found.' } });
  res.setHeader('Content-Disposition', `attachment; filename="biological-media-run-${run.run_number}.txt"`);
  res.type('text/plain').send(renderBiologicalMediaRunSummary(run));
});

router.get('/biological-media/media-profiles', async (_req: AuthRequest, res: Response) => {
  const includeRetired = _req.query.include_retired === 'true';
  const approvedOnly = _req.query.approved_only === 'true';
  const conditions = [
    ...(includeRetired ? [] : ["status <> 'Retired'"]),
    ...(approvedOnly ? ["status = 'Approved'"] : []),
  ];
  const result = await query(
    `SELECT * FROM lss_biological_media_profiles
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY profile_code, revision DESC`,
  );
  res.json({ items: result.rows });
});

router.get('/biological-media/tan-profiles', async (req: AuthRequest, res: Response) => {
  const includeRetired = req.query.include_retired === 'true';
  const approvedOnly = req.query.approved_only === 'true';
  const conditions = [
    ...(includeRetired ? [] : ["status <> 'Retired'"]),
    ...(approvedOnly ? ["status = 'Approved'"] : []),
  ];
  const result = await query(
    `SELECT * FROM lss_tan_generation_profiles
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY profile_code, revision DESC`,
  );
  res.json({ items: result.rows });
});

router.post('/admin/biological-media/media-profiles', requireModuleManage('design_books'), requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const errors = validateMediaProfile(req.body, false);
  if (errors.length) return res.status(400).json({ error: { code: 'VALIDATION', message: errors.join(' ') , fields: errors } });
  const code = text(req.body.profile_code)!;
  const revision = await nextRevision('lss_biological_media_profiles', code);
  try {
    const result = await query(
      `INSERT INTO lss_biological_media_profiles
       (profile_code, profile_name, revision, water_types, reactor_types, capacity_model, capacity_model_version,
        capacity_basis_unit, operating_min_temperature_c, operating_max_temperature_c, operating_min_salinity_ppt,
        operating_max_salinity_ppt, media_min_depth_mm, media_max_depth_mm, media_void_fraction,
         media_bulk_density_kg_m3, overall_vtr_g_tan_n_m3_d, default_safety_factor, minimum_media_m3,
         module_increment_m3, media_fill_fraction, operating_min_ph, operating_max_ph,
         operating_min_tan_mg_n_l, operating_max_tan_mg_n_l, operating_min_do_mg_l,
         operating_max_do_mg_l, operating_min_flow_m3_h, operating_max_flow_m3_h,
         evidence_reference, is_provisional, provisional_label, status, notes, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
       RETURNING *`,
      [code, text(req.body.profile_name), revision, arrayOfText(req.body.water_types), arrayOfText(req.body.reactor_types),
        text(req.body.capacity_model), text(req.body.capacity_model_version), text(req.body.capacity_basis_unit),
        ...['operating_min_temperature_c', 'operating_max_temperature_c', 'operating_min_salinity_ppt', 'operating_max_salinity_ppt',
          'media_min_depth_mm', 'media_max_depth_mm', 'media_void_fraction', 'media_bulk_density_kg_m3'].map(field => numberOrNull(req.body[field])),
         ...MEDIA_SIZING_FIELDS.map(field => numberOrNull(req.body[field])),
        text(req.body.evidence_reference), !!req.body.is_provisional, text(req.body.provisional_label),
        'Draft', text(req.body.notes), req.user!.id],
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    const mapped = databaseProfileError(error);
    if (mapped) return res.status(400).json({ error: mapped });
    throw error;
  }
});

router.post('/admin/biological-media/media-profiles/:id/revisions', requireModuleManage('design_books'), requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const source = await profileRevision('lss_biological_media_profiles', routeParam(req.params.id));
  if (!source) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Media profile revision not found.' } });
  const body = { ...source, ...req.body, profile_code: source.profile_code };
  const errors = validateMediaProfile(body, false);
  if (errors.length) return res.status(400).json({ error: { code: 'VALIDATION', message: errors.join(' '), fields: errors } });
  const revision = await nextRevision('lss_biological_media_profiles', body.profile_code);
  const result = await query(
    `INSERT INTO lss_biological_media_profiles
     (profile_code, profile_name, revision, water_types, reactor_types, capacity_model, capacity_model_version,
      capacity_basis_unit, operating_min_temperature_c, operating_max_temperature_c, operating_min_salinity_ppt,
      operating_max_salinity_ppt, media_min_depth_mm, media_max_depth_mm, media_void_fraction,
       media_bulk_density_kg_m3, overall_vtr_g_tan_n_m3_d, default_safety_factor, minimum_media_m3,
       module_increment_m3, media_fill_fraction, operating_min_ph, operating_max_ph,
       operating_min_tan_mg_n_l, operating_max_tan_mg_n_l, operating_min_do_mg_l,
       operating_max_do_mg_l, operating_min_flow_m3_h, operating_max_flow_m3_h,
       evidence_reference, is_provisional, provisional_label, status, notes, supersedes_id, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,'Draft',$33,$34,$35) RETURNING *`,
    [body.profile_code, text(body.profile_name), revision, arrayOfText(body.water_types), arrayOfText(body.reactor_types),
      text(body.capacity_model), text(body.capacity_model_version), text(body.capacity_basis_unit),
      ...['operating_min_temperature_c', 'operating_max_temperature_c', 'operating_min_salinity_ppt', 'operating_max_salinity_ppt',
        'media_min_depth_mm', 'media_max_depth_mm', 'media_void_fraction', 'media_bulk_density_kg_m3'].map(field => numberOrNull(body[field])),
       ...MEDIA_SIZING_FIELDS.map(field => numberOrNull(body[field])),
      text(body.evidence_reference), !!body.is_provisional, text(body.provisional_label), text(body.notes), source.id, req.user!.id],
  );
  res.status(201).json(result.rows[0]);
});

router.post('/admin/biological-media/tan-profiles', requireModuleManage('design_books'), requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const errors = validateTanProfile(req.body, false);
  if (errors.length) return res.status(400).json({ error: { code: 'VALIDATION', message: errors.join(' '), fields: errors } });
  const code = text(req.body.profile_code)!;
  const revision = await nextRevision('lss_tan_generation_profiles', code);
  const result = await query(
    `INSERT INTO lss_tan_generation_profiles
     (profile_code, profile_name, revision, coefficient, coefficient_unit, recommended_application, scope_type, scope_unit, scope_min,
      scope_max, evidence_reference, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [code, text(req.body.profile_name), revision, numberOrNull(req.body.coefficient), text(req.body.coefficient_unit),
       text(req.body.recommended_application), text(req.body.scope_type), text(req.body.scope_unit), numberOrNull(req.body.scope_min), numberOrNull(req.body.scope_max),
       text(req.body.evidence_reference), 'Draft', text(req.body.notes), req.user!.id],
  );
  res.status(201).json(result.rows[0]);
});

router.post('/admin/biological-media/tan-profiles/:id/revisions', requireModuleManage('design_books'), requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const source = await profileRevision('lss_tan_generation_profiles', routeParam(req.params.id));
  if (!source) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'TAN profile revision not found.' } });
  const body = { ...source, ...req.body, profile_code: source.profile_code };
  const errors = validateTanProfile(body, false);
  if (errors.length) return res.status(400).json({ error: { code: 'VALIDATION', message: errors.join(' '), fields: errors } });
  const revision = await nextRevision('lss_tan_generation_profiles', body.profile_code);
  const result = await query(
    `INSERT INTO lss_tan_generation_profiles
     (profile_code, profile_name, revision, coefficient, coefficient_unit, recommended_application, scope_type, scope_unit, scope_min,
      scope_max, evidence_reference, status, notes, supersedes_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Draft',$12,$13,$14) RETURNING *`,
    [body.profile_code, text(body.profile_name), revision, numberOrNull(body.coefficient), text(body.coefficient_unit),
       text(body.recommended_application), text(body.scope_type), text(body.scope_unit), numberOrNull(body.scope_min), numberOrNull(body.scope_max),
       text(body.evidence_reference), text(body.notes), source.id, req.user!.id],
  );
  res.status(201).json(result.rows[0]);
});

async function updateProfileStatus(table: string, id: string, body: any, req: AuthRequest, res: Response) {
  const existing = await profileRevision(table, id);
  if (!existing) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Profile revision not found.' } });
  const requestedStatus = text(body.status);
  if (existing.status === 'Retired' || (existing.status === 'Approved' && requestedStatus !== 'Retired')) {
    return res.status(409).json({ error: { code: 'IMMUTABLE_REVISION', message: 'Approved or retired revisions cannot be edited; create a new revision instead.' } });
  }
  const nextStatus = requestedStatus;
  if (!nextStatus || !PROFILE_STATUSES.includes(nextStatus)) return res.status(400).json({ error: { code: 'VALIDATION', message: `Status must be one of: ${PROFILE_STATUSES.join(', ')}.` } });
  const merged = { ...existing, ...body, status: nextStatus };
  const errors = table.includes('tan_') ? validateTanProfile(merged) : validateMediaProfile(merged, nextStatus === 'Approved');
  if (nextStatus === 'Approved' && errors.length) return res.status(400).json({ error: { code: 'VALIDATION', message: errors.join(' '), fields: errors } });
  if (table === 'lss_biological_media_profiles' && nextStatus === 'Approved'
      && String(existing.capacity_model || '').toUpperCase().replace(/[\s-]+/g, '_') === 'OVERALL_VTR') {
    const tanResult = await query(
      `SELECT 1 FROM lss_tan_generation_profiles
       WHERE status='Approved' AND coefficient_unit=$1 LIMIT 1`,
      [TAN_COEFFICIENT_UNIT],
    );
    if (!tanResult.rows[0]) {
      return res.status(409).json({
        error: {
          code: 'TAN_PROFILE_REQUIRED',
          message: 'Approve at least one TAN-generation profile revision before approving an overall-VTR media profile.',
        },
      });
    }
  }
  try {
    const result = await query(
      `UPDATE ${table} SET status=$1::varchar, approved_by=CASE WHEN $1::varchar='Approved' THEN $2 ELSE approved_by END,
       approved_at=CASE WHEN $1::varchar='Approved' THEN NOW() ELSE approved_at END,
       retired_at=CASE WHEN $1::varchar='Retired' THEN NOW() ELSE retired_at END, updated_at=NOW()
       WHERE id=$3 RETURNING *`,
      [nextStatus, req.user!.id, id],
    );
    return res.json(result.rows[0]);
  } catch (error: any) {
    const mapped = databaseProfileError(error);
    if (mapped) return res.status(409).json({ error: mapped });
    throw error;
  }
}

router.patch('/admin/biological-media/media-profiles/:id/status', requireModuleManage('design_books'), requireRole('admin'), async (req: AuthRequest, res: Response) =>
  updateProfileStatus('lss_biological_media_profiles', routeParam(req.params.id), req.body, req, res));
router.patch('/admin/biological-media/tan-profiles/:id/status', requireModuleManage('design_books'), requireRole('admin'), async (req: AuthRequest, res: Response) =>
  updateProfileStatus('lss_tan_generation_profiles', routeParam(req.params.id), req.body, req, res));

export default router;