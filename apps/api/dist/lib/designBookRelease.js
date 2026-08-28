"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDesignBookReleaseChecklist = buildDesignBookReleaseChecklist;
exports.releaseBlockers = releaseBlockers;
exports.validateReleaseConfirmation = validateReleaseConfirmation;
exports.validateReleaseBlockers = validateReleaseBlockers;
const aquariumCalculations_1 = require("./aquariumCalculations");
const scopeMatches = (scopes, value) => scopes.some(scope => scope.toLowerCase().replace(/[\s_-]+/g, '') === value.toLowerCase().replace(/[\s_-]+/g, ''));
function item(key, label, severity, ok, message, href, affected_ids) {
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
function flowRouteFields(system) {
    return [1, 2, 3].map(loop => ({
        source: system?.[`loop${loop}_flow_source`],
        filtration: system?.[`loop${loop}_filtration`],
        bioDegas: system?.[`loop${loop}_bio_degas_m3h`],
        flowPct: system?.[`loop${loop}_flow_pct`],
        bioDegasPct: system?.[`loop${loop}_bio_degas_pct`],
        linked: system?.[`loop${loop}_link_bio_degas`],
    }));
}
function flowLoopIsConfigured(loop) {
    return !!(loop.source ||
        loop.filtration ||
        loop.flowPct != null ||
        loop.bioDegasPct != null ||
        loop.bioDegas != null ||
        loop.linked);
}
function flowLoopLabel(system, loopNumber) {
    const systemLabel = system?.system_code || system?.system_name || system?.id;
    return systemLabel ? `${systemLabel} · Loop ${loopNumber}` : `Loop ${loopNumber}`;
}
function listLabels(labels) {
    if (labels.length <= 1)
        return labels[0] || '';
    if (labels.length === 2)
        return labels.join(' and ');
    return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}
/**
 * The release policy is intentionally kept pure so the API and automated
 * checks use the same blocker/warning rules.
 */
function buildDesignBookReleaseChecklist(context) {
    const exhibits = context.exhibits || [];
    const tanks = context.tanks || [];
    const systems = context.systems || [];
    const species = context.species || [];
    const hydraulics = context.hydraulics || [];
    const exhibitCalculations = context.engineering_calculations?.exhibits || [];
    const systemCalculations = context.engineering_calculations?.systems || [];
    const scopes = Array.isArray(context.project_scopes) ? context.project_scopes : [];
    const hasLssScope = scopeMatches(scopes, 'LSS');
    const exhibitIds = exhibits.map(exhibit => exhibit.id).filter(Boolean);
    const exhibitsWithoutTanks = exhibits.filter(exhibit => !tanks.some(tank => tank.exhibit_id === exhibit.id));
    const exhibitsWithoutSpecies = exhibits.filter(exhibit => !species.some(row => row.exhibit_id === exhibit.id));
    const exhibitsWithoutHydraulics = exhibits.filter(exhibit => !hydraulics.some(record => record.exhibit_id === exhibit.id));
    const invalidExhibitCalculations = exhibitCalculations.filter(calculation => calculation.status === 'invalid');
    const invalidSystemCalculations = systemCalculations.filter(calculation => calculation.status === 'invalid');
    const staleCalculations = [
        ...hydraulics.filter(record => record.calculation_version && record.calculation_version !== aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION),
        ...systems.filter(system => system.calculation_version && system.calculation_version !== aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION),
        ...exhibitCalculations.filter(calculation => calculation.is_stale || calculation.freshness === 'stale'),
        ...systemCalculations.filter(calculation => calculation.is_stale || calculation.freshness === 'stale'),
    ];
    const systemsWithoutConfiguration = systems.filter(system => !system.system_config || !system.system_type || !system.status ||
        !Number.isFinite(Number(system.design_flow_m3h)) || Number(system.design_flow_m3h) <= 0);
    const systemsWithoutFlowRoute = systems.filter(system => {
        const loops = flowRouteFields(system);
        return !loops.some(loop => flowLoopIsConfigured(loop));
    });
    const systemsWithIncompleteFlowRoute = systems.filter(system => {
        const loops = flowRouteFields(system).filter(loop => flowLoopIsConfigured(loop));
        return loops.length > 0 && loops.some(loop => !loop.source || !loop.filtration);
    });
    const configuredFlowLoops = (hasLssScope ? systems : []).flatMap(system => flowRouteFields(system)
        .map((loop, index) => ({ system, loop, label: flowLoopLabel(system, index + 1) }))
        .filter(({ loop }) => flowLoopIsConfigured(loop)));
    const unreviewedFlowLoops = configuredFlowLoops.filter(({ loop }) => loop.flowPct == null);
    const unreviewedBioDegasBranches = configuredFlowLoops.filter(({ loop }) => loop.linked && loop.bioDegasPct == null);
    return [
        item('metadata', 'Book metadata', 'blocker', !!context.book_code?.trim() && !!context.book_title?.trim() && !!context.revision?.trim(), context.book_code && context.book_title && context.revision
            ? 'Book code, title, and revision are present.'
            : 'Book code, title, and revision are required before release.', `/design-books/${context.id}`),
        item('scope', 'Included project scope', 'blocker', !!context.project_id && scopes.length > 0, !context.project_id
            ? 'Link the Design Book to a project before release.'
            : scopes.length === 0
                ? 'The linked project has no defined engineering scope.'
                : `Scope loaded: ${scopes.join(', ')}.`, context.project_id ? `/projects/${context.project_id}` : `/design-books/${context.id}`),
        item('exhibits', 'Exhibits', 'blocker', exhibits.length > 0, exhibits.length > 0 ? `${exhibits.length} exhibit${exhibits.length === 1 ? '' : 's'} included.` : 'At least one exhibit is required.', `/design-books/${context.id}?tab=exhibits`, exhibitIds),
        item('tanks', 'Tanks', 'blocker', exhibits.length > 0 && exhibitsWithoutTanks.length === 0 && tanks.length > 0, exhibits.length === 0
            ? 'Add exhibits before assigning tanks.'
            : tanks.length === 0
                ? 'At least one tank is required for the included exhibits.'
                : exhibitsWithoutTanks.length
                    ? `${exhibitsWithoutTanks.length} exhibit${exhibitsWithoutTanks.length === 1 ? ' has' : 's have'} no tank assigned.`
                    : `${tanks.length} tank${tanks.length === 1 ? '' : 's'} assigned.`, `/design-books/${context.id}?tab=exhibits`, exhibitsWithoutTanks.map(exhibit => exhibit.id)),
        item('species', 'Species allocations', 'warning', exhibits.length === 0 || exhibitsWithoutSpecies.length === 0, exhibits.length === 0
            ? 'No exhibits to allocate.'
            : exhibitsWithoutSpecies.length
                ? `${exhibitsWithoutSpecies.length} exhibit${exhibitsWithoutSpecies.length === 1 ? ' has' : 's have'} no species allocation.`
                : 'Species allocations are present for every exhibit.', `/design-books/${context.id}?tab=exhibits`, exhibitsWithoutSpecies.map(exhibit => exhibit.id)),
        item('hydraulics', 'Exhibit hydraulics', 'blocker', exhibits.length > 0 && exhibitsWithoutHydraulics.length === 0, exhibits.length === 0
            ? 'Add exhibits before defining hydraulics.'
            : exhibitsWithoutHydraulics.length
                ? `${exhibitsWithoutHydraulics.length} exhibit${exhibitsWithoutHydraulics.length === 1 ? ' is' : 's are'} missing hydraulics data.`
                : 'Hydraulics data is present for every exhibit.', `/design-books/${context.id}?tab=exhibits`, exhibitsWithoutHydraulics.map(exhibit => exhibit.id)),
        item('lss_configuration', 'LSS configuration', hasLssScope ? 'blocker' : 'warning', !hasLssScope || (systems.length > 0 && systemsWithoutConfiguration.length === 0), !hasLssScope
            ? 'LSS is not included in the project scope.'
            : systems.length === 0
                ? 'The project scope includes LSS, but no LSS system is configured.'
                : systemsWithoutConfiguration.length
                    ? `${systemsWithoutConfiguration.length} LSS system${systemsWithoutConfiguration.length === 1 ? ' is' : 's are'} missing type, status, or positive design flow.`
                    : `${systems.length} LSS system${systems.length === 1 ? '' : 's'} configured.`, `/design-books/${context.id}?tab=lss`, systemsWithoutConfiguration.map(system => system.id)),
        item('flow_route', 'Flow Route data', hasLssScope ? 'blocker' : 'warning', !hasLssScope || (systems.length > 0 && systemsWithoutFlowRoute.length === 0 && systemsWithIncompleteFlowRoute.length === 0), !hasLssScope
            ? 'LSS Flow Route is not included in the project scope.'
            : systemsWithoutFlowRoute.length
                ? `${systemsWithoutFlowRoute.length} LSS system${systemsWithoutFlowRoute.length === 1 ? ' has' : 's have'} no Flow Route data.`
                : systemsWithIncompleteFlowRoute.length
                    ? `${systemsWithIncompleteFlowRoute.length} Flow Route entr${systemsWithIncompleteFlowRoute.length === 1 ? 'y is' : 'ies are'} incomplete.`
                    : 'Flow Route data is complete.', `/design-books/${context.id}?tab=lss`, [...systemsWithoutFlowRoute, ...systemsWithIncompleteFlowRoute].map(system => system.id)),
        item('flow_route_allocations', 'Loop flow allocations', 'warning', unreviewedFlowLoops.length === 0, unreviewedFlowLoops.length
            ? `${listLabels(unreviewedFlowLoops.map(({ label }) => label))} ${unreviewedFlowLoops.length === 1 ? 'has' : 'have'} an unreviewed total-flow percentage. Blank means unreviewed; 0% is an intentional allocation.`
            : configuredFlowLoops.length
                ? 'Every configured loop has a reviewed total-flow percentage; 0% is retained as an intentional allocation.'
                : 'No configured Flow Route loops require total-flow allocation review.', `/design-books/${context.id}?tab=lss`, [...new Set(unreviewedFlowLoops.map(({ system }) => system.id).filter(Boolean))]),
        item('bio_degas_allocations', 'Bio/Degas branch allocations', 'warning', unreviewedBioDegasBranches.length === 0, unreviewedBioDegasBranches.length
            ? `${listLabels(unreviewedBioDegasBranches.map(({ label }) => label))} ${unreviewedBioDegasBranches.length === 1 ? 'has' : 'have'} an unreviewed linked Bio/Degas branch percentage. Blank means unreviewed; 0% is an intentional allocation.`
            : configuredFlowLoops.some(({ loop }) => loop.linked)
                ? 'Every linked Bio/Degas branch has a reviewed percentage; 0% is retained as an intentional allocation.'
                : 'No linked Bio/Degas branches require allocation review.', `/design-books/${context.id}?tab=lss`, [...new Set(unreviewedBioDegasBranches.map(({ system }) => system.id).filter(Boolean))]),
        item('calculations', 'Engineering calculations', 'blocker', invalidExhibitCalculations.length === 0 && invalidSystemCalculations.length === 0, invalidExhibitCalculations.length || invalidSystemCalculations.length
            ? `${invalidExhibitCalculations.length + invalidSystemCalculations.length} engineering calculation${invalidExhibitCalculations.length + invalidSystemCalculations.length === 1 ? ' is' : 's are'} unresolved: ${invalidExhibitCalculations[0]?.reasons?.join(' ') ||
                invalidSystemCalculations[0]?.reasons?.join(' ') ||
                'invalid inputs'}.`
            : 'All current engineering calculations resolve successfully.', `/design-books/${context.id}?tab=exhibits`, [
            ...invalidExhibitCalculations.map(calculation => calculation.inputs?.exhibit_id),
            ...invalidSystemCalculations.map(calculation => calculation.inputs?.system_id),
        ].filter(Boolean)),
        item('calculation_freshness', 'Calculation freshness', 'blocker', staleCalculations.length === 0, staleCalculations.length
            ? `${staleCalculations.length} saved calculation${staleCalculations.length === 1 ? ' is' : 's are'} stale and must be recalculated.`
            : `Calculations use ${aquariumCalculations_1.AQUARIUM_CALCULATION_VERSION}.`, `/design-books/${context.id}?tab=exhibits`),
        item('unassigned_tanks', 'Tank assignments', 'warning', tanks.every(tank => tank.exhibit_id), tanks.some(tank => !tank.exhibit_id)
            ? `${tanks.filter(tank => !tank.exhibit_id).length} tank${tanks.filter(tank => !tank.exhibit_id).length === 1 ? ' is' : 's are'} not assigned to an exhibit.`
            : 'Every tank is assigned to an exhibit.', `/design-books/${context.id}?tab=exhibits`, tanks.filter(tank => !tank.exhibit_id).map(tank => tank.id)),
    ];
}
function releaseBlockers(checklist) {
    return checklist.filter(check => check.status === 'blocked');
}
function validateReleaseConfirmation(input) {
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
function validateReleaseBlockers(blockerCount) {
    if (blockerCount > 0) {
        return {
            status: 422,
            code: 'RELEASE_BLOCKED',
            message: `${blockerCount} release blocker${blockerCount === 1 ? '' : 's'} must be resolved.`,
        };
    }
    return null;
}
