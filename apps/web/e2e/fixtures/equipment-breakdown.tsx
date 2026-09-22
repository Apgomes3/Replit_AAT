import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import EquipmentBreakdownTab from '../../src/pages/design-books/EquipmentBreakdownTab';
import '../../src/index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const book = {
  id: 'browser-book',
  systems: [
    {
      id: 'browser-system',
      system_code: 'LSS-01',
      system_name: 'Main Life Support',
      system_type: 'LSS',
    },
  ],
};

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <main className="p-6">
        <EquipmentBreakdownTab book={book} readOnly={false} />
      </main>
      <Toaster />
    </QueryClientProvider>
  </React.StrictMode>,
);