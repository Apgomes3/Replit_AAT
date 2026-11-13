import { useSearchParams } from 'react-router-dom';
import { CalendarCog, CalendarRange, Gauge, UserRoundCog, UsersRound } from 'lucide-react';
import PlansPanel from './PlansPanel';
import TeamsPanel from './TeamsPanel';
import WorkloadPanel from './WorkloadPanel';
import PeoplePanel from './PeoplePanel';
import CalendarsPanel from './CalendarsPanel';

const TABS = [
  { id: 'plans', label: 'Plans', icon: CalendarRange },
  { id: 'workload', label: 'Workload', icon: Gauge },
  { id: 'teams', label: 'Teams', icon: UsersRound },
  { id: 'people', label: 'People', icon: UserRoundCog },
  { id: 'calendars', label: 'Calendars', icon: CalendarCog },
] as const;
type TabId = typeof TABS[number]['id'];

/** Drafting module home: plans, the team's workload, and the teams, people and calendars behind them. */
export default function DraftingSetup() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.find(t => t.id === params.get('tab'))?.id ?? 'plans';
  const setTab = (id: TabId) => setParams(id === 'plans' ? {} : { tab: id }, { replace: true });

  return <div className="p-6 max-w-7xl mx-auto">
    <header className="mb-6">
      <div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#087f73]">Drafting</div>
      <h1 className="text-2xl font-extrabold mt-2">Drafting plans &amp; teams</h1>
      <p className="text-sm text-[#6f8082] mt-1">Organise drafting work by project, see who is free or overbooked, and set the working calendar.</p>
    </header>
    <div role="tablist" aria-label="Drafting sections" className="flex flex-wrap gap-1 border-b border-[#dce7e2] mb-5">
      {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
        className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px ${tab === t.id ? 'border-[#087f73] text-[#087f73]' : 'border-transparent text-[#6f8082] hover:text-[#20333a]'}`}>
        <t.icon className="w-4 h-4" /> {t.label}
      </button>)}
    </div>
    {tab === 'plans' && <PlansPanel onGoToTeams={() => setTab('teams')} />}
    {tab === 'workload' && <WorkloadPanel />}
    {tab === 'teams' && <TeamsPanel />}
    {tab === 'people' && <PeoplePanel />}
    {tab === 'calendars' && <CalendarsPanel />}
  </div>;
}
