import { type ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import { Sidebar } from '@/components/Sidebar';
import { Scene } from '@/components/Scene';
import { SelectionPanel } from '@/components/SelectionPanel';
import { BoxSelect, Maximize, MousePointer2 } from 'lucide-react';

const queryClient = new QueryClient();

function MainWorkspace() {
  const [viewMode, setViewMode] = useState<'iso' | 'top' | 'front' | 'side'>('iso');

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div className="flex-1 relative">
        <div className="absolute top-4 left-4 z-10 flex gap-2">
          <div className="bg-card/95 backdrop-blur border border-border rounded-lg shadow-sm flex p-1">
            <button 
              onClick={() => setViewMode('iso')} 
              data-testid="button-view-iso"
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${viewMode === 'iso' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
            >
              ISO
            </button>
            <button 
              onClick={() => setViewMode('top')} 
              data-testid="button-view-top"
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${viewMode === 'top' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
            >
              TOP
            </button>
            <button 
              onClick={() => setViewMode('front')} 
              data-testid="button-view-front"
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${viewMode === 'front' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
            >
              FRONT
            </button>
            <button 
              onClick={() => setViewMode('side')} 
              data-testid="button-view-side"
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${viewMode === 'side' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
            >
              SIDE
            </button>
          </div>
          
          <div className="bg-card/95 backdrop-blur border border-border rounded-lg shadow-sm px-3 py-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground pointer-events-none">
            <MousePointer2 size={14} /> Orbit / Select
          </div>
        </div>

        <Scene viewMode={viewMode} visualMode="technical" />
        <SelectionPanel />
      </div>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={MainWorkspace} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
