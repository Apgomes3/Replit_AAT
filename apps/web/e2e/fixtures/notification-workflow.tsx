import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import TopBar from '../../src/components/layout/TopBar';
import { useAuthStore } from '../../src/store/authStore';
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

function CurrentRoute() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}{location.search}</output>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MemoryRouter initialEntries={['/']}>
      <TopBar />
      <Routes>
        <Route path="*" element={<CurrentRoute />} />
      </Routes>
    </MemoryRouter>
  </React.StrictMode>,
);