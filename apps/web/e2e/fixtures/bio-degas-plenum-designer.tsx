import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import { BioDegasPlenumPanel } from '../../src/pages/design-books/BioDegasPlenumDesigner';
import '../../src/index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

function Fixture() {
  const [stale, setStale] = useState(() => sessionStorage.getItem('bio-media-stale') === 'true');

  return (
    <QueryClientProvider client={queryClient}>
      <main className="min-h-screen bg-stone-100 p-6">
        <div className="mx-auto max-w-7xl">
          <header className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-700">LSS-001 · Biological Media</p>
              <h1 className="text-2xl font-bold text-stone-900">Bio/Degas Plenum</h1>
            </div>
            <button
              type="button"
              onClick={() => {
                sessionStorage.setItem('bio-media-stale', 'true');
                setStale(true);
              }}
              className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold"
            >
              Mark Biological Media result stale
            </button>
          </header>
          <BioDegasPlenumPanel
            systemId="browser-system"
            bookId="browser-book"
            data={{ preview: { is_stale: stale, media: { installed_media_m3: 1.428 } } }}
          />
        </div>
      </main>
      <Toaster />
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);