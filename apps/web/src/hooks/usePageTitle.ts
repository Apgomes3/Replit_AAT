import { useEffect } from 'react';
import { useLocation, matchPath } from 'react-router-dom';
import { rememberRecord } from '../lib/recentRecords';

const ROUTE_TITLES: { path: string; title: string }[] = [
  { path: '/login', title: 'Login' },
  { path: '/', title: 'Home' },
  { path: '/dashboard', title: 'Dashboard' },
  { path: '/pim', title: 'PIM' },
  { path: '/order-management', title: 'Order Management' },
  { path: '/project-management', title: 'Project Management' },
  { path: '/projects/:id', title: 'Project' },
  { path: '/projects', title: 'Projects' },
  { path: '/systems/:id', title: 'System' },
  { path: '/products/masters/:id', title: 'Product Master' },
  { path: '/products/masters', title: 'Product Masters' },
  { path: '/products/components/:id', title: 'Component' },
  { path: '/products/components', title: 'Components' },
  { path: '/products/piping', title: 'Piping' },
  { path: '/products/tanks', title: 'Tanks' },
  { path: '/products/drawings', title: 'Drawings' },
  { path: '/products/attributes', title: 'Attributes' },
  { path: '/products', title: 'Products' },
  { path: '/knowledge/materials', title: 'Materials' },
  { path: '/knowledge/specifications', title: 'Specifications' },
  { path: '/knowledge/design-rules', title: 'Design Rules' },
  { path: '/documents/:id', title: 'Document' },
  { path: '/documents', title: 'Documents' },
  { path: '/graph', title: 'Graph Explorer' },
  { path: '/search', title: 'Search' },
  { path: '/my-work', title: 'My Work' },
  { path: '/clients/:id', title: 'Client' },
  { path: '/clients', title: 'Clients & Contacts' },
  { path: '/people/:id', title: 'Person' },
  { path: '/initiatives/:id', title: 'Initiative' },
  { path: '/initiatives', title: 'Initiatives' },
  { path: '/enquiries/:id', title: 'Enquiry' },
  { path: '/enquiries', title: 'Enquiries' },
  { path: '/knowledge/materials/:id', title: 'Material' },
  { path: '/admin', title: 'Settings & Data' },
  { path: '/admin/users', title: 'Users' },
  { path: '/admin/import', title: 'Import' },
  { path: '/admin/categories', title: 'Categories' },
  { path: '/admin/roles', title: 'Roles' },
  { path: '/admin/tank-families', title: 'Tank Families' },
  { path: '/admin/audit-log', title: 'Audit Log' },
  { path: '/admin/evaporation-correlations', title: 'Evaporation Correlations' },
  { path: '/purchase-orders/:id', title: 'Purchase Order' },
  { path: '/purchase-orders', title: 'Purchase Orders' },
  { path: '/drafting/plans/:id', title: 'Drafting Plan' },
  { path: '/drafting', title: 'Drafting' },
  { path: '/resources', title: 'Resources' },
];

const APP_NAME = 'Shark OS';

export function usePageTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    const matched = ROUTE_TITLES.find(({ path }) =>
      matchPath({ path, end: true }, pathname)
    );

    document.title = matched ? `${matched.title} | ${APP_NAME}` : APP_NAME;
  }, [pathname]);
}

export function useRecordTitle(name: string | undefined) {
  useEffect(() => {
    if (name) {
      document.title = `${name} | ${APP_NAME}`;
      rememberRecord(window.location.pathname, name);
    }
  }, [name]);
}
