import { AQUARIUM_CALCULATION_VERSION } from './aquariumCalculations';
import { PUMP_SELECTION_CALCULATION_VERSION, pumpCircuits, isFoamFractionatorCircuit, PUMP_ROLE_VENTURI } from './pumpSelections';
import { isApprovedThermalCorrelationSnapshot } from './thermalCalculations';
import { FRICTION_LOSS_CALCULATION_VERSION } from './frictionLossCalculations';
import { isLifeSupportSystem } from './lssSystems';
import { isRetiredSystem } from './systemLifecycle';
import { resolveLoopFlows } from './flowRoute';
import { requiredPumpLinkedQuantity } from './lssControls';

export type ReleaseSeverity = 'blocker' | 'warning';
export type ReleaseCheckStatus = 'pass' | 'warning' | 'blocked';

export interface ReleaseChecklistItem {
  key: string;
  label: string;
  severity: ReleaseSeverity;
  status: ReleaseCheckStatus;
  message: string;
  href?: string;
  affected_ids?: string[];
}

export interface DesignBookReleaseContext {
  id: string;
  book_code?: string | null;
  book_title?: string | null;
  revision?: string | null;
  project_id?: string | null;
  project_scopes?: string[] | null;
  exhibits?: any[];
  tanks?: any[];
  systems?: any[];
  system_links?: any[];
  species?: any[];
  hydraulics?: any[];
  biological_media_cases?: any[];
  biological_media_runs?: any[];
  thermal_calculations?: any[];
  pump_selections?: any[];
  friction_loss_calculations?: any[];
  lss_controls?: any[];
  engineering_calculations?: {
    exhibits?: any[];
    systems?: any[];
  };
}

const scopeMatches = (scopes: string[], value: string) =>
  scopes.some(scope => scope.toLowerCase().replace(/[\s_-]+/g, '') === value.toLowerCase().replace(/[\s_-]+/g, ''));

function item(
  key: string,
  label: string,
  severity: ReleaseSeverity,
  ok: boolean,
  message: string,
  href?: string,
  affected_ids?: string[],
): ReleaseChecklistItem {
  return {
    key,
    label,
    severity,
    status: ok ? 'pass' : severity === 'blocker' ? 'blocked' : 'warning',
    message,
    ...(href ? { href } : {}),
    ...(affected_ids?.length ? { affected_ids } : {}),
  };
}

function flowRouteFields(system: any) {
  return [1, 2, 3].map(loop => ({
    source: system?.[`loop${loop}_flow_source`],
    filtration: system?.[`loop${loop}_filtration`],
    flowMode: system?.[`loop${loop}_flow_mode`] === 'matched' ? 'matched' : 'allocated',
    matchLoopNumber: system?.[`loop${loop}_match_loop_number`] ?? null,
    bioDegas: system?.[`loop${loop}_bio_degas_m3h`],
    flowPct: system?.[`loop${loop}_flow_pct`],
    bioDegasPct: system?.[`loop${loop}_bio_degas_pct`],
    linked: system?.[`loop${loop}_link_bio_degas`],
  }));
}

function flowLoopIsConfigured(loop: ReturnType<typeof flowRouteFields>[number]) {
  return !!(
    loop.source ||
    loop.filtration ||
    loop.flowPct != null ||
    loop.bioDegasPct != null ||
    loop.bioDegas != null ||
    loop.linked
  );
}

function flowLoopLabel(system: any, loopNumber: number) {
  const systemLabel = system?.system_code || system?.system_name || system?.id;
  return systemLabel ? `${systemLabel} · Loop ${loopNumber}` : `Loop ${loopNumber}`;
}

function listLabels(labels: string[]) {
  if (labels.length <= 1) return labels[0] || '';
  if (labels.length === 2) return labels.join(' and ');
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function restoreRunSourceInput(run: any) {
  const source = JSON.parse(JSON.stringify(run.normalized_input_snapshot || {}));
  for (const override of run.overrides_snapshot || []) {
    const parts = String(override.field_path || '').split('.').filter(Boolean);
    let current = source;
    for (const part of parts.slice(0, -1)) current = current?.[part];
    if (current && parts.length) current[parts[parts.length - 1]] = override.original_value;
  }
  return source;
}

/**
 * The release policy is intentionally kept pure so the API and automated
 * checks use the same blocker/warning rules.
 */
export function buildDesignBookReleaseChecklist(context: DesignBookReleaseContext): ReleaseChecklistItem[] {
  const exhibits = context.exhibits || [];
  const tanks = context.tanks || [];
  const systems = context.systems || [];
  const lifeSupportSystems = systems.filter(isLifeSupportSystem);
  const retiredSystems = systems.filter(isRetiredSystem);
  const species = context.species || [];
  const hydraulics = context.hydraulics || [];
  const exhibitCalculations = context.engineering_calculations?.exhibits || [];
  const systemCalculations = context.engineering_calculations?.systems || [];
  const biologicalMediaCases = context.biological_media_cases || [];
  const biologicalMediaRuns = context.biological_media_runs || [];
  const thermalCalculations = context.thermal_calculations || [];
  const pumpSelections = context.pump_selections || [];
  const lssControls = context.lss_controls || [];
  const hasFrictionLossPackage = Array.isArray(context.friction_loss_calculations);
  const frictionLossCalculations = context.friction_loss_calculations || [];
  const scopes = Array.isArray(context.project_scopes) ? context.project_scopes : [];
  const hasLssScope = scopeMatches(scopes, 'LSS');
  const lssInstrumentIssues = lifeSupportSystems.flatMap(system => {
    const control = lssControls.find((entry: any) => entry.system_id === system.id);
    const instruments = control?.instruments || [];
    // Definitions that have since been deactivated remain governed historical
    // evidence in a Design Book through their instance snapshot.
    const definitionMap = new Map((control?.definitions || []).map((definition: any) => [definition.id, definition]));
    for (const instrument of instruments) {
      const id = instrument.definition_id || instrument.definition_snapshot?.id;
      if (id && !definitionMap.has(id) && instrument.definition_snapshot) {
        definitionMap.set(id, { ...instrument.definition_snapshot, id });
      }
    }
    const definitions = [...definitionMap.values()];
    const pumpRows = pumpSelections.find((entry: any) => entry.system_id === system.id)?.items || [];
    const minimum = requiredPumpLinkedQuantity(pumpRows);
    return definitions.flatMap((definition: any) => {
      const definitionInstruments = instruments.filter((instrument: any) => instrument.definition_id === definition.id);
      const quantity = definitionInstruments.length;
      const required = definition.requirement_rule === 'mandatory' ? 1
        : definition.requirement_rule === 'pump_linked' ? minimum : 0;
      const label = `${system.system_code || system.system_name || system.id} · ${definition.name || definition.tag_code}`;
      const quantityIssue = quantity < required ? [{
        system_id: system.id, label,
        reason: `requires at least ${required} instrument${required === 1 ? '' : 's'} but has ${quantity}`,
      }] : [];
      const blankLogic = ['mandatory', 'pump_linked'].includes(definition.requirement_rule)
        ? definitionInstruments.filter((instrument: any) => !String(instrument.control_logic || '').trim())
        : [];
      return [
        ...quantityIssue,
        ...(blankLogic.length ? [{
          system_id: system.id, label,
          reason: `${blankLogic.length} required instrument${blankLogic.length === 1 ? ' has' : 's have'} blank control logic`,
        }] : []),
      ];
    });
  });
  const exhibitIds = exhibits.map(exhibit => exhibit.id).filter(Boolean);
  const exhibitsWithoutTanks = exhibits.filter(exhibit =>
    !tanks.some(tank => tank.exhibit_id === exhibit.id));
  const exhibitsWithoutSpecies = exhibits.filter(exhibit =>
    !species.some(row => row.exhibit_id === exhibit.id));
  const exhibitsWithoutHydraulics = exhibits.filter(exhibit =>
    !hydraulics.some(record => record.exhibit_id === exhibit.id));
  const invalidExhibitCalculations = exhibitCalculations.filter(calculation => calculation.status === 'invalid');
  const invalidSystemCalculations = systemCalculations.filter(calculation => calculation.status === 'invalid');
  const staleCalculations = [
    ...hydraulics.filter(record =>
      record.calculation_version && record.calculation_version !== AQUARIUM_CALCULATION_VERSION),
    ...systems.filter(system =>
      system.calculation_version && system.calculation_version !== AQUARIUM_CALCULATION_VERSION),
    ...exhibitCalculations.filter(calculation => calculation.is_stale || calculation.freshness === 'stale'),
    ...systemCalculations.filter(calculation => calculation.is_stale || calculation.freshness === 'stale'),
  ];
  const systemsWithoutConfiguration = systems.filter(system => {
    const calculation = systemCalculations.find(item => item.inputs?.system_id === system.id);
    const source = calculation?.inputs?.design_flow_source;
    const authoritativeFlow = source === 'linked_exhibits'
      ? calculation?.results?.design_flow_m3h
      : system.design_flow_m3h;
    return !system.system_config || !system.system_type || !system.status ||
      !Number.isFinite(Number(authoritativeFlow)) || Number(authoritativeFlow) <= 0;
  });
  const systemsWithoutFlowRoute = systems.filter(system => {
    const loops = flowRouteFields(system);
    return !loops.some(loop => flowLoopIsConfigured(loop));
  });
  const systemsWithIncompleteFlowRoute = systems.filter(system => {
    const allLoops = flowRouteFields(system);
    const loops = allLoops.filter(loop =>
      flowLoopIsConfigured(loop));
    const hasIncompleteRoute = loops.some(loop => !loop.source || !loop.filtration);
    const hasMalformedMatch = resolveLoopFlows(system).some(loop =>
      loop.flow_mode === 'matched' &&
      ['invalid_source', 'invalid_target', 'circular_match'].includes(loop.unavailable_kind || ''));
    return loops.length > 0 && (hasIncompleteRoute || hasMalformedMatch);
  });
  const configuredFlowLoops = (hasLssScope ? systems : []).flatMap(system =>
    flowRouteFields(system)
      .map((loop, index) => ({ system, loop, label: flowLoopLabel(system, index + 1) }))
      .filter(({ loop }) => flowLoopIsConfigured(loop)));
  const unreviewedFlowLoops = configuredFlowLoops.filter(({ loop }) =>
    loop.flowMode === 'allocated' && loop.flowPct == null);
  const unreviewedBioDegasBranches = configuredFlowLoops.filter(({ loop }) =>
    loop.linked && loop.bioDegasPct == null);
  const biologicalMediaCasesWithoutApprovedRun = biologicalMediaCases.filter(mediaCase => {
    const latestRun = biologicalMediaRuns
      .filter(run => run.case_id === mediaCase.id)
      .sort((left, right) => Number(right.run_number) - Number(left.run_number))[0];
    if (mediaCase.preview_stale || !latestRun || latestRun.status !== 'Approved') return true;
    const system = systems.find(candidate => candidate.id === mediaCase.system_id);
    const linkedExhibitIds = (context.system_links || [])
      .filter(link => link.system_id === mediaCase.system_id)
      .map(link => link.exhibit_id);
    const linkedVolumes = linkedExhibitIds.map(exhibitId =>
      exhibitCalculations.find(calculation => calculation.inputs?.exhibit_id === exhibitId)?.results?.operating_volume_m3);
    const currentVolume = linkedVolumes.length && linkedVolumes.every(value => Number(value) > 0)
      ? linkedVolumes.reduce((sum, value) => sum + Number(value), 0)
      : null;
    const savedContext = latestRun.linked_volume_context_snapshot || {};
    const contextMatches = currentVolume != null
      && Math.abs(Number(savedContext.total_operating_volume_m3) - currentVolume) <= 1e-9
      && String(savedContext.system_water_type || '').toUpperCase() === String(system?.water_type || '').toUpperCase();
    const inputMatches = canonicalJson(restoreRunSourceInput(latestRun))
      === canonicalJson(mediaCase.preview_input_snapshot || {});
    return !contextMatches || !inputMatches;
  });
  const thermalNotReady = lifeSupportSystems.filter(system => {
    const thermal = thermalCalculations.find(item => item.system_id === system.id);
    const correlationSnapshot = thermal?.correlation_snapshot ||
      thermal?.calculation?.correlation_snapshot ||
      thermal?.saved?.correlation_snapshot ||
      thermal?.calculation?.inputs?.agitation_correlation_snapshot ||
      thermal?.saved?.input_snapshot?.agitation_correlation_snapshot;
    return !thermal || thermal.status !== 'Ready' || thermal.freshness !== 'fresh' ||
      thermal.calculation?.status !== 'Ready' ||
      !isApprovedThermalCorrelationSnapshot(correlationSnapshot);
  });
  const pumpCircuitIssues = lifeSupportSystems.flatMap(system => {
    const allItems: any[] = pumpSelections.find((entry: any) => entry.system_id === system.id)?.items || [];
    return pumpCircuits(system, system.side_streams || []).flatMap(circuit => {
      const systemLabel = `${system.system_code || system.system_name || system.id} · ${circuit.circuit_name || circuit.circuit_key}`;
      // Primary supply pump is always required for every circuit.
      const primarySelection = allItems.find((item: any) =>
        item.circuit_key === circuit.circuit_key &&
        (item.pump_role === 'primary' || !item.pump_role));
      const primaryReady = primarySelection?.project_equipment_item_id && primarySelection?.selected_pump &&
        primarySelection?.freshness === 'fresh' && primarySelection?.status === 'ready' &&
        primarySelection?.calculation_version === PUMP_SELECTION_CALCULATION_VERSION;
      const primaryIssue = primaryReady ? null : {
        system_id: system.id,
        label: isFoamFractionatorCircuit(circuit) ? `${systemLabel} (FFSP)` : systemLabel,
        reason: !primarySelection ? 'no pump selection exists'
          : primarySelection.status === 'stale' || primarySelection.freshness === 'stale' ? 'selection is stale'
          : primarySelection.status === 'incompatible' ? 'selected pump is incompatible with the required duty'
          : !primarySelection.project_equipment_item_id || !primarySelection.selected_pump ? 'no eligible selected pump is recorded'
          : primarySelection.calculation_version !== PUMP_SELECTION_CALCULATION_VERSION ? 'calculation version is outdated'
          : 'sizing calculation is incomplete',
      };
      // Venturi pump: only required when a FFVP line has been saved.  If the
      // designer chose "No" (no venturi row), the circuit passes with FFSP alone.
      const venturiSelection = allItems.find((item: any) =>
        item.circuit_key === circuit.circuit_key && item.pump_role === PUMP_ROLE_VENTURI);
      const venturiIssue = venturiSelection ? (() => {
        const ready = venturiSelection.project_equipment_item_id && venturiSelection.selected_pump &&
          venturiSelection.freshness === 'fresh' && venturiSelection.status === 'ready' &&
          venturiSelection.calculation_version === PUMP_SELECTION_CALCULATION_VERSION;
        return ready ? null : {
          system_id: system.id,
          label: `${systemLabel} (FFVP)`,
          reason: venturiSelection.status === 'stale' || venturiSelection.freshness === 'stale' ? 'FFVP selection is stale'
            : venturiSelection.status === 'incompatible' ? 'FFVP selected pump is incompatible with the required duty'
            : !venturiSelection.project_equipment_item_id || !venturiSelection.selected_pump ? 'no eligible FFVP pump is recorded'
            : venturiSelection.calculation_version !== PUMP_SELECTION_CALCULATION_VERSION ? 'FFVP calculation version is outdated'
            : 'FFVP sizing calculation is incomplete',
        };
      })() : null;
      return [primaryIssue, venturiIssue].filter(Boolean);
    });
  });
  const frictionCircuitIssues = lifeSupportSystems.flatMap(system => {
    const calculations = frictionLossCalculations.find((entry: any) => entry.system_id === system.id)?.items || [];
    return pumpCircuits(system, system.side_streams || []).map(circuit => {
      const calculation = calculations.find((entry: any) => entry.circuit_key === circuit.circuit_key);
      const selection = pumpSelections.find((entry: any) => entry.system_id === system.id)?.items
        ?.find((item: any) => item.circuit_key === circuit.circuit_key);
      const samePump = !!selection?.project_equipment_item_id &&
        selection.project_equipment_item_id === calculation?.project_equipment_item_id;
      const ready = calculation?.freshness === 'fresh' &&
        calculation?.status === 'ready' &&
        calculation?.selected_pump &&
        samePump &&
        selection?.freshness === 'fresh' &&
        selection?.status === 'ready' &&
        selection?.calculation_version === PUMP_SELECTION_CALCULATION_VERSION &&
        calculation?.calculation_version === FRICTION_LOSS_CALCULATION_VERSION &&
        calculation?.result?.results?.combined_head_loss_m != null;
      return ready ? null : {
        system_id: system.id,
        label: `${system.system_code || system.system_name || system.id} · ${circuit.circuit_name || circuit.circuit_key}`,
        reason: !selection ? 'no current pump selection exists'
          : !samePump ? 'friction calculation does not use the current Flow Route pump selection'
          : calculation?.reasons?.[0] || 'Complete and recalculate suction and discharge friction loss.',
      };
    }).filter(Boolean);
  });

  return [
    item(
      'metadata',
      'Book metadata',
      'blocker',
      !!context.book_code?.trim() && !!context.book_title?.trim() && !!context.revision?.trim(),
      context.book_code && context.book_title && context.revision
        ? 'Book code, title, and revision are present.'
        : 'Book code, title, and revision are required before release.',
      `/design-books/${context.id}`,
    ),
    item(
      'scope',
      'Included project scope',
      'blocker',
      !!context.project_id && scopes.length > 0,
      !context.project_id
        ? 'Link the Design Book to a project before release.'
        : scopes.length === 0
          ? 'The linked project has no defined engineering scope.'
          : `Scope loaded: ${scopes.join(', ')}.`,
      context.project_id ? `/projects/${context.project_id}` : `/design-books/${context.id}`,
    ),
    item(
      'exhibits',
      'Exhibits',
      'blocker',
      exhibits.length > 0,
      exhibits.length > 0 ? `${exhibits.length} exhibit${exhibits.length === 1 ? '' : 's'} included.` : 'At least one exhibit is required.',
      `/design-books/${context.id}?tab=exhibits`,
      exhibitIds,
    ),
    item(
      'tanks',
      'Tanks',
      'blocker',
      exhibits.length > 0 && exhibitsWithoutTanks.length === 0 && tanks.length > 0,
      exhibits.length === 0
        ? 'Add exhibits before assigning tanks.'
        : tanks.length === 0
          ? 'At least one tank is required for the included exhibits.'
          : exhibitsWithoutTanks.length
            ? `${exhibitsWithoutTanks.length} exhibit${exhibitsWithoutTanks.length === 1 ? ' has' : 's have'} no tank assigned.`
            : `${tanks.length} tank${tanks.length === 1 ? '' : 's'} assigned.`,
      `/design-books/${context.id}?tab=exhibits`,
      exhibitsWithoutTanks.map(exhibit => exhibit.id),
    ),
    item(
      'species',
      'Species allocations',
      'warning',
      exhibits.length === 0 || exhibitsWithoutSpecies.length === 0,
      exhibits.length === 0
        ? 'No exhibits to allocate.'
        : exhibitsWithoutSpecies.length
          ? `${exhibitsWithoutSpecies.length} exhibit${exhibitsWithoutSpecies.length === 1 ? ' has' : 's have'} no species allocation.`
          : 'Species allocations are present for every exhibit.',
      `/design-books/${context.id}?tab=exhibits`,
      exhibitsWithoutSpecies.map(exhibit => exhibit.id),
    ),
    item(
      'hydraulics',
      'Exhibit hydraulics',
      'blocker',
      exhibits.length > 0 && exhibitsWithoutHydraulics.length === 0,
      exhibits.length === 0
        ? 'Add exhibits before defining hydraulics.'
        : exhibitsWithoutHydraulics.length
          ? `${exhibitsWithoutHydraulics.length} exhibit${exhibitsWithoutHydraulics.length === 1 ? ' is' : 's are'} missing hydraulics data.`
          : 'Hydraulics data is present for every exhibit.',
      `/design-books/${context.id}?tab=exhibits`,
      exhibitsWithoutHydraulics.map(exhibit => exhibit.id),
    ),
    item(
      'lss_lifecycle',
      'Current LSS lifecycle',
      hasLssScope ? 'blocker' : 'warning',
      !hasLssScope || retiredSystems.length === 0,
      !hasLssScope
        ? 'LSS is not included in the project scope.'
        : retiredSystems.length
          ? `${retiredSystems.length} retired LSS record${retiredSystems.length === 1 ? ' is' : 's are'} included. Replace or remove retired systems from the current Design Book before release.`
          : 'Every included LSS is current and lifecycle-eligible.',
       `/design-books/${context.id}?tab=lss`,
      retiredSystems.map(system => system.id).filter(Boolean),
    ),
    item(
      'lss_configuration',
      'LSS configuration',
      hasLssScope ? 'blocker' : 'warning',
      !hasLssScope || (systems.length > 0 && systemsWithoutConfiguration.length === 0),
      !hasLssScope
        ? 'LSS is not included in the project scope.'
        : systems.length === 0
          ? 'The project scope includes LSS, but no LSS system is configured.'
          : systemsWithoutConfiguration.length
            ? `${systemsWithoutConfiguration.length} LSS system${systemsWithoutConfiguration.length === 1 ? ' is' : 's are'} missing type, status, or positive design flow.`
            : `${systems.length} LSS system${systems.length === 1 ? '' : 's'} configured.`,
       `/design-books/${context.id}?tab=lss`,
      systemsWithoutConfiguration.map(system => system.id),
    ),
    item(
      'flow_route',
      'Flow Route data',
      hasLssScope ? 'blocker' : 'warning',
      !hasLssScope || (systems.length > 0 && systemsWithoutFlowRoute.length === 0 && systemsWithIncompleteFlowRoute.length === 0),
      !hasLssScope
        ? 'LSS Flow Route is not included in the project scope.'
        : systemsWithoutFlowRoute.length
          ? `${systemsWithoutFlowRoute.length} LSS system${systemsWithoutFlowRoute.length === 1 ? ' has' : 's have'} no Flow Route data.`
          : systemsWithIncompleteFlowRoute.length
            ? `${systemsWithIncompleteFlowRoute.length} Flow Route entr${systemsWithIncompleteFlowRoute.length === 1 ? 'y is' : 'ies are'} incomplete.`
            : 'Flow Route data is complete.',
      `/design-books/${context.id}?tab=lss`,
      [...systemsWithoutFlowRoute, ...systemsWithIncompleteFlowRoute].map(system => system.id),
    ),
    item(
      'flow_route_allocations',
      'Loop flow allocations',
      'warning',
      unreviewedFlowLoops.length === 0,
      unreviewedFlowLoops.length
        ? `${listLabels(unreviewedFlowLoops.map(({ label }) => label))} ${unreviewedFlowLoops.length === 1 ? 'has' : 'have'} an unreviewed total-flow percentage. Blank means unreviewed; 0% is an intentional allocation.`
        : configuredFlowLoops.length
          ? 'Every configured loop has a reviewed total-flow percentage; 0% is retained as an intentional allocation.'
          : 'No configured Flow Route loops require total-flow allocation review.',
      `/design-books/${context.id}?tab=lss`,
      [...new Set(unreviewedFlowLoops.map(({ system }) => system.id).filter(Boolean))],
    ),
    item(
      'bio_degas_allocations',
      'Bio/Degas branch allocations',
      'warning',
      unreviewedBioDegasBranches.length === 0,
      unreviewedBioDegasBranches.length
        ? `${listLabels(unreviewedBioDegasBranches.map(({ label }) => label))} ${unreviewedBioDegasBranches.length === 1 ? 'has' : 'have'} an unreviewed linked Bio/Degas branch percentage. Blank means unreviewed; 0% is an intentional allocation.`
        : configuredFlowLoops.some(({ loop }) => loop.linked)
          ? 'Every linked Bio/Degas branch has a reviewed percentage; 0% is retained as an intentional allocation.'
          : 'No linked Bio/Degas branches require allocation review.',
      `/design-books/${context.id}?tab=lss`,
      [...new Set(unreviewedBioDegasBranches.map(({ system }) => system.id).filter(Boolean))],
    ),
    item(
      'calculations',
      'Engineering calculations',
      'blocker',
      invalidExhibitCalculations.length === 0 && invalidSystemCalculations.length === 0,
      invalidExhibitCalculations.length || invalidSystemCalculations.length
        ? `${invalidExhibitCalculations.length + invalidSystemCalculations.length} engineering calculation${invalidExhibitCalculations.length + invalidSystemCalculations.length === 1 ? ' is' : 's are'} unresolved: ${
          invalidExhibitCalculations[0]?.reasons?.join(' ') ||
          invalidSystemCalculations[0]?.reasons?.join(' ') ||
          'invalid inputs'
        }.`
        : 'All current engineering calculations resolve successfully.',
      `/design-books/${context.id}?tab=exhibits`,
      [
        ...invalidExhibitCalculations.map(calculation => calculation.inputs?.exhibit_id),
        ...invalidSystemCalculations.map(calculation => calculation.inputs?.system_id),
      ].filter(Boolean),
    ),
    item(
      'biological_media_runs',
      'Biological Media calculation runs',
      'blocker',
      biologicalMediaCasesWithoutApprovedRun.length === 0,
      biologicalMediaCasesWithoutApprovedRun.length
        ? `${biologicalMediaCasesWithoutApprovedRun.length} Biological Media case${biologicalMediaCasesWithoutApprovedRun.length === 1 ? ' needs' : 's need'} a current approved frozen calculation run.`
        : biologicalMediaCases.length
          ? 'Every Biological Media case has a current approved frozen calculation run.'
          : 'No Biological Media cases are included.',
      `/design-books/${context.id}?tab=lss`,
      biologicalMediaCasesWithoutApprovedRun.map(mediaCase => mediaCase.system_id).filter(Boolean),
    ),
    item(
      'thermal_calculations',
      'Thermal calculations',
      hasLssScope ? 'blocker' : 'warning',
      !hasLssScope || (lifeSupportSystems.length > 0 && thermalNotReady.length === 0),
      !hasLssScope
        ? 'Thermal calculation is not required because LSS is outside project scope.'
        : lifeSupportSystems.length === 0
          ? 'Add an LSS system before calculating thermal loads.'
          : thermalNotReady.length
            ? `${thermalNotReady.length} LSS system${thermalNotReady.length === 1 ? ' needs' : 's need'} a current Ready thermal calculation.`
            : 'Every Life Support system has a current Ready thermal calculation.',
      `/design-books/${context.id}?tab=thermal`,
      thermalNotReady.map(system => system.id),
    ),
    item(
      'lss_field_instruments',
      'LSS field instruments',
      hasLssScope ? 'blocker' : 'warning',
      !hasLssScope || lssInstrumentIssues.length === 0,
      !hasLssScope ? 'Field instruments are not required because LSS is outside project scope.'
        : lssInstrumentIssues.length
          ? `${lssInstrumentIssues.map((issue: any) => `${issue.label}: ${issue.reason}`).join('; ')}.`
          : 'All mandatory and pump-linked field instrument quantities are satisfied.',
       `/design-books/${context.id}?tab=control${lssInstrumentIssues.length === 1 ? `&system=${encodeURIComponent(lssInstrumentIssues[0].system_id)}` : ''}`,
      [...new Set(lssInstrumentIssues.map((issue: any) => issue.system_id))],
    ),
    item(
      'pump_selections',
      'Pump selections',
      hasLssScope ? 'blocker' : 'warning',
      !hasLssScope || pumpCircuitIssues.length === 0,
      !hasLssScope ? 'Pump selections are not required because LSS is outside project scope.'
        : pumpCircuitIssues.length
          ? `${pumpCircuitIssues.map((issue: any) => `${issue.label}: ${issue.reason}`).join('; ')}.`
          : 'Every active LSS Flow Route circuit has a fresh ready pump selection.',
      `/design-books/${context.id}?tab=lss`,
      [...new Set(pumpCircuitIssues.map((issue: any) => issue.system_id))],
    ),
    item(
      'friction_loss_calculations',
      'Friction Loss calculations',
      hasLssScope ? 'blocker' : 'warning',
      !hasLssScope || !hasFrictionLossPackage || frictionCircuitIssues.length === 0,
      !hasLssScope ? 'Friction Loss is not required because LSS is outside project scope.'
        : !hasFrictionLossPackage ? 'Legacy package predates Friction Loss calculations.'
        : frictionCircuitIssues.length
          ? `${frictionCircuitIssues.map((issue: any) => `${issue.label}: ${issue.reason}`).join('; ')}.`
          : 'Every active LSS Flow Route circuit has a fresh Ready friction-loss calculation.',
      `/design-books/${context.id}?tab=piping`,
      [...new Set(frictionCircuitIssues.map((issue: any) => issue.system_id))],
    ),
    item(
      'calculation_freshness',
      'Calculation freshness',
      'blocker',
      staleCalculations.length === 0,
      staleCalculations.length
        ? `${staleCalculations.length} saved calculation${staleCalculations.length === 1 ? ' is' : 's are'} stale and must be recalculated.`
        : `Calculations use ${AQUARIUM_CALCULATION_VERSION}.`,
      `/design-books/${context.id}?tab=exhibits`,
    ),
    item(
      'unassigned_tanks',
      'Tank assignments',
      'warning',
      tanks.every(tank => tank.exhibit_id),
      tanks.some(tank => !tank.exhibit_id)
        ? `${tanks.filter(tank => !tank.exhibit_id).length} tank${tanks.filter(tank => !tank.exhibit_id).length === 1 ? ' is' : 's are'} not assigned to an exhibit.`
        : 'Every tank is assigned to an exhibit.',
      `/design-books/${context.id}?tab=exhibits`,
      tanks.filter(tank => !tank.exhibit_id).map(tank => tank.id),
    ),
  ];
}

export function releaseBlockers(checklist: ReleaseChecklistItem[]) {
  return checklist.filter(check => check.status === 'blocked');
}

export function validateReleaseConfirmation(input: {
  currentRevision: string;
  confirmedRevision: string;
  includedScope: string[];
  projectScope: string[];
  releaseNotes: string;
}) {
  if (!input.confirmedRevision || input.includedScope.length === 0 || !input.releaseNotes) {
    return { status: 400, code: 'VALIDATION', message: 'Confirm the revision, at least one included scope item, and release notes.' };
  }
  if (input.confirmedRevision !== input.currentRevision) {
    return { status: 409, code: 'REVISION_MISMATCH', message: `Confirm revision ${input.currentRevision} before release.` };
  }
  const invalidScope = input.includedScope.filter(item => !input.projectScope.includes(item));
  if (invalidScope.length) {
    return {
      status: 400,
      code: 'INVALID_RELEASE_SCOPE',
      message: `Included scope must come from the linked project: ${invalidScope.join(', ')}.`,
    };
  }
  return null;
}

export function validateReleaseBlockers(blockerCount: number) {
  if (blockerCount > 0) {
    return {
      status: 422,
      code: 'RELEASE_BLOCKED',
      message: `${blockerCount} release blocker${blockerCount === 1 ? '' : 's'} must be resolved.`,
    };
  }
  return null;
}
