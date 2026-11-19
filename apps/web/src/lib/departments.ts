// Mirrors DEPARTMENTS in apps/api/src/routes/admin.ts. A department is separate from the
// access role: it only decides which navigation areas a person sees open by default.
export const DEPARTMENTS = ['engineering', 'business_development', 'procurement', 'management', 'logistics', 'factory'] as const;
export type Department = typeof DEPARTMENTS[number];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  engineering: 'Engineering',
  business_development: 'Business Development / Sales',
  procurement: 'Procurement',
  management: 'Management',
  logistics: 'Logistics',
  factory: 'Factory production',
};

/** Navigation area ids each department opens by default. `null` = every area open. */
export const DEPARTMENT_AREAS: Record<Department, string[] | null> = {
  engineering: ['engineering'],
  business_development: ['business-development'],
  procurement: ['procurement'],
  management: null,
  logistics: ['logistics'],
  factory: ['factory'],
};
