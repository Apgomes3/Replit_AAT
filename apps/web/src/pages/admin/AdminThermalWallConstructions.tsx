import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, Layers, ShieldCheck } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import { useAuthStore } from '../../store/authStore';
import { ThermalWallConstructionLibrary } from '../design-books/DesignBookDetail';

function canManageThermalWalls(user: ReturnType<typeof useAuthStore.getState>['user']) {
  if (!user || !['admin', 'engineer'].includes(user.role)) return false;
  const access = user.moduleAccess?.design_books;
  return access !== 'view' && access !== 'hidden';
}

export default function AdminThermalWallConstructions() {
  const user = useAuthStore(state => state.user);
  const queryClient = useQueryClient();
  const canManage = canManageThermalWalls(user);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['thermal-wall-construction-history'],
    queryFn: () => api.get('/thermal-wall-constructions/history').then(response => response.data),
    enabled: canManage,
  });

  if (!canManage) return <Navigate to="/" replace />;

  const history: any[] = data?.items || [];
  const currentDefaults = history.filter(item =>
    (item.approval?.status || item.status) === 'approved',
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <PageHeader
        title="Thermal Wall Constructions"
        subtitle="Governed wall-layer defaults used by Thermal calculations. Review evidence and approve successor versions without opening a Design Book."
      />

      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
        <p>
          Approved versions are selected by new Thermal calculations. Existing calculations keep their
          frozen wall evidence when a replacement is approved.
        </p>
      </div>

      {isError && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Unable to load Thermal wall construction history.
        </div>
      )}
      {isLoading && (
        <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500">
          Loading Thermal wall constructions…
        </div>
      )}

      {!isLoading && (
        <ThermalWallConstructionLibrary
          approvedDefaults={currentDefaults}
          canManageLibrary
          onRefresh={() => queryClient.invalidateQueries({ queryKey: ['thermal-wall-construction-history'] })}
        />
      )}

      {!isLoading && !history.length && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Layers className="h-4 w-4 shrink-0" />
          No governed Thermal wall constructions are available.
        </div>
      )}
    </div>
  );
}

export { canManageThermalWalls };