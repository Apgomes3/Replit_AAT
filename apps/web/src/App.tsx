import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import Shell from './components/layout/Shell';
import Login from './pages/auth/Login';
import Dashboard from './pages/Dashboard';
import ProjectsList from './pages/projects/ProjectsList';
import ProjectDetail from './pages/projects/ProjectDetail';
import SystemDetail from './pages/projects/SystemDetail';
import EquipmentDetail from './pages/projects/EquipmentDetail';
import ProductFamiliesList from './pages/products/ProductFamiliesList';
import ProductMastersList from './pages/products/ProductMastersList';
import ProductMasterDetail from './pages/products/ProductMasterDetail';
import ComponentsList from './pages/products/ComponentsList';
import ComponentDetail from './pages/products/ComponentDetail';
import DrawingsLibrary from './pages/products/DrawingsLibrary';
import MaterialsList from './pages/knowledge/MaterialsList';
import SpecificationsList from './pages/knowledge/SpecificationsList';
import DesignRulesList from './pages/knowledge/DesignRulesList';
import DocumentsList from './pages/documents/DocumentsList';
import DocumentDetail from './pages/documents/DocumentDetail';
import GraphExplorer from './pages/graph/GraphExplorer';
import SearchPage from './pages/search/SearchPage';
import AdminUsers from './pages/admin/AdminUsers';
import AdminImport from './pages/admin/AdminImport';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30000 } } });

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, token, loadUser, isLoading } = useAuthStore();
  useEffect(() => { if (token && !user) loadUser(); }, []);
  if (!token) return <Navigate to="/login" replace />;
  if (isLoading) return <div className="flex items-center justify-center h-screen"><div className="text-slate-500">Loading...</div></div>;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster position="top-right" toastOptions={{ style: { fontSize: '14px' } }} />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<AuthGuard><Shell /></AuthGuard>}>
            <Route index element={<Dashboard />} />
            <Route path="projects" element={<ProjectsList />} />
            <Route path="projects/:id" element={<ProjectDetail />} />
            <Route path="systems/:id" element={<SystemDetail />} />
            <Route path="equipment/:id" element={<EquipmentDetail />} />
            <Route path="products" element={<ProductFamiliesList />} />
            <Route path="products/masters" element={<ProductMastersList />} />
            <Route path="products/masters/:id" element={<ProductMasterDetail />} />
            <Route path="products/components" element={<ComponentsList />} />
            <Route path="products/components/:id" element={<ComponentDetail />} />
            <Route path="products/drawings" element={<DrawingsLibrary />} />
            <Route path="knowledge/materials" element={<MaterialsList />} />
            <Route path="knowledge/specifications" element={<SpecificationsList />} />
            <Route path="knowledge/design-rules" element={<DesignRulesList />} />
            <Route path="documents" element={<DocumentsList />} />
            <Route path="documents/:id" element={<DocumentDetail />} />
            <Route path="graph" element={<GraphExplorer />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="admin/users" element={<AdminUsers />} />
            <Route path="admin/import" element={<AdminImport />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
