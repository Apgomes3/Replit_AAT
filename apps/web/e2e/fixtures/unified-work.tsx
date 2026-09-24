import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SearchPage from '../../src/pages/search/SearchPage';
import { safeReturnTo } from '../../src/lib/navigation';
import '../../src/index.css';

const target = new URLSearchParams(window.location.search).get('target');
if (target) window.history.replaceState(null, '', target);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function RecordDetail() {
  const location = useLocation();
  return <div>Record detail <Link to={safeReturnTo(location.state?.returnTo, '/my-work')}>Return to {location.state?.returnLabel}</Link></div>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><BrowserRouter><Routes>
    <Route path="/my-work" element={<SearchPage work />} />
    <Route path="/search" element={<SearchPage />} />
    <Route path="/purchase-orders/:id" element={<RecordDetail />} />
  </Routes></BrowserRouter></QueryClientProvider>,
);