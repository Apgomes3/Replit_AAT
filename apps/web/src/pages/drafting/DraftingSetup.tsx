import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader';
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

  return <div>
    <PageHeader
      crumbs={[{ label: 'Engineering' }, { label: 'Drafting' }]}
      title="Drafting"
      subtitle="Organise drafting work by project, see who is free or overbooked, and set the working calendar."
    />
    <div className="p-6 max-w-7xl mx-auto">
    
    <div role="tablist" aria-label="Drafting sections" className="flex flex-wrap gap-1 border-b border-stone-200 mb-5">
      {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
        className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px ${tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-stone-500 hover:text-stone-800'}`}>
        <t.icon className="w-4 h-4" /> {t.label}
      </button>)}
    </div>
    {tab === 'plans' && <PlansPanel onGoToTeams={() => setTab('teams')} />}
    {tab === 'workload' && <WorkloadPanel />}
    {tab === 'teams' && <TeamsPanel />}
    {tab === 'people' && <PeoplePanel />}
    {tab === 'calendars' && <CalendarsPanel />}
    </div>
  </div>;
}
