// Departments are managed on Admin › Departments (stored in the database). A person's department is
// separate from their access role: it decides which menu areas they see open by default, and shows
// on their profile. People hold the department's key; company teams hold its name.
import { useQuery } from '@tanstack/react-query';
import api from './api';

/** A department key, e.g. "engineering". */
export type Department = string;

export type DepartmentOption = { id: string; key: string; name: string; parent_id: string | null; colour: string; is_active: boolean };

/** Every department (archived ones too), for pickers and labels. Open to everyone signed in. */
export const DEPARTMENT_OPTIONS_KEY = ['department-options'] as const;
export const useDepartmentOptions = (enabled = true) => useQuery({
  queryKey: DEPARTMENT_OPTIONS_KEY, enabled, staleTime: 5 * 60_000,
  queryFn: () => api.get('/people/departments').then(r => r.data.data as DepartmentOption[]),
});

/** Sub-departments after their parent, as "Engineering", "Engineering › Design". */
export function departmentLabels(list: DepartmentOption[]): Array<DepartmentOption & { label: string }> {
  const byId = new Map(list.map(d => [d.id, d]));
  const label = (d: DepartmentOption) => d.parent_id && byId.has(d.parent_id) ? `${byId.get(d.parent_id)!.name} › ${d.name}` : d.name;
  return list.map(d => ({ ...d, label: label(d) })).sort((a, b) => a.label.localeCompare(b.label));
}

/** The left menu's areas a department can open by default. */
export const NAV_AREA_LABELS: Record<string, string> = {
  'business-development': 'Business Development',
  procurement: 'Procurement',
  engineering: 'Engineering',
  management: 'Management',
  logistics: 'Logistics',
  factory: 'Factory',
};

/** Tailwind classes for each department colour: a chip and a dot. */
export const COLOUR_CLASSES: Record<string, { chip: string; dot: string }> = {
  slate: { chip: 'bg-slate-50 text-slate-700 border-slate-200', dot: 'bg-slate-500' },
  blue: { chip: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  sky: { chip: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500' },
  indigo: { chip: 'bg-indigo-50 text-indigo-700 border-indigo-200', dot: 'bg-indigo-500' },
  violet: { chip: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500' },
  emerald: { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  amber: { chip: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  orange: { chip: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  rose: { chip: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
  teal: { chip: 'bg-teal-50 text-teal-700 border-teal-200', dot: 'bg-teal-500' },
};
export const colourClasses = (colour: string | null | undefined) => COLOUR_CLASSES[colour ?? 'slate'] ?? COLOUR_CLASSES.slate;
