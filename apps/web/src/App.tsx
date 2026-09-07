import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import Shell from './components/layout/Shell';
import CommandPalette from './components/ui/CommandPalette';
import Login from './pages/auth/Login';
import ResetPassword from './pages/auth/ResetPassword';
import HomeHub from './pages/HomeHub';
import Dashboard from './pages/Dashboard';
import ProjectsList from './pages/projects/ProjectsList';
import ProjectDetail from './pages/projects/ProjectDetail';
import SystemDetail from './pages/projects/SystemDetail';
import ProductFamiliesList from './pages/products/ProductFamiliesList';
import ProductMastersList from './pages/products/ProductMastersList';
import ProductMasterDetail from './pages/products/ProductMasterDetail';
import ComponentsList from './pages/products/ComponentsList';
import ComponentDetail from './pages/products/ComponentDetail';
import PipingList from './pages/products/PipingList';
import TanksList from './pages/products/TanksList';
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
import AdminCategories from './pages/admin/AdminCategories';
import AdminRoles from './pages/admin/AdminRoles';
import AdminTankFamilies from './pages/admin/AdminTankFamilies';
import AdminSystemTypes from './pages/admin/AdminSystemTypes';
import AdminAuditLog from './pages/admin/AdminAuditLog';
import AdminPOStageRoles from './pages/admin/AdminPOStageRoles';
import AdminTankCostRates from './pages/admin/AdminTankCostRates';
import AdminBiologicalMediaProfiles from './pages/admin/AdminBiologicalMediaProfiles';
import AdminUVEngineering from './pages/admin/AdminUVEngineering';
import AdminThermalWallConstructions from './pages/admin/AdminThermalWallConstructions';
import AdminEvaporationCorrelations from './pages/admin/AdminEvaporationCorrelations';
import AdminPumpDutyTypes from './pages/admin/AdminPumpDutyTypes';
import AdminFieldInstruments from './pages/admin/AdminFieldInstruments';
import PurchaseOrdersList from './pages/procurement/PurchaseOrdersList';
import PurchaseOrderDetail from './pages/procurement/PurchaseOrderDetail';
import PIMDashboard from './pages/pim/PIMDashboard';
import OrderManagementDashboard from './pages/orders/OrderManagementDashboard';
import ProjectManagementDashboard from './pages/project-mgmt/ProjectManagementDashboard';
import DesignBooksList from './pages/design-books/DesignBooksList';
import DesignBookDetail from './pages/design-books/DesignBookDetail';
import DesignBookEngineDashboard from './pages/design-books/DesignBookEngineDashboard';
import ExhibitDetail from './pages/design-books/ExhibitDetail';
import DesignBookLSSDetail from './pages/design-books/DesignBookLSSDetail';
import LSSCompactUnitsCatalog from './pages/design-books/LSSCompactUnitsCatalog';
import SpeciesCatalog from './pages/design-books/SpeciesCatalog';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30000 } } });

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, token, loadUser, isLoading } = useAuthStore();
  useEffect(() => { if (token && !user) loadUser(); }, []);
  if (!token) return <Navigate to="/login" replace />;
  if (isLoading) return <div className="flex items-center justify-center h-screen"><div className="text-stone-500">Loading...</div></div>;
  return <>{children}</>;
}

function ModuleGuard({ moduleKey, children }: { moduleKey: string; children: React.ReactNode }) {
  const user = useAuthStore(state => state.user);
  if (user?.moduleAccess?.[moduleKey] === 'hidden') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(state => state.user);
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function ImportGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(state => state.user);
  const canImport = user?.role === 'admin' || user?.moduleAccess?.pim === 'manage';
  if (!canImport) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function EngineeringAdminGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(state => state.user);
  if (user?.role !== 'admin' && user?.role !== 'engineer') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster position="top-right" toastOptions={{ style: { fontSize: '14px' } }} />
        <CommandPalette />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/" element={<AuthGuard><Shell /></AuthGuard>}>
            <Route index element={<HomeHub />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="pim" element={<ModuleGuard moduleKey="pim"><PIMDashboard /></ModuleGuard>} />
             <Route path="pim/products" element={<ModuleGuard moduleKey="pim"><Navigate to="/products/masters" replace /></ModuleGuard>} />
             <Route path="pim/components" element={<ModuleGuard moduleKey="pim"><Navigate to="/products/components" replace /></ModuleGuard>} />
            <Route path="order-management" element={<ModuleGuard moduleKey="orders"><OrderManagementDashboard /></ModuleGuard>} />
            <Route path="project-management" element={<ModuleGuard moduleKey="projects"><ProjectManagementDashboard /></ModuleGuard>} />
            <Route path="projects" element={<ModuleGuard moduleKey="projects"><ProjectsList /></ModuleGuard>} />
            <Route path="projects/:id" element={<ModuleGuard moduleKey="projects"><ProjectDetail /></ModuleGuard>} />
            <Route path="systems/:id" element={<ModuleGuard moduleKey="projects"><SystemDetail /></ModuleGuard>} />
            <Route path="products" element={<ModuleGuard moduleKey="pim"><ProductFamiliesList /></ModuleGuard>} />
            <Route path="products/masters" element={<ModuleGuard moduleKey="pim"><ProductMastersList /></ModuleGuard>} />
            <Route path="products/masters/:id" element={<ModuleGuard moduleKey="pim"><ProductMasterDetail /></ModuleGuard>} />
            <Route path="products/components" element={<ModuleGuard moduleKey="pim"><ComponentsList /></ModuleGuard>} />
            <Route path="products/components/:id" element={<ModuleGuard moduleKey="pim"><ComponentDetail /></ModuleGuard>} />
            <Route path="products/piping" element={<ModuleGuard moduleKey="pim"><PipingList /></ModuleGuard>} />
            <Route path="products/tanks" element={<ModuleGuard moduleKey="pim"><TanksList /></ModuleGuard>} />
            <Route path="products/drawings" element={<ModuleGuard moduleKey="pim"><DrawingsLibrary /></ModuleGuard>} />
            <Route path="knowledge/materials" element={<ModuleGuard moduleKey="knowledge"><MaterialsList /></ModuleGuard>} />
            <Route path="knowledge/specifications" element={<ModuleGuard moduleKey="knowledge"><SpecificationsList /></ModuleGuard>} />
            <Route path="knowledge/design-rules" element={<ModuleGuard moduleKey="knowledge"><DesignRulesList /></ModuleGuard>} />
            <Route path="documents" element={<ModuleGuard moduleKey="documents"><DocumentsList /></ModuleGuard>} />
            <Route path="documents/:id" element={<ModuleGuard moduleKey="documents"><DocumentDetail /></ModuleGuard>} />
            <Route path="graph" element={<ModuleGuard moduleKey="graph"><GraphExplorer /></ModuleGuard>} />
            <Route path="search" element={<SearchPage />} />
            <Route path="admin/users" element={<AdminUsers />} />
             <Route path="admin" element={<Navigate to="/admin/users" replace />} />
            <Route path="admin/import" element={<ImportGuard><AdminImport /></ImportGuard>} />
            <Route path="admin/categories" element={<AdminCategories />} />
            <Route path="admin/roles" element={<AdminRoles />} />
            <Route path="admin/tank-families" element={<AdminTankFamilies />} />
            <Route path="admin/system-types" element={<AdminSystemTypes />} />
            <Route path="admin/audit-log" element={<AdminAuditLog />} />
            <Route path="admin/po-stage-roles" element={<AdminPOStageRoles />} />
            <Route path="admin/tank-cost-rates" element={<AdminTankCostRates />} />
            <Route path="admin/biological-media-profiles" element={<AdminGuard><AdminBiologicalMediaProfiles /></AdminGuard>} />
            <Route path="admin/uv-engineering" element={<AdminGuard><AdminUVEngineering /></AdminGuard>} />
             <Route path="admin/thermal-wall-constructions" element={<EngineeringAdminGuard><AdminThermalWallConstructions /></EngineeringAdminGuard>} />
            <Route path="admin/evaporation-correlations" element={<AdminGuard><AdminEvaporationCorrelations /></AdminGuard>} />
            <Route path="admin/pump-duty-types" element={<AdminGuard><AdminPumpDutyTypes /></AdminGuard>} />
             <Route path="admin/field-instruments" element={<AdminGuard><AdminFieldInstruments /></AdminGuard>} />
            <Route path="purchase-orders" element={<ModuleGuard moduleKey="orders"><PurchaseOrdersList /></ModuleGuard>} />
            <Route path="purchase-orders/:id" element={<ModuleGuard moduleKey="orders"><PurchaseOrderDetail /></ModuleGuard>} />
            <Route path="design-book-engine" element={<ModuleGuard moduleKey="design_books"><DesignBookEngineDashboard /></ModuleGuard>} />
            <Route path="design-books" element={<ModuleGuard moduleKey="design_books"><DesignBooksList /></ModuleGuard>} />
            <Route path="design-books/:id" element={<ModuleGuard moduleKey="design_books"><DesignBookDetail /></ModuleGuard>} />
            <Route path="design-books/:bookId/exhibits/:exhibitId" element={<ModuleGuard moduleKey="design_books"><ExhibitDetail /></ModuleGuard>} />
            <Route path="design-books/:bookId/lss/:systemId" element={<ModuleGuard moduleKey="design_books"><DesignBookLSSDetail /></ModuleGuard>} />
            <Route path="lss-compact-units" element={<ModuleGuard moduleKey="design_books"><LSSCompactUnitsCatalog /></ModuleGuard>} />
            <Route path="species-catalog" element={<ModuleGuard moduleKey="design_books"><SpeciesCatalog /></ModuleGuard>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
