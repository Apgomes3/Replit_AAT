import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import EnquiryDetail from '../../src/pages/business-development/EnquiryDetail';
import PurchaseOrderDetail from '../../src/pages/procurement/PurchaseOrderDetail';
import { useAuthStore } from '../../src/store/authStore';
import '../../src/index.css';

useAuthStore.setState({
  token: 'browser-test',
  isLoading: false,
  user: {
    id: 'admin-1',
    email: 'admin@example.com',
    firstName: 'Test',
    lastName: 'Admin',
    role: 'admin',
    moduleAccess: {},
  },
});

const page = new URLSearchParams(window.location.search).get('page');
const router = createMemoryRouter([
  { path: '/enquiries/:id', element: <EnquiryDetail /> },
  { path: '/purchase-orders/:id', element: <PurchaseOrderDetail /> },
], {
  initialEntries: [page === 'purchase-order' ? '/purchase-orders/po-1' : '/enquiries/enq-1'],
});
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);