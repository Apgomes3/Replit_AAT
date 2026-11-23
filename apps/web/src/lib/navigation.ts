export type ModuleKey =
  | 'pim'
  | 'orders'
  | 'projects'
  | 'design_books'
  | 'business_development'
  | 'documents'
  | 'knowledge'
  | 'graph'
  | 'drafting'
  | 'resources'
  | 'clients'
  | 'initiatives';

export type RouteGroup = 'operational' | 'engineering' | 'commercial' | 'reference' | 'administration';

export const ROUTES = {
  home: '/',
  search: '/search',
  graph: '/graph',
  orders: '/order-management',
  purchaseOrders: '/purchase-orders',
  projects: '/projects',
  projectManagement: '/project-management',
  pim: '/pim',
  products: '/products/masters',
  components: '/products/components',
  piping: '/products/piping',
  tanks: '/products/tanks',
  designBookEngine: '/design-book-engine',
  designBooks: '/design-books',
  lssCompactUnits: '/lss-compact-units',
  speciesCatalog: '/species-catalog',
  businessDevelopment: '/business-development',
  clients: '/clients',
  enquiries: '/enquiries',
  drafting: '/drafting',
  resources: '/resources',
  documents: '/documents',
  materials: '/knowledge/materials',
  specifications: '/knowledge/specifications',
  designRules: '/knowledge/design-rules',
  admin: '/admin/users',
} as const;

export const LEGACY_ROUTE_REDIRECTS = [
  { from: '/pim/products', to: ROUTES.products },
  { from: '/pim/components', to: ROUTES.components },
  { from: '/orders', to: ROUTES.orders },
  { from: '/procurement', to: ROUTES.purchaseOrders },
  { from: '/project-management/projects', to: ROUTES.projects },
  { from: '/design-book-engine/books', to: ROUTES.designBooks },
  { from: '/admin', to: ROUTES.admin },
] as const;

export type SearchEntity = {
  id: string | number;
  type: string;
  system_id?: string | number;
};

export function entityHref(entity: SearchEntity): string {
  switch (entity.type) {
    case 'project': return `${ROUTES.projects}/${entity.id}`;
    case 'system': return `/systems/${entity.id}`;
    case 'equipment': return entity.system_id ? `/systems/${entity.system_id}` : ROUTES.projects;
    case 'product': return `${ROUTES.products}/${entity.id}`;
    case 'material': return `${ROUTES.materials}/${entity.id}`;
    case 'notification': return ROUTES.orders;
    case 'audit_event': return '/admin/audit-log';
    case 'document': return `${ROUTES.documents}/${entity.id}`;
    case 'purchase_order': return `${ROUTES.purchaseOrders}/${entity.id}`;
    case 'design_book': return `${ROUTES.designBooks}/${entity.id}`;
    case 'client': return `${ROUTES.clients}/${entity.id}`;
    case 'person': return `/people/${entity.id}`;
    case 'initiative': return `/initiatives/${entity.id}`;
    case 'knowledge_article': return `/knowledge/articles/${entity.id}`;
    case 'enquiry': return `${ROUTES.enquiries}/${entity.id}`;
    default: return ROUTES.search;
  }
}

export function moduleForPath(path: string): ModuleKey | null {
  if (path === ROUTES.pim || path.startsWith('/products')) return 'pim';
  if (path === ROUTES.orders || path.startsWith(ROUTES.purchaseOrders)) return 'orders';
  if (path === ROUTES.projectManagement || path.startsWith('/projects') || path.startsWith('/systems')) return 'projects';
  if (path === ROUTES.designBookEngine || path.startsWith('/design-books') || path.startsWith('/lss-compact-units') || path.startsWith('/species-catalog')) return 'design_books';
  if (path.startsWith(ROUTES.clients)) return 'clients';
  if (path.startsWith('/initiatives')) return 'initiatives';
  if (path === ROUTES.businessDevelopment || path.startsWith('/enquiries')) return 'business_development';
  if (path.startsWith('/documents')) return 'documents';
  if (path.startsWith('/knowledge')) return 'knowledge';
  if (path.startsWith('/graph')) return 'graph';
  if (path.startsWith(ROUTES.drafting)) return 'drafting';
  if (path.startsWith(ROUTES.resources)) return 'resources';
  return null;
}

export type ReturnContext = {
  returnTo: string;
  returnLabel: string;
};

export function currentReturnContext(pathname: string, search = '', label = 'Back'): ReturnContext {
  return { returnTo: `${pathname}${search}`, returnLabel: label };
}

export function safeReturnTo(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}