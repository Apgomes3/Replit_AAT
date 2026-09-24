import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Shell from '../../src/components/layout/Shell';
import PageHeader from '../../src/components/ui/PageHeader';
import { useAuthStore } from '../../src/store/authStore';
import { currentReturnContext } from '../../src/lib/navigation';
import '../../src/index.css';

useAuthStore.setState({
  token: 'browser-test',
  isLoading: false,
  user: {
    id: 'admin-1',
    email: 'admin@example.com',
    firstName: 'Admin',
    lastName: 'User',
    role: 'admin',
    moduleAccess: {},
  },
});

const params = new URLSearchParams(window.location.search);
const target = params.get('target');
if (target) window.history.replaceState(null, '', target);

function PurchaseOrders() {
  const location = useLocation();
  return (
    <>
      <PageHeader title="Purchase Orders" crumbs={[{ label: 'Order Management', href: '/order-management' }, { label: 'Purchase Orders' }]} />
      <Link
        to="/purchase-orders/po-1"
        state={currentReturnContext(location.pathname, location.search, 'Purchase Orders')}
      >
        Open PO-1001
      </Link>
    </>
  );
}

function PurchaseOrderDetail() {
  const location = useLocation();
  return (
    <PageHeader
      title="PO-1001"
      returnTo={(location.state as any)?.returnTo || '/purchase-orders'}
      returnLabel={(location.state as any)?.returnLabel || 'Purchase Orders'}
      crumbs={[
        { label: 'Order Management', href: '/order-management' },
        { label: 'Purchase Orders', href: '/purchase-orders' },
        { label: 'PO-1001' },
      ]}
    />
  );
}

function Origin({ type }: { type: 'project' | 'system' }) {
  const isSystem = type === 'system';
  return (
    <Link
      to="/purchase-orders/po-1"
      state={{
        from: isSystem ? 'system' : 'project',
        returnTo: isSystem ? '/systems/system-1?tab=equipment' : '/projects/project-1?tab=bom-release',
        returnLabel: isSystem ? 'SYS-01' : 'PRJ-01',
        projectId: 'project-1',
        projectCode: 'PRJ-01',
        projectName: 'Oceanarium',
        ...(isSystem ? { systemId: 'system-1', systemCode: 'SYS-01', systemName: 'Main LSS' } : {}),
      }}
    >
      Open origin PO
    </Link>
  );
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Shell />}>
            <Route index element={<div>Home</div>} />
            <Route path="orders" element={<Navigate to="/order-management" replace />} />
            <Route path="order-management" element={<div>Order queue</div>} />
            <Route path="purchase-orders" element={<PurchaseOrders />} />
            <Route path="purchase-orders/:id" element={<PurchaseOrderDetail />} />
            <Route path="projects/project-1" element={<Origin type="project" />} />
            <Route path="systems/system-1" element={<Origin type="system" />} />
            <Route path="products/masters" element={<div>Products</div>} />
            <Route path="products/components" element={<div>Components</div>} />
            <Route path="products/piping" element={<div>Pipes</div>} />
            <Route path="products/tanks" element={<div>Tanks</div>} />
            <Route path="projects" element={<div>Projects</div>} />
            <Route path="design-books" element={<div>Design Books</div>} />
            <Route path="lss-compact-units" element={<div>LSS catalog</div>} />
            <Route path="species-catalog" element={<div>Species catalog</div>} />
            <Route path="admin/users" element={<div>Users admin</div>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);