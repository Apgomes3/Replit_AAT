import type { PoolClient } from 'pg';

export const TAN_COEFFICIENT_UNIT = 'kg TAN-N/kg feed protein';
export const MEDIA_CAPACITY_BASIS_UNIT = 'g TAN-N/m³ media/day';
export const CONTROLLED_VALUE_TAN_PROFILE_CODE = 'SPECIES_AND_FEED_VALIDATED';

export const STARTER_TAN_PROFILES = [
  {
    profile_code: 'EBELING_TIMMONS_GENERAL_RAS',
    profile_name: 'Ebeling Timmons general RAS',
    coefficient: 0.09216,
    recommended_application: 'Default for teleost fish where no validated species data exist.',
  },
  {
    profile_code: 'LOSORDO_NITROGEN_RETENTION_MODEL',
    profile_name: 'Losordo nitrogen retention model',
    coefficient: 0.080,
    recommended_application: 'Less conservative production estimate.',
  },
  {
    profile_code: 'AAT_CONSERVATIVE_LEGACY',
    profile_name: 'AAT conservative legacy',
    coefficient: 0.0976,
    recommended_application: 'May remain as an AAT controlled design profile.',
  },
  {
    profile_code: 'EVENTUAL_DISSOLVED_NITROGEN',
    profile_name: 'Eventual dissolved nitrogen',
    coefficient: 0.1024,
    recommended_application: 'Includes the nitrogen assumed to be excreted as urea and later converted to TAN.',
  },
  {
    profile_code: CONTROLLED_VALUE_TAN_PROFILE_CODE,
    profile_name: 'Species and feed validated',
    coefficient: null,
    recommended_application: 'Requires an administrator-controlled, evidence-based value for the validated species and feed; no default is supplied.',
  },
  {
    profile_code: 'THEORETICAL_MAXIMUM',
    profile_name: 'Theoretical maximum',
    coefficient: 0.160,
    recommended_application: 'All feed protein nitrogen becoming TAN-N; normally unrealistically conservative.',
  },
] as const;

const PRELIMINARY_MEDIA_LABEL = 'Preliminary engineering reference — administrator review required';

export const BIOLOGICAL_MEDIA_EVIDENCE_REVIEW_STATUS = 'Review Needed';
export const BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT = 'g TAN-N/m³ media/day';
export const BIOLOGICAL_MEDIA_EVIDENCE_SURFACE_UNIT = 'g TAN-N/m² media/day';
export const BIOLOGICAL_MEDIA_EVIDENCE_LOADING_UNIT = 'g TAN-N/m³/day';

type EvidenceObservation = {
  observation_code: string;
  metric: string;
  unit: string;
  value?: number | null;
  value_min?: number | null;
  value_max?: number | null;
  uncertainty?: number | null;
  value_text?: string | null;
  qualifier: string;
  condition_label?: string | null;
  notes?: string | null;
};

type BiologicalMediaEvidence = {
  evidence_code: string;
  record_type: 'Observation' | 'Candidate Recommendation';
  evidence_classification: string;
  title: string;
  source_key: string;
  source_reference: string;
  candidate_profile_code?: string | null;
  reactor_type?: string | null;
  reactor_identity: string;
  media_identity?: string | null;
  water_type: string;
  temperature_condition: string;
  salinity_condition: string;
  tan_condition: string;
  media_ssa_m2_m3?: number | null;
  media_ssa_basis?: string | null;
  observed_metric: string;
  observed_unit: string;
  published_benchmark_value?: number | null;
  published_benchmark_text?: string | null;
  published_benchmark_unit?: string | null;
  recommended_value?: number | null;
  recommended_value_text?: string | null;
  recommended_value_unit?: string | null;
  curve_guidance?: Record<string, unknown>;
  required_operating_envelope?: string | null;
  intended_use: string;
  qualification: string;
  limitations: string;
  source_text: string;
  promotable: boolean;
  promotion_exclusion_reason?: string | null;
  observations: EvidenceObservation[];
  linked_evidence_codes?: Array<{ code: string; relationship: string }>;
};

const UNKNOWN_SOURCE = 'Not supplied in provided table';

export const STARTER_BIOLOGICAL_MEDIA_EVIDENCE: readonly BiologicalMediaEvidence[] = [
  {
    evidence_code: 'OBS_MARINE_COMMERCIAL_TRICKLING_FILTER',
    record_type: 'Observation',
    evidence_classification: 'Published observation',
    title: 'Commercial marine trickling filter',
    source_key: 'DIAZ_ET_AL_2012',
    source_reference: 'Díaz et al., 2012',
    reactor_type: 'Trickling filter',
    reactor_identity: 'Commercial marine trickling filter',
    media_identity: 'Crossflow media',
    water_type: 'Marine',
    temperature_condition: '16.3 to 28°C',
    salinity_condition: '29.8 to 32.2 ppt',
    tan_condition: 'Maximum occurs around 3.2 mg/L TAN',
    media_ssa_m2_m3: 160,
    media_ssa_basis: 'Media SSA supplied in water-and-reactor table',
    observed_metric: 'Surface rate and equivalent media-volume VTR',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_SURFACE_UNIT,
    published_benchmark_text: 'Maximum 0.64 g/m²/day, equivalent to 102 g/m³/day',
    published_benchmark_unit: BIOLOGICAL_MEDIA_EVIDENCE_SURFACE_UNIT,
    required_operating_envelope: 'Salinity 29.8 to 32.2 ppt; temperature 16.3 to 28°C',
    intended_use: 'Trace the full marine commercial result and its media-area conversion.',
    qualification: 'Maximum rate; the maximum occurs around 3.2 mg/L TAN.',
    limitations: 'A maximum result is not a universal media capacity or an automatic calculator value.',
    source_text: 'Full marine commercial result, but maximum occurs around 3.2 mg/L TAN',
    promotable: false,
    promotion_exclusion_reason: 'Published maximum requires engineering review and concentration-dependent use.',
    observations: [
      { observation_code: 'surface_maximum', metric: 'Measured surface rate', unit: 'g TAN-N/m²/day', value: 0.64, value_text: '0.64', qualifier: 'Maximum' },
      { observation_code: 'volume_equivalent', metric: 'Equivalent media-volume VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value: 102, value_text: '102', qualifier: 'Equivalent maximum' },
    ],
  },
  {
    evidence_code: 'OBS_MARINE_LAB_TRICKLING_FILTER',
    record_type: 'Observation',
    evidence_classification: 'Published observation',
    title: 'Laboratory marine trickling filter',
    source_key: 'DIAZ_ET_AL_2012',
    source_reference: 'Díaz et al., 2012',
    reactor_type: 'Trickling filter',
    reactor_identity: 'Laboratory marine trickling filter',
    media_identity: 'Marine trickling-filter media',
    water_type: 'Marine',
    temperature_condition: 'Approximately 24°C',
    salinity_condition: 'Seawater',
    tan_condition: 'Not supplied in provided table',
    media_ssa_m2_m3: 200,
    media_ssa_basis: 'Approximately 200 m²/m³',
    observed_metric: 'Surface rate and equivalent media-volume VTR',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_SURFACE_UNIT,
    published_benchmark_text: 'Maximum 0.28 g/m²/day, equivalent to 56 g/m³/day',
    published_benchmark_unit: BIOLOGICAL_MEDIA_EVIDENCE_SURFACE_UNIT,
    required_operating_envelope: 'Seawater; approximately 24°C',
    intended_use: 'Trace the conservative laboratory marine trickling result.',
    qualification: 'Maximum rate; more conservative marine trickling result.',
    limitations: 'A maximum result is not a universal media capacity.',
    source_text: 'More conservative marine trickling result',
    promotable: false,
    promotion_exclusion_reason: 'Observation remains review-only until tested conditions and media are confirmed.',
    observations: [
      { observation_code: 'surface_maximum', metric: 'Measured surface rate', unit: 'g TAN-N/m²/day', value: 0.28, value_text: '0.28', qualifier: 'Maximum' },
      { observation_code: 'volume_equivalent', metric: 'Equivalent media-volume VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value: 56, value_text: '56', qualifier: 'Equivalent maximum' },
    ],
  },
  {
    evidence_code: 'OBS_BRACKISH_MBBR_MB3',
    record_type: 'Observation',
    evidence_classification: 'Published replicated observation',
    title: 'Brackish moving bed — MB3 media',
    source_key: 'PFEIFFER_AND_WILLS',
    source_reference: 'Pfeiffer & Wills',
    reactor_type: 'Moving bed biofilter',
    reactor_identity: 'Brackish moving bed, MB3 media',
    media_identity: 'MB3',
    water_type: 'Brackish',
    temperature_condition: '24 to 25°C',
    salinity_condition: '11 to 12 ppt',
    tan_condition: 'Approximately 0.76 to 1.37 mg/L TAN',
    media_ssa_basis: 'Not supplied in provided table',
    observed_metric: 'Media-volume VTR',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    required_operating_envelope: '11 to 12 ppt; 24 to 25°C; TAN approximately 0.76 to 1.37 mg/L',
    intended_use: 'Trace product- and reactor-specific replicated brackish testing.',
    qualification: 'Lower-feed and higher-feed means with ± uncertainty.',
    limitations: 'Product and reactor specific result; not a universal MBBR capacity.',
    source_text: 'Product and reactor specific result',
    promotable: false,
    promotion_exclusion_reason: 'Requires media-specific engineering review before any profile promotion.',
    observations: [
      { observation_code: 'lower_feed', metric: 'Media-volume VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value: 92, uncertainty: 26, value_text: '92 ± 26', qualifier: 'Lower feed' },
      { observation_code: 'higher_feed', metric: 'Media-volume VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value: 186, uncertainty: 54, value_text: '186 ± 54', qualifier: 'Higher feed' },
    ],
  },
  {
    evidence_code: 'OBS_BRACKISH_MBBR_AMB',
    record_type: 'Observation',
    evidence_classification: 'Published replicated observation',
    title: 'Brackish moving bed — AMB media',
    source_key: 'PFEIFFER_AND_WILLS',
    source_reference: 'Pfeiffer & Wills',
    reactor_type: 'Moving bed biofilter',
    reactor_identity: 'Brackish moving bed, AMB media',
    media_identity: 'AMB',
    water_type: 'Brackish',
    temperature_condition: '24 to 25°C',
    salinity_condition: '11 to 12 ppt',
    tan_condition: 'Approximately 0.76 to 1.37 mg/L TAN',
    media_ssa_basis: 'Not supplied in provided table',
    observed_metric: 'Media-volume VTR',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    required_operating_envelope: 'Same conditions as MB3: 11 to 12 ppt; 24 to 25°C; TAN approximately 0.76 to 1.37 mg/L',
    intended_use: 'Trace product-specific replicated brackish testing.',
    qualification: 'Lower-feed and higher-feed means with ± uncertainty.',
    limitations: 'Product specific result; not a universal MBBR capacity.',
    source_text: 'Product specific result',
    promotable: false,
    promotion_exclusion_reason: 'Requires media-specific engineering review before any profile promotion.',
    observations: [
      { observation_code: 'lower_feed', metric: 'Media-volume VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value: 86, uncertainty: 28, value_text: '86 ± 28', qualifier: 'Lower feed' },
      { observation_code: 'higher_feed', metric: 'Media-volume VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value: 173, uncertainty: 48, value_text: '173 ± 48', qualifier: 'Higher feed' },
    ],
  },
  {
    evidence_code: 'OBS_BRACKISH_MBBR_K1',
    record_type: 'Observation',
    evidence_classification: 'Published replicated observation',
    title: 'Brackish moving bed — K1 media',
    source_key: 'PFEIFFER_AND_WILLS',
    source_reference: 'Pfeiffer & Wills',
    reactor_type: 'Moving bed biofilter',
    reactor_identity: 'Brackish moving bed, K1 media',
    media_identity: 'K1',
    water_type: 'Brackish',
    temperature_condition: '24 to 25°C',
    salinity_condition: '11 to 12 ppt',
    tan_condition: 'Approximately 0.76 to 1.37 mg/L TAN',
    media_ssa_basis: 'Not supplied in provided table',
    observed_metric: 'Media-volume VTR',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    required_operating_envelope: 'Same conditions as MB3: 11 to 12 ppt; 24 to 25°C; TAN approximately 0.76 to 1.37 mg/L',
    intended_use: 'Trace product-specific replicated brackish testing.',
    qualification: 'Lower-feed and higher-feed means with ± uncertainty.',
    limitations: 'Product specific result; not a universal MBBR capacity.',
    source_text: 'Product specific result',
    promotable: false,
    promotion_exclusion_reason: 'Requires media-specific engineering review before any profile promotion.',
    observations: [
      { observation_code: 'lower_feed', metric: 'Media-volume VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value: 83, uncertainty: 26, value_text: '83 ± 26', qualifier: 'Lower feed' },
      { observation_code: 'higher_feed', metric: 'Media-volume VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value: 140, uncertainty: 39, value_text: '140 ± 39', qualifier: 'Higher feed' },
    ],
  },
  {
    evidence_code: 'OBS_BRACKISH_RED_DRUM_MOVING_BEDS',
    record_type: 'Observation',
    evidence_classification: 'Published practical operating observation',
    title: 'Brackish red drum moving beds',
    source_key: 'UNSPECIFIED_RED_DRUM_REFERENCE',
    source_reference: UNKNOWN_SOURCE,
    reactor_type: 'Moving bed biofilter',
    reactor_identity: 'Brackish red drum moving beds',
    media_identity: 'Not supplied in provided table',
    water_type: 'Brackish',
    temperature_condition: '23.5 to 28.5°C',
    salinity_condition: 'Approximately 11 to 12 ppt',
    tan_condition: 'Approximately 0.35 to 0.74 mg/L TAN',
    media_ssa_basis: 'Not supplied in provided table',
    observed_metric: 'Media-volume VTR',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    required_operating_envelope: 'Approximately 11 to 12 ppt; 23.5 to 28.5°C; TAN approximately 0.35 to 0.74 mg/L',
    intended_use: 'Practical operating-range reference for red drum systems.',
    qualification: 'Average values approximately 39 to 87.',
    limitations: 'Useful practical range, not a universal capacity.',
    source_text: 'Useful practical operating range',
    promotable: false,
    promotion_exclusion_reason: 'System-level practical range requires engineering review before profile use.',
    observations: [
      { observation_code: 'practical_average_range', metric: 'Media-volume VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value_min: 39, value_max: 87, value_text: 'approximately 39 to 87', qualifier: 'Average values' },
    ],
  },
  {
    evidence_code: 'OBS_BRACKISH_POLYGEYSER_BEAD_FILTERS',
    record_type: 'Observation',
    evidence_classification: 'Published practical operating observation',
    title: 'Brackish Polygeyser bead filters',
    source_key: 'UNSPECIFIED_POLYGEYSER_REFERENCE',
    source_reference: UNKNOWN_SOURCE,
    reactor_type: 'Bead filter',
    reactor_identity: 'Brackish Polygeyser bead filters',
    media_identity: 'Polygeyser bead filter',
    water_type: 'Brackish',
    temperature_condition: 'Same red drum systems; not separately supplied',
    salinity_condition: 'Same red drum systems: approximately 11 to 12 ppt',
    tan_condition: 'Same red drum systems: approximately 0.35 to 0.74 mg/L TAN',
    media_ssa_basis: 'Not supplied in provided table',
    observed_metric: 'Media-volume VTR',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    required_operating_envelope: 'Same red drum systems',
    intended_use: 'Trace the combined solids and biological filtration result.',
    qualification: 'Average values approximately 77 to 181.',
    limitations: 'Combined solids and biological filtration; not directly comparable to media-only VTR.',
    source_text: 'Combined solids and biological filtration',
    promotable: false,
    promotion_exclusion_reason: 'Combined filtration result is not directly promotable as an Overall-VTR media profile.',
    observations: [
      { observation_code: 'practical_average_range', metric: 'Media-volume VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value_min: 77, value_max: 181, value_text: 'approximately 77 to 181', qualifier: 'Average values' },
    ],
  },
  {
    evidence_code: 'OBS_MARINE_MBBR_COMMISSIONING',
    record_type: 'Observation',
    evidence_classification: 'Published applied operating observation',
    title: 'Full marine moving bed during commissioning',
    source_key: 'KEUTER_ET_AL',
    source_reference: 'Keuter et al.',
    reactor_type: 'Moving bed biofilter',
    reactor_identity: 'Full marine moving bed during commissioning',
    media_identity: 'Marine-adapted media',
    water_type: 'Marine',
    temperature_condition: '17 to 22°C',
    salinity_condition: 'Approximately 29 to 34 ppt',
    tan_condition: 'Not supplied in provided table',
    media_ssa_m2_m3: 859,
    media_ssa_basis: 'SSA 859 m²/m³',
    observed_metric: 'Applied operating media-volume rate',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    required_operating_envelope: 'Approximately 29 to 34 ppt; 17 to 22°C; SSA 859 m²/m³',
    intended_use: 'Trace the low-load marine commissioning reference.',
    qualification: 'Applied operating rates approximately 13 to 22.',
    limitations: 'Low-load marine reference, not maximum capacity.',
    source_text: 'Low load marine reference, not maximum capacity',
    promotable: false,
    promotion_exclusion_reason: 'Commissioning rates support provisional concept guidance only.',
    observations: [
      { observation_code: 'commissioning_rate_range', metric: 'Applied operating rate', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value_min: 13, value_max: 22, value_text: 'approximately 13 to 22', qualifier: 'Applied operating rates' },
    ],
  },
  {
    evidence_code: 'OBS_INTENSIVE_MARINE_MOVING_BED',
    record_type: 'Observation',
    evidence_classification: 'Upper performance observation',
    title: 'Intensive marine moving bed',
    source_key: 'UNSPECIFIED_INTENSIVE_MARINE_REFERENCE',
    source_reference: UNKNOWN_SOURCE,
    reactor_type: 'Moving bed biofilter',
    reactor_identity: 'Intensive marine moving bed',
    media_identity: 'Not supplied in provided table',
    water_type: 'Marine',
    temperature_condition: 'Not supplied in provided table',
    salinity_condition: 'Approximately 40 ppt',
    tan_condition: 'High density sea bream production; TAN not supplied',
    media_ssa_basis: 'Not supplied in provided table',
    observed_metric: 'Media-volume VTR',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    required_operating_envelope: 'Approximately 40 ppt; high density sea bream production',
    intended_use: 'Retain the demonstrated upper-performance reference for review.',
    qualification: 'Rate reached 500; upper performance.',
    limitations: 'Not suitable as a general design value.',
    source_text: 'Demonstrated upper performance, not suitable as a general design value',
    promotable: false,
    promotion_exclusion_reason: 'Upper performance result is explicitly excluded from general design use.',
    observations: [
      { observation_code: 'upper_performance', metric: 'Media-volume VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value: 500, value_text: '500', qualifier: 'Rate reached; upper performance' },
    ],
  },
  {
    evidence_code: 'OBS_MARINE_FLUIDIZED_SAND',
    record_type: 'Observation',
    evidence_classification: 'Loading benchmark',
    title: 'Marine fluidized sand filter',
    source_key: 'UNSPECIFIED_FLUIDIZED_SAND_REFERENCE',
    source_reference: UNKNOWN_SOURCE,
    reactor_type: 'Fluidized sand filter',
    reactor_identity: 'Marine fluidized sand filter',
    media_identity: 'Fluidized sand',
    water_type: 'Marine',
    temperature_condition: '12 to 20°C',
    salinity_condition: 'Simulated seawater',
    tan_condition: 'TAN maintained around 0.45 to 1.26 mg/L',
    media_ssa_basis: 'Not supplied in provided table',
    observed_metric: 'Applied TAN load',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_LOADING_UNIT,
    required_operating_envelope: 'Simulated seawater; 12 to 20°C; TAN around 0.45 to 1.26 mg/L',
    intended_use: 'Retain as a loading benchmark for engineering review.',
    qualification: 'Applied TAN load of 500 g/m³/day.',
    limitations: 'This is a loading benchmark, not necessarily actual VTR.',
    source_text: 'This is a loading benchmark, not necessarily actual VTR',
    promotable: false,
    promotion_exclusion_reason: 'Loading benchmark is explicitly excluded from direct Overall-VTR promotion.',
    observations: [
      { observation_code: 'applied_tan_load', metric: 'Applied TAN load', unit: BIOLOGICAL_MEDIA_EVIDENCE_LOADING_UNIT, value: 500, value_text: '500', qualifier: 'Loading benchmark' },
    ],
  },
  {
    evidence_code: 'REC_FW_TF_25C',
    record_type: 'Candidate Recommendation',
    evidence_classification: 'Review-only candidate recommendation',
    title: 'Recommended freshwater trickling-filter profile',
    source_key: 'LOSORDO_AND_DELONG',
    source_reference: 'Losordo & DeLong',
    candidate_profile_code: 'FW_TF_25C',
    reactor_type: 'Trickling filter',
    reactor_identity: 'Freshwater trickling filter',
    media_identity: 'Plastic media approximately 200 m²/m³',
    water_type: 'Freshwater',
    temperature_condition: '25°C',
    salinity_condition: 'Freshwater; 0 ppt assumed by water type, not separately supplied',
    tan_condition: 'Reference TAN 2 mg/L',
    media_ssa_m2_m3: 200,
    media_ssa_basis: 'Approximately 200 m²/m³',
    observed_metric: 'Overall VTR',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    published_benchmark_value: 90,
    published_benchmark_text: '90',
    published_benchmark_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    recommended_value: 90,
    recommended_value_text: '90',
    recommended_value_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    required_operating_envelope: '25°C, pH 7.2, alkalinity ≥100 mg/L as CaCO₃, DO ≥4 mg/L, reference TAN 2 mg/L, mature biofilm',
    intended_use: 'Candidate Release 1 calculator reference, pending administrator review.',
    qualification: 'Published benchmark and recommended calculator value are both 90.',
    limitations: 'Must not be treated as a universal media capacity; actual media, hydraulics, and evidence require review.',
    source_text: 'Freshwater values come from the Losordo and DeLong sizing example under its stated operating conditions.',
    promotable: false,
    promotion_exclusion_reason: 'Candidate recommendation remains unapproved review evidence.',
    observations: [{ observation_code: 'recommended_rate', metric: 'Overall VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value: 90, value_text: '90', qualifier: 'Recommended calculator value' }],
  },
  {
    evidence_code: 'REC_FW_MBBR_25C',
    record_type: 'Candidate Recommendation',
    evidence_classification: 'Review-only candidate recommendation',
    title: 'Recommended freshwater MBBR profile',
    source_key: 'LOSORDO_AND_DELONG',
    source_reference: 'Losordo & DeLong',
    candidate_profile_code: 'FW_MBBR_25C',
    reactor_type: 'Moving bed biofilter',
    reactor_identity: 'Freshwater MBBR',
    media_identity: 'Not supplied in provided table',
    water_type: 'Freshwater',
    temperature_condition: '25°C',
    salinity_condition: 'Freshwater; 0 ppt assumed by water type, not separately supplied',
    tan_condition: 'Reference TAN 2 mg/L',
    media_ssa_basis: 'Not supplied in provided table',
    observed_metric: 'Overall VTR',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    published_benchmark_value: 350,
    published_benchmark_text: '350',
    published_benchmark_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    recommended_value: 350,
    recommended_value_text: '350',
    recommended_value_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    required_operating_envelope: '25°C, pH 7.2, alkalinity ≥100 mg/L as CaCO₃, DO ≥4 mg/L, reference TAN 2 mg/L, mature adapted biofilm, correctly mixed and aerated',
    intended_use: 'Candidate Release 1 calculator reference, pending administrator review.',
    qualification: 'Published benchmark and recommended calculator value are both 350.',
    limitations: 'Must not be treated as a universal media capacity. Kinyage et al.: abrupt exposure of freshwater MBBR media to 25 ppt or more caused complete short-term inhibition.',
    source_text: 'Freshwater values come from the Losordo and DeLong sizing example under its stated operating conditions. A freshwater biofilm must never automatically inherit a marine profile.',
    promotable: false,
    promotion_exclusion_reason: 'Candidate recommendation remains unapproved review evidence.',
    observations: [{ observation_code: 'recommended_rate', metric: 'Overall VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value: 350, value_text: '350', qualifier: 'Recommended calculator value' }],
  },
  {
    evidence_code: 'REC_BW_MBBR_LOW',
    record_type: 'Candidate Recommendation',
    evidence_classification: 'Review-only candidate recommendation',
    title: 'Recommended brackish MBBR low-load profile',
    source_key: 'PFEIFFER_AND_WILLS',
    source_reference: 'Pfeiffer & Wills',
    candidate_profile_code: 'BW_MBBR_LOW',
    reactor_type: 'Moving bed biofilter',
    reactor_identity: 'Brackish MBBR, 11–12 ppt',
    media_identity: 'MB3, AMB, and K1 test media',
    water_type: 'Brackish',
    temperature_condition: '24 to 25°C',
    salinity_condition: '11 to 12 ppt',
    tan_condition: 'Inlet TAN 0.55 to 0.93 mg/L',
    media_ssa_basis: 'Not supplied in provided table',
    observed_metric: 'Overall VTR',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    published_benchmark_text: '82.5–92.2',
    published_benchmark_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    recommended_value: 80,
    recommended_value_text: '80',
    recommended_value_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    required_operating_envelope: '24–25°C, 11–12 ppt, inlet TAN 0.55–0.93 mg/L, mature adapted media',
    intended_use: 'Candidate Release 1 calculator reference, pending administrator review.',
    qualification: 'Published low-load means were 92.2, 86.1, and 82.5; recommended calculator value is 80.',
    limitations: 'Based on replicated MB3, AMB, and K1 testing; product and reactor specific.',
    source_text: 'The brackish values are based on replicated testing of MB3, AMB and K1 media at 11–12 ppt.',
    promotable: false,
    promotion_exclusion_reason: 'Candidate recommendation remains unapproved review evidence.',
    linked_evidence_codes: [
      { code: 'OBS_BRACKISH_MBBR_MB3', relationship: 'source observation' },
      { code: 'OBS_BRACKISH_MBBR_AMB', relationship: 'source observation' },
      { code: 'OBS_BRACKISH_MBBR_K1', relationship: 'source observation' },
    ],
    observations: [{ observation_code: 'recommended_rate', metric: 'Overall VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value: 80, value_text: '80', qualifier: 'Recommended calculator value' }],
  },
  {
    evidence_code: 'REC_BW_MBBR_MODERATE',
    record_type: 'Candidate Recommendation',
    evidence_classification: 'Review-only candidate recommendation',
    title: 'Recommended brackish MBBR moderate-load profile',
    source_key: 'PFEIFFER_AND_WILLS',
    source_reference: 'Pfeiffer & Wills',
    candidate_profile_code: 'BW_MBBR_MODERATE',
    reactor_type: 'Moving bed biofilter',
    reactor_identity: 'Brackish MBBR, 11–12 ppt',
    media_identity: 'MB3, AMB, and K1 test media',
    water_type: 'Brackish',
    temperature_condition: '24 to 25°C',
    salinity_condition: '11 to 12 ppt',
    tan_condition: 'Inlet TAN 0.83 to 1.87 mg/L',
    media_ssa_basis: 'Not supplied in provided table',
    observed_metric: 'Overall VTR',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    published_benchmark_text: '139.9–186.4',
    published_benchmark_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    recommended_value: 140,
    recommended_value_text: '140',
    recommended_value_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    required_operating_envelope: '24–25°C, 11–12 ppt, inlet TAN 0.83–1.87 mg/L, sustained loading',
    intended_use: 'Candidate Release 1 calculator reference, pending administrator review.',
    qualification: 'Published higher-load means were 186.4, 172.9, and 139.9; recommended calculator value is 140.',
    limitations: 'Based on replicated MB3, AMB, and K1 testing; product and reactor specific.',
    source_text: 'The brackish values are based on replicated testing of MB3, AMB and K1 media at 11–12 ppt.',
    promotable: false,
    promotion_exclusion_reason: 'Candidate recommendation remains unapproved review evidence.',
    linked_evidence_codes: [
      { code: 'OBS_BRACKISH_MBBR_MB3', relationship: 'source observation' },
      { code: 'OBS_BRACKISH_MBBR_AMB', relationship: 'source observation' },
      { code: 'OBS_BRACKISH_MBBR_K1', relationship: 'source observation' },
    ],
    observations: [{ observation_code: 'recommended_rate', metric: 'Overall VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value: 140, value_text: '140', qualifier: 'Recommended calculator value' }],
  },
  {
    evidence_code: 'REC_SW_TF_CONSERVATIVE_NIJHOF_CURVE',
    record_type: 'Candidate Recommendation',
    evidence_classification: 'Review-only lookup-curve recommendation',
    title: 'Recommended conservative marine trickling-filter curve',
    source_key: 'DIAZ_ET_AL_2012',
    source_reference: 'Díaz et al., 2012; Nijhof relationship reproduced and compared in Díaz et al.',
    candidate_profile_code: 'SW_TF_CONSERVATIVE',
    reactor_type: 'Trickling filter',
    reactor_identity: 'Full marine trickling filter',
    media_identity: 'Comparable media approximately 200 m²/m³',
    water_type: 'Marine',
    temperature_condition: 'Not supplied for the conservative relationship',
    salinity_condition: 'Seawater / marine-adapted',
    tan_condition: 'Inlet TAN 0.25 to 3.0 mg/L; below approximately 0.25 mg/L needs validation',
    media_ssa_m2_m3: 200,
    media_ssa_basis: 'Comparable media approximately 200 m²/m³',
    observed_metric: 'Surface-rate lookup curve and derived VTR',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    published_benchmark_text: 'Concentration-dependent curve',
    recommended_value_text: 'Use Nijhof curve below',
    recommended_value_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    curve_guidance: {
      curve_name: 'Nijhof conservative marine curve',
      equation: 'STR=min(0.28, 0.23*sqrt(C_TAN,in)-0.11); VTR=STR*200',
      basis_area_m2_m3: 200,
      below_threshold_note: 'Below approximately 0.25 mg/L, return “validated rate required”; never zero or extrapolation.',
      default_selection: 'Conservative default',
    },
    required_operating_envelope: 'Marine-adapted mature biofilm; comparable media approximately 200 m²/m³; inlet TAN 0.25–3.0 mg/L',
    intended_use: 'Candidate Release 1 conservative marine curve recommendation, pending administrator review.',
    qualification: 'Conservative Nijhof relationship; distinct from the commercial Díaz curve.',
    limitations: 'Review note only; this recommendation does not activate marine calculator behavior.',
    source_text: 'For a conservative default, use the Nijhof seawater relationship reproduced and compared in Díaz et al.',
    promotable: false,
    promotion_exclusion_reason: 'Curve guidance requires engineering review and is not an approved calculator selector.',
    linked_evidence_codes: [
      { code: 'OBS_MARINE_LAB_TRICKLING_FILTER', relationship: 'related marine observation' },
    ],
    observations: [
      ...[
        ['0.30 mg/L', 3.2], ['0.50 mg/L', 10.5], ['0.75 mg/L', 17.8], ['1.00 mg/L', 24.0],
        ['1.50 mg/L', 34.3], ['2.00 mg/L', 43.1], ['3.00 mg/L', 56.0], ['≥3.20 mg/L', 56.0],
      ].map(([condition, value]) => ({
        observation_code: `curve_${String(condition).replace(/[^0-9]+/g, '_')}`,
        metric: 'Conservative marine VTR curve point',
        unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
        value: value as number,
        value_text: String(value),
        qualifier: 'Lookup-curve recommendation',
        condition_label: String(condition),
      })),
    ],
  },
  {
    evidence_code: 'REC_SW_TF_COMMERCIAL_DIAZ_CURVE',
    record_type: 'Candidate Recommendation',
    evidence_classification: 'Review-only lookup-curve recommendation',
    title: 'Recommended commercial marine trickling-filter curve',
    source_key: 'DIAZ_ET_AL_2012',
    source_reference: 'Díaz et al., 2012',
    candidate_profile_code: 'SW_TF_COMMERCIAL',
    reactor_type: 'Trickling filter',
    reactor_identity: 'Full marine commercial trickling filter',
    media_identity: 'Crossflow media approximately 160 m²/m³',
    water_type: 'Marine',
    temperature_condition: '16.3 to 28°C',
    salinity_condition: '29.8 to 32.2 ppt',
    tan_condition: 'Inlet TAN 0.25 to 3.0 mg/L; below approximately 0.25 mg/L needs validation',
    media_ssa_m2_m3: 160,
    media_ssa_basis: 'Crossflow media approximately 160 m²/m³',
    observed_metric: 'Surface-rate lookup curve and derived VTR',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    published_benchmark_text: 'Concentration-dependent curve',
    recommended_value_text: 'Use Díaz curve with engineer approval',
    recommended_value_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    curve_guidance: {
      curve_name: 'Díaz commercial marine curve',
      equation: 'STR=min(0.64, 0.49*sqrt(C_TAN,in)-0.24); VTR=STR*160',
      basis_area_m2_m3: 160,
      below_threshold_note: 'Below approximately 0.25 mg/L, return “validated rate required”; never zero or extrapolation.',
      selection_requirement: 'Engineer selection required',
      distinction: 'Particular full-scale system and media configuration; not a general default.',
    },
    required_operating_envelope: '29.8–32.2 ppt, 16.3–28°C, pH 6.51–7.57, low organic loading',
    intended_use: 'Candidate Release 1 commercial marine curve recommendation, pending engineer review.',
    qualification: 'Commercial Díaz curve; engineer-selected and distinct from the conservative Nijhof curve.',
    limitations: 'Particular full-scale system and media configuration; not the default calculator curve.',
    source_text: 'The commercial Díaz curve should require engineer selection because it came from a particular full-scale system and media configuration.',
    promotable: false,
    promotion_exclusion_reason: 'Engineer approval required; curve guidance is not an approved calculator selector.',
    linked_evidence_codes: [
      { code: 'OBS_MARINE_COMMERCIAL_TRICKLING_FILTER', relationship: 'related marine observation' },
    ],
    observations: [
      ...[
        ['0.30 mg/L', 4.5], ['0.50 mg/L', 17.0], ['0.75 mg/L', 29.5], ['1.00 mg/L', 40.0],
        ['1.50 mg/L', 57.6], ['2.00 mg/L', 72.5], ['3.00 mg/L', 97.4], ['≥3.20 mg/L', 102.4],
      ].map(([condition, value]) => ({
        observation_code: `curve_${String(condition).replace(/[^0-9]+/g, '_')}`,
        metric: 'Commercial Díaz marine VTR curve point',
        unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
        value: value as number,
        value_text: String(value),
        qualifier: 'Lookup-curve recommendation',
        condition_label: String(condition),
      })),
    ],
  },
  {
    evidence_code: 'REC_SW_MBBR_LOW_TAN',
    record_type: 'Candidate Recommendation',
    evidence_classification: 'Review-only provisional concept design',
    title: 'Recommended full marine MBBR low-TAN concept profile',
    source_key: 'KEUTER_ET_AL',
    source_reference: 'Keuter et al.',
    candidate_profile_code: 'SW_MBBR_LOW_TAN',
    reactor_type: 'Moving bed biofilter',
    reactor_identity: 'Full marine MBBR for aquarium-type low loading',
    media_identity: 'Marine-adapted media',
    water_type: 'Marine',
    temperature_condition: '17 to 22°C',
    salinity_condition: 'Approximately 29 to 34 ppt',
    tan_condition: 'Low-TAN public aquarium concept sizing; TAN value not supplied',
    media_ssa_m2_m3: 859,
    media_ssa_basis: 'Total surface area 859 m²/m³',
    observed_metric: 'Overall VTR',
    observed_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    published_benchmark_text: 'Approximately 13–22',
    published_benchmark_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    recommended_value: 15,
    recommended_value_text: '15',
    recommended_value_unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT,
    required_operating_envelope: 'Approximately 29–34 ppt, 17–22°C, pH around 7.5, marine-adapted media',
    intended_use: 'Provisional Release 1 low-TAN public aquarium concept sizing only.',
    qualification: 'Provisional value based on commissioning rates approximately 13–22 g/m³ media/day.',
    limitations: 'Concept design only; marine-adapted mature media required; manufacturer data or pilot testing required for final design; separate nitrite-capacity verification required.',
    source_text: 'This value should be marked: Concept design only; Marine-adapted mature media required; Manufacturer data or pilot testing required for final design; Separate nitrite-capacity verification required.',
    promotable: false,
    promotion_exclusion_reason: 'Provisional concept guidance is not promotable without manufacturer data, pilot testing, and nitrite verification.',
    linked_evidence_codes: [
      { code: 'OBS_MARINE_MBBR_COMMISSIONING', relationship: 'source observation' },
    ],
    observations: [{ observation_code: 'recommended_rate', metric: 'Overall VTR', unit: BIOLOGICAL_MEDIA_EVIDENCE_VTR_UNIT, value: 15, value_text: '15', qualifier: 'Provisional concept design recommendation' }],
  },
];

export const STARTER_MEDIA_PROFILES = [
  {
    profile_code: 'FW_TF_25C',
    profile_name: 'Freshwater trickling filter — 200 m²/m³ plastic media',
    water_types: ['Freshwater'],
    reactor_types: ['Trickling filter'],
    overall_vtr_g_tan_n_m3_d: 90,
    operating_min_temperature_c: 25,
    operating_max_temperature_c: 25,
    operating_min_salinity_ppt: 0,
    operating_max_salinity_ppt: 0,
    operating_min_ph: 7.2,
    operating_max_ph: 7.2,
    operating_min_tan_mg_n_l: 2,
    operating_max_tan_mg_n_l: 2,
    operating_min_do_mg_l: 4,
    operating_max_do_mg_l: null,
    media_fill_fraction: null,
    provisional_label: PRELIMINARY_MEDIA_LABEL,
    notes: 'Conservative tested-condition reference only: warm freshwater at 25°C, pH 7.2, reference TAN 2 mg N/L, alkalinity ≥100 mg/L as CaCO₃, DO ≥4 mg/L, mature biofilm, and plastic media approximately 200 m²/m³. Not a universal media capacity; confirm the actual media, hydraulics, and evidence before approval.',
  },
  {
    profile_code: 'FW_MBBR_25C',
    profile_name: 'Freshwater MBBR — warm-water reference',
    water_types: ['Freshwater'],
    reactor_types: ['Moving bed biofilter', 'MBBR'],
    overall_vtr_g_tan_n_m3_d: 350,
    operating_min_temperature_c: 25,
    operating_max_temperature_c: 25,
    operating_min_salinity_ppt: 0,
    operating_max_salinity_ppt: 0,
    operating_min_ph: 7.2,
    operating_max_ph: 7.2,
    operating_min_tan_mg_n_l: 2,
    operating_max_tan_mg_n_l: 2,
    operating_min_do_mg_l: 4,
    operating_max_do_mg_l: null,
    media_fill_fraction: 0.7,
    provisional_label: PRELIMINARY_MEDIA_LABEL,
    notes: 'Tested-condition reference only: warm freshwater at 25°C, pH 7.2, reference TAN 2 mg N/L, alkalinity ≥100 mg/L as CaCO₃, DO ≥4 mg/L, mature biofilm, correct mixing and aeration, and reactor media fill no greater than 70%. Not a universal MBBR capacity; confirm the actual media and hydraulics before approval.',
  },
  {
    profile_code: 'FW_FB_8C_200',
    profile_name: 'Cold freshwater fixed bed — 200 m²/m³ media',
    water_types: ['Freshwater'],
    reactor_types: ['Fixed bed biofilter'],
    overall_vtr_g_tan_n_m3_d: 92,
    operating_min_temperature_c: 8,
    operating_max_temperature_c: 8,
    operating_min_salinity_ppt: 0,
    operating_max_salinity_ppt: 0,
    operating_min_ph: null,
    operating_max_ph: null,
    operating_min_tan_mg_n_l: 2.79,
    operating_max_tan_mg_n_l: 2.99,
    operating_min_do_mg_l: null,
    operating_max_do_mg_l: null,
    media_fill_fraction: null,
    provisional_label: PRELIMINARY_MEDIA_LABEL,
    notes: 'Conservative study-condition reference only: cold freshwater at 8°C, fixed Bioblok polyethylene media at 200 m²/m³, conditioned inlet TAN 2.89 ± 0.10 mg N/L, mature biofilm after approximately 3.5 months, and study flow 1–4 L/s. pH and alkalinity were not supplied for this seed; do not broaden the tested point or treat it as universal capacity.',
  },
  {
    profile_code: 'FW_MB_8C_850',
    profile_name: 'Cold freshwater moving bed — 850 m²/m³ media',
    water_types: ['Freshwater'],
    reactor_types: ['Moving bed biofilter'],
    overall_vtr_g_tan_n_m3_d: 231,
    operating_min_temperature_c: 8,
    operating_max_temperature_c: 8,
    operating_min_salinity_ppt: 0,
    operating_max_salinity_ppt: 0,
    operating_min_ph: null,
    operating_max_ph: null,
    operating_min_tan_mg_n_l: 2.79,
    operating_max_tan_mg_n_l: 2.99,
    operating_min_do_mg_l: null,
    operating_max_do_mg_l: null,
    media_fill_fraction: null,
    provisional_label: PRELIMINARY_MEDIA_LABEL,
    notes: 'Approximate study-condition reference only: approximately 231 g TAN-N/m³ media/day in cold freshwater at 8°C, moving Biomedia polypropylene carriers at 850 m²/m³, conditioned inlet TAN 2.89 ± 0.10 mg N/L, mature biofilm after approximately 3.5 months, and study flow 1–4 L/s. pH and alkalinity were not supplied for this seed; do not treat this maximum-rate study result as universal design capacity.',
  },
] as const;

/**
 * Seeds only the first revision for each stable starter code. The conflict
 * target deliberately does not update any column, so later administrator
 * revisions and edits can never be overwritten by a rerun.
 */
export async function seedTanGenerationProfiles(client: PoolClient, adminId: string | null): Promise<number> {
  let seeded = 0;
  for (const profile of STARTER_TAN_PROFILES) {
    const result = await client.query(
      `INSERT INTO lss_tan_generation_profiles
       (profile_code, profile_name, revision, coefficient, coefficient_unit,
        recommended_application, scope_type, evidence_reference, status, notes, created_by)
       VALUES ($1, $2, 1, $3, $4, $5, $6, NULL, 'Draft', $7, $8)
       ON CONFLICT (profile_code, revision) DO NOTHING`,
      [
        profile.profile_code,
        profile.profile_name,
        profile.coefficient,
        TAN_COEFFICIENT_UNIT,
        profile.recommended_application,
        'Pending administrator review',
        'Starter reference — controlled evidence and scope required before approval.',
        adminId,
      ],
    );
    seeded += result.rowCount || 0;
  }
  return seeded;
}

/**
 * Seeds only revision one for each stable media-profile code. Conflicts are
 * intentionally ignored so reruns cannot overwrite an administrator's draft
 * edits, status changes, or later revisions.
 */
export async function seedBiologicalMediaProfiles(client: PoolClient, adminId: string | null): Promise<number> {
  let seeded = 0;
  for (const profile of STARTER_MEDIA_PROFILES) {
    const result = await client.query(
      `INSERT INTO lss_biological_media_profiles
       (profile_code, profile_name, revision, water_types, reactor_types,
        capacity_model, capacity_model_version, capacity_basis_unit,
        operating_min_temperature_c, operating_max_temperature_c,
        operating_min_salinity_ppt, operating_max_salinity_ppt,
        overall_vtr_g_tan_n_m3_d, media_fill_fraction,
        operating_min_ph, operating_max_ph,
        operating_min_tan_mg_n_l, operating_max_tan_mg_n_l,
        operating_min_do_mg_l, operating_max_do_mg_l,
        evidence_reference, is_provisional, provisional_label, status, notes, created_by)
       VALUES ($1,$2,1,$3,$4,'OVERALL_VTR','1',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
        NULL,true,$18,'Draft',$19,$20)
       ON CONFLICT (profile_code, revision) DO NOTHING`,
      [
        profile.profile_code,
        profile.profile_name,
        profile.water_types,
        profile.reactor_types,
        MEDIA_CAPACITY_BASIS_UNIT,
        profile.operating_min_temperature_c,
        profile.operating_max_temperature_c,
        profile.operating_min_salinity_ppt,
        profile.operating_max_salinity_ppt,
        profile.overall_vtr_g_tan_n_m3_d,
        profile.media_fill_fraction,
        profile.operating_min_ph,
        profile.operating_max_ph,
        profile.operating_min_tan_mg_n_l,
        profile.operating_max_tan_mg_n_l,
        profile.operating_min_do_mg_l,
        profile.operating_max_do_mg_l,
        profile.provisional_label,
        profile.notes,
        adminId,
      ],
    );
    seeded += result.rowCount || 0;
  }
  return seeded;
}

/**
 * Seeds review-only evidence and its child observations. Every insert is
 * conflict-safe and never updates a source, record, observation, or link, so
 * later review notes and administrator data survive reruns.
 */
export async function seedBiologicalMediaEvidence(client: PoolClient): Promise<number> {
  const sourceIds = new Map<string, string>();
  const recordIds = new Map<string, string>();
  let seeded = 0;

  for (const evidence of STARTER_BIOLOGICAL_MEDIA_EVIDENCE) {
    const sourceInsert = await client.query(
      `INSERT INTO lss_biological_media_evidence_sources (source_key, citation)
       VALUES ($1,$2) ON CONFLICT (source_key) DO NOTHING RETURNING id`,
      [evidence.source_key, evidence.source_reference],
    );
    const sourceId = sourceInsert.rows[0]?.id
      || (await client.query(
        `SELECT id FROM lss_biological_media_evidence_sources WHERE source_key=$1`,
        [evidence.source_key],
      )).rows[0]?.id;
    if (!sourceId) throw new Error(`Unable to resolve evidence source ${evidence.source_key}`);
    sourceIds.set(evidence.source_key, sourceId);

    const recordInsert = await client.query(
      `INSERT INTO lss_biological_media_evidence_records
       (evidence_code, revision, record_type, evidence_classification, title, source_id, source_reference,
        candidate_profile_code, reactor_type, reactor_identity, media_identity, water_type,
        temperature_condition, salinity_condition, tan_condition, media_ssa_m2_m3, media_ssa_basis,
        observed_metric, observed_unit, published_benchmark_value, published_benchmark_text,
        published_benchmark_unit, recommended_value, recommended_value_text, recommended_value_unit,
        curve_guidance, required_operating_envelope, intended_use, qualification, limitations, source_text,
        review_status, is_approved, promotable, promotion_exclusion_reason)
       VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
               'Review Needed',false,$31,$32)
       ON CONFLICT (evidence_code, revision) DO NOTHING RETURNING id`,
      [
        evidence.evidence_code, evidence.record_type, evidence.evidence_classification, evidence.title,
        sourceId, evidence.source_reference, evidence.candidate_profile_code || null, evidence.reactor_type || null,
        evidence.reactor_identity, evidence.media_identity || null, evidence.water_type, evidence.temperature_condition,
        evidence.salinity_condition, evidence.tan_condition, evidence.media_ssa_m2_m3 || null, evidence.media_ssa_basis || null,
        evidence.observed_metric, evidence.observed_unit, evidence.published_benchmark_value || null,
        evidence.published_benchmark_text || null, evidence.published_benchmark_unit || null, evidence.recommended_value || null,
        evidence.recommended_value_text || null, evidence.recommended_value_unit || null, evidence.curve_guidance || {},
        evidence.required_operating_envelope || null, evidence.intended_use, evidence.qualification, evidence.limitations,
        evidence.source_text, evidence.promotable, evidence.promotion_exclusion_reason || null,
      ],
    );
    const recordId = recordInsert.rows[0]?.id
      || (await client.query(
        `SELECT id FROM lss_biological_media_evidence_records WHERE evidence_code=$1 AND revision=1`,
        [evidence.evidence_code],
      )).rows[0]?.id;
    if (!recordId) throw new Error(`Unable to resolve evidence record ${evidence.evidence_code}`);
    recordIds.set(evidence.evidence_code, recordId);
    seeded += recordInsert.rowCount || 0;

    for (const observation of evidence.observations) {
      await client.query(
        `INSERT INTO lss_biological_media_evidence_observations
         (evidence_record_id, observation_code, metric, unit, value, value_min, value_max,
          uncertainty, value_text, qualifier, condition_label, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (evidence_record_id, observation_code) DO NOTHING`,
        [
          recordId, observation.observation_code, observation.metric, observation.unit,
          observation.value ?? null, observation.value_min ?? null, observation.value_max ?? null,
          observation.uncertainty ?? null, observation.value_text ?? null, observation.qualifier,
          observation.condition_label ?? null, observation.notes ?? null,
        ],
      );
    }
  }

  for (const evidence of STARTER_BIOLOGICAL_MEDIA_EVIDENCE) {
    for (const link of evidence.linked_evidence_codes || []) {
      const recordId = recordIds.get(evidence.evidence_code);
      const linkedId = recordIds.get(link.code);
      if (!recordId || !linkedId) throw new Error(`Unable to resolve evidence link ${evidence.evidence_code} -> ${link.code}`);
      await client.query(
        `INSERT INTO lss_biological_media_evidence_links
         (evidence_record_id, linked_evidence_record_id, relationship)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [recordId, linkedId, link.relationship],
      );
    }
  }

  return seeded;
}

export const seedVtrEvidence = seedBiologicalMediaEvidence;