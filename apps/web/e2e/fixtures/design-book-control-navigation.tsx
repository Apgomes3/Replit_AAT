import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import DesignBookDetail from '../../src/pages/design-books/DesignBookDetail';
import '../../src/index.css';

const fixtureParams = new URLSearchParams(window.location.search);
const target = fixtureParams.get('target');
if (target) window.history.replaceState(null, '', target);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/design-books/:id" element={<DesignBookDetail />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);