export const MODULE_ACCESS_KEYS = [
  'pim',
  'orders',
  'projects',
  'design_books',
  'documents',
  'knowledge',
  'graph',
  'business_development',
  'drafting',
  'resources',
] as const;

export type ModuleAccessKey = typeof MODULE_ACCESS_KEYS[number];
export type ModuleAccessLevel = 'manage' | 'view' | 'hidden';

export const MODULE_ACCESS_LABELS: Record<ModuleAccessKey, string> = {
  pim: 'PIM Management',
  orders: 'Order Management',
  projects: 'Project Management',
  design_books: 'Design Book Engine',
  documents: 'Documents',
  knowledge: 'Knowledge Library',
  graph: 'Graph Explorer',
  business_development: 'Business Development',
  drafting: 'Drafting',
  resources: 'Resources (company teams & workload)',
};