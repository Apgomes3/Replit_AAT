import { Package, BookOpen, FileText, Users, Upload, Boxes, Pipette, Container, Ruler, ClipboardList, Layers, GitBranch, DollarSign, Activity, Sun, Wind, SlidersHorizontal, Building2, Network, ListTree } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { User } from '../types';
import { isEditorRole } from './roles';

/**
 * The one list of admin (settings & data) pages. The Platform Admin popup reads it today;
 * the admin landing page, breadcrumbs and search will read it too. Adding a page = one entry.
 */
export type AdminDomain = 'engineering' | 'business_development' | 'procurement' | 'management' | 'logistics' | 'factory' | 'platform';

export const ADMIN_DOMAIN_LABELS: Record<AdminDomain, string> = {
  engineering: 'Engineering',
  business_development: 'Business Development',
  procurement: 'Procurement',
  management: 'Management',
  logistics: 'Logistics',
  factory: 'Factory',
  platform: 'Platform',
};

/** Popup headings, kept as they were until the landing page replaces them. */
export type AdminPopupGroup = 'Library' | 'Documents' | 'Order Management' | 'System';
export const ADMIN_POPUP_GROUPS: AdminPopupGroup[] = ['Library', 'Documents', 'Order Management', 'System'];

/** Who may open an entry besides admins: editors with this module access level. */
export type AdminAccess = { module: 'design_books' | 'orders'; level: 'manage' };
const ENGINEERING_SETTINGS: AdminAccess = { module: 'design_books', level: 'manage' };

export type AdminEntry = {
  id: string;
  to: string;
  icon: LucideIcon;
  label: string;
  description: string;
  domain: AdminDomain;
  /** Sub-heading inside the domain, e.g. "Engineering data". */
  group: string;
  popupGroup: AdminPopupGroup;
  keywords?: string[];
  end?: boolean;
  access?: AdminAccess;
};

export const ADMIN_ENTRIES: AdminEntry[] = [
  { id: 'families', to: '/products', end: true, icon: Package, label: 'Families', description: 'Product families and their attribute sets.', domain: 'engineering', group: 'Catalogues', popupGroup: 'Library', keywords: ['products', 'pim'] },
  { id: 'materials', to: '/knowledge/materials', icon: BookOpen, label: 'Materials', description: 'Material library used by specifications and products.', domain: 'engineering', group: 'Knowledge', popupGroup: 'Library' },
  { id: 'specifications', to: '/knowledge/specifications', icon: BookOpen, label: 'Specifications', description: 'Technical specifications and standards.', domain: 'engineering', group: 'Knowledge', popupGroup: 'Library' },
  { id: 'design-rules', to: '/knowledge/design-rules', icon: Ruler, label: 'Design Rules', description: 'Rules the design tools check against.', domain: 'engineering', group: 'Knowledge', popupGroup: 'Library' },
  { id: 'document-register', to: '/documents', icon: FileText, label: 'Document Register', description: 'Controlled documents and revisions.', domain: 'platform', group: 'Documents', popupGroup: 'Documents' },
  { id: 'tank-families', to: '/admin/tank-families', icon: Container, label: 'Tank Families', description: 'Tank classification families.', domain: 'engineering', group: 'Catalogues', popupGroup: 'Library', keywords: ['tanks'] },
  { id: 'tank-cost-rates', to: '/admin/tank-cost-rates', icon: DollarSign, label: 'Tank Cost Rates', description: 'Rates used for tank cost estimates.', domain: 'engineering', group: 'Costing', popupGroup: 'Library', keywords: ['price', 'tanks'] },
  { id: 'exchange-rates', to: '/admin/exchange-rates', icon: DollarSign, label: 'Exchange Rates', description: 'Currency rates for quotes and orders.', domain: 'management', group: 'Finance', popupGroup: 'Library', keywords: ['currency', 'fx'] },
  { id: 'system-types', to: '/admin/system-types', icon: Layers, label: 'System Types', description: 'Life-support system types for design books.', domain: 'engineering', group: 'Engineering data', popupGroup: 'Library', access: ENGINEERING_SETTINGS },
  { id: 'pump-duty-types', to: '/admin/pump-duty-types', icon: Pipette, label: 'Pump Duty Types', description: 'Pump duties used in loops and sizing.', domain: 'engineering', group: 'Engineering data', popupGroup: 'Library', access: ENGINEERING_SETTINGS },
  { id: 'field-instruments', to: '/admin/field-instruments', icon: SlidersHorizontal, label: 'Field Instruments', description: 'Tag rules, signals and instrument requirements.', domain: 'engineering', group: 'Engineering data', popupGroup: 'Library', keywords: ['tags', 'p&id'], access: ENGINEERING_SETTINGS },
  { id: 'pipe-sizing-standards', to: '/admin/pipe-sizing-standards', icon: Pipette, label: 'Pipe Sizing Standards', description: 'Velocity and sizing standards for piping.', domain: 'engineering', group: 'Engineering data', popupGroup: 'Library', access: ENGINEERING_SETTINGS },
  { id: 'biological-media-profiles', to: '/admin/biological-media-profiles', icon: Activity, label: 'Biological Media Profiles', description: 'Biofilter media performance profiles.', domain: 'engineering', group: 'Engineering data', popupGroup: 'Library' },
  { id: 'uv-engineering', to: '/admin/uv-engineering', icon: Sun, label: 'UV Engineering Products', description: 'UV product dose data and reviews.', domain: 'engineering', group: 'Engineering data', popupGroup: 'Library' },
  { id: 'thermal-wall-constructions', to: '/admin/thermal-wall-constructions', icon: Layers, label: 'Thermal Wall Constructions', description: 'Wall build-ups for heat-loss calculations.', domain: 'engineering', group: 'Engineering data', popupGroup: 'Library', access: ENGINEERING_SETTINGS },
  { id: 'evaporation-correlations', to: '/admin/evaporation-correlations', icon: Wind, label: 'Evaporation Correlations', description: 'Evaporation models for water balance.', domain: 'engineering', group: 'Engineering data', popupGroup: 'Library', access: ENGINEERING_SETTINGS },
  { id: 'chemical-parameters', to: '/admin/chemical-parameters', icon: Pipette, label: 'Chemical Parameters', description: 'Water density and chemistry constants.', domain: 'engineering', group: 'Engineering data', popupGroup: 'Library', access: ENGINEERING_SETTINGS },
  { id: 'categories', to: '/admin/categories', icon: Boxes, label: 'Categories', description: 'Product categories.', domain: 'platform', group: 'Data', popupGroup: 'System' },
  { id: 'po-stage-roles', to: '/admin/po-stage-roles', icon: GitBranch, label: 'PO Stage Roles', description: 'Who acts at each purchase order stage.', domain: 'procurement', group: 'Workflow', popupGroup: 'Order Management', access: { module: 'orders', level: 'manage' } },
  { id: 'roles', to: '/admin/roles', icon: Users, label: 'Roles', description: 'Access roles and module visibility.', domain: 'platform', group: 'Access', popupGroup: 'System' },
  { id: 'departments', to: '/admin/departments', icon: Network, label: 'Departments', description: 'Departments, heads and sub-departments.', domain: 'platform', group: 'Access', popupGroup: 'System' },
  { id: 'menus', to: '/admin/menus', icon: ListTree, label: 'Menus', description: 'Left-menu menus and who sees each one: departments, people or everyone.', domain: 'platform', group: 'Access', popupGroup: 'System', keywords: ['navigation', 'nav', 'sidebar', 'visibility'] },
  { id: 'offices', to: '/admin/offices', icon: Building2, label: 'Offices', description: 'Offices, addresses, time zones and working calendars.', domain: 'platform', group: 'Access', popupGroup: 'System' },
  { id: 'users', to: '/admin/users', icon: Users, label: 'Users', description: 'People, roles, offices and departments.', domain: 'platform', group: 'Access', popupGroup: 'System' },
  { id: 'csv-import', to: '/admin/import', icon: Upload, label: 'CSV Import', description: 'Bulk-load records from spreadsheets.', domain: 'platform', group: 'Data', popupGroup: 'System' },
  { id: 'audit-log', to: '/admin/audit-log', icon: ClipboardList, label: 'Audit Log', description: 'Who changed what, and when.', domain: 'platform', group: 'Audit', popupGroup: 'System' },
];

export function canOpenAdminEntry(user: Pick<User, 'role' | 'moduleAccess'> | null | undefined, entry: AdminEntry): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const access = entry.access;
  return !!access && isEditorRole(user.role) && user.moduleAccess?.[access.module] === access.level;
}

/** Whether this person may manage the admin page with this id. */
export function canManageAdminPage(user: Pick<User, 'role' | 'moduleAccess'> | null | undefined, id: string): boolean {
  const entry = ADMIN_ENTRIES.find(e => e.id === id);
  return !!entry && canOpenAdminEntry(user, entry);
}

export function visibleAdminEntries(user: Pick<User, 'role' | 'moduleAccess'> | null | undefined): AdminEntry[] {
  return ADMIN_ENTRIES.filter(entry => canOpenAdminEntry(user, entry));
}

/** Popup sections in their fixed order, without empty ones. */
export function adminPopupGroups(entries: AdminEntry[]) {
  return ADMIN_POPUP_GROUPS
    .map(label => ({ label, items: entries.filter(e => e.popupGroup === label) }))
    .filter(group => group.items.length > 0);
}

// Per-person shortcuts, kept in this browser only.
const PINNED_KEY = 'admin-pinned';
const RECENT_KEY = 'admin-recent';
const RECENT_LIMIT = 6;

function readIds(key: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch { return []; }
}
function writeIds(key: string, ids: string[]) {
  try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* storage unavailable */ }
}

export const loadPinnedAdmin = () => readIds(PINNED_KEY);
export function togglePinnedAdmin(id: string): string[] {
  const ids = loadPinnedAdmin();
  const next = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
  writeIds(PINNED_KEY, next);
  return next;
}
export const loadRecentAdmin = () => readIds(RECENT_KEY);
export function rememberAdminPage(id: string) {
  writeIds(RECENT_KEY, [id, ...loadRecentAdmin().filter(x => x !== id)].slice(0, RECENT_LIMIT));
}

/** Case-insensitive match on label, description, group, department and keywords. */
export function matchesAdminSearch(entry: AdminEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [entry.label, entry.description, entry.group, ADMIN_DOMAIN_LABELS[entry.domain], ...(entry.keywords ?? [])].join(' ').toLowerCase();
  return q.split(/\s+/).every(word => hay.includes(word));
}

/** URL slug for a department page: /admin/<slug>. */
export const adminDomainSlug = (domain: AdminDomain) => domain.replace(/_/g, '-');
export function adminDomainFromSlug(slug: string | undefined): AdminDomain | null {
  const domain = (slug ?? '').replace(/-/g, '_') as AdminDomain;
  return domain in ADMIN_DOMAIN_LABELS ? domain : null;
}
/** The registry entry whose page is at this path, if any. */
export const adminEntryForPath = (path: string) => ADMIN_ENTRIES.find(e => e.to === path) ?? null;
