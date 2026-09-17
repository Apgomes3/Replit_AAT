import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LSSControlPanel from '../../src/pages/design-books/LSSControlPanel';
import '../../src/index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const mode = new URLSearchParams(window.location.search).get('mode');
const readOnly = mode === 'issued';
const canOverrideProduct = mode === 'valves';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <main className="mx-auto w-full max-w-6xl p-2 sm:p-6">
        <h1 className="mb-4 text-xl font-semibold">LSS-01 · Field Instruments</h1>
        <LSSControlPanel
          bookId="book-1"
          systemId="system-1"
          readOnly={readOnly}
          canOverrideProduct={canOverrideProduct}
        />
      </main>
    </QueryClientProvider>
  </React.StrictMode>,
);