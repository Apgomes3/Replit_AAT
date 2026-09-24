import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import ExhibitDetail from '../../src/pages/design-books/ExhibitDetail';
import { useAuthStore } from '../../src/store/authStore';
import '../../src/index.css';

useAuthStore.setState({
  token: 'browser-test',
  isLoading: false,
  user: {
    id: 'engineer-1',
    email: 'engineer@example.com',
    firstName: 'Test',
    lastName: 'Engineer',
    role: 'engineer',
    moduleAccess: {},
  },
});

window.history.replaceState(null, '', '/design-books/book-1/exhibits/exhibit-1');
ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <BrowserRouter>
      <Routes>
        <Route path="/design-books/:bookId/exhibits/:exhibitId" element={<ExhibitDetail />} />
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>,
);