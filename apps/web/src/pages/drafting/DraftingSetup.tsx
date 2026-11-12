import { useSearchParams } from 'react-router-dom';
import { CalendarRange, UsersRound } from 'lucide-react';
import PlansPanel from './PlansPanel';
import TeamsPanel from './TeamsPanel';

const TABS = [
  { id: 'plans', label: 'Plans', icon: CalendarRange },
  { id: 'teams', label: 'Teams', icon: UsersRound },
] as const;
type TabId = typeof TABS[number]['id'];

/** Drafting module home: the manager sets up teams and the plans they deliver per project. */
export default function DraftingSetup() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = params.get('tab') === 'teams' ? 'teams' : 'plans';
  const setTab = (id: TabId) => setParams(id === 'plans' ? {} : { tab: id }, { replace: true });

  return <div className="p-6 max-w-7xl mx-auto">
    <header className="mb-6">
      <div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#087f73]">Drafting</div>
      <h1 className="text-2xl font-extrabold mt-2">Drafting plans &amp; teams</h1>
      <p className="text-sm text-[#6f8082] mt-1">Organise drafting work by project and see what each team is delivering.</p>
    </header>
    <div role="tablist" aria-label="Drafting sections" className="flex gap-1 border-b border-[#dce7e2] mb-5">
      {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
        className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px ${tab === t.id ? 'border-[#087f73] text-[#087f73]' : 'border-transparent text-[#6f8082] hover:text-[#20333a]'}`}>
        <t.icon className="w-4 h-4" /> {t.label}
      </button>)}
    </div>
    {tab === 'plans' ? <PlansPanel onGoToTeams={() => setTab('teams')} /> : <TeamsPanel />}
  </div>;
}
