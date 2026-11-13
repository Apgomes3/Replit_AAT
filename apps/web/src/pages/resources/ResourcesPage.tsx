import { useSearchParams } from 'react-router-dom';
import { CalendarCog, Gauge, UserRoundCog, UsersRound } from 'lucide-react';
import WorkloadPanel from '../drafting/WorkloadPanel';
import TeamsPanel from '../drafting/TeamsPanel';
import PeoplePanel from '../drafting/PeoplePanel';
import CalendarsPanel from '../drafting/CalendarsPanel';
import { PlanningScopeContext } from '../drafting/planningApi';

const TABS = [
  { id: 'workload', label: 'Workload', icon: Gauge },
  { id: 'teams', label: 'Teams', icon: UsersRound },
  { id: 'people', label: 'People', icon: UserRoundCog },
  { id: 'calendars', label: 'Calendars', icon: CalendarCog },
] as const;
type TabId = typeof TABS[number]['id'];

/**
 * Company-wide resources: every team by department, everyone's workload across all plans, and the
 * people and calendars behind it. Same data as Drafting's tabs, which show only the drafting teams.
 */
export default function ResourcesPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.find(t => t.id === params.get('tab'))?.id ?? 'workload';
  const setTab = (id: TabId) => setParams(id === 'workload' ? {} : { tab: id }, { replace: true });

  return <PlanningScopeContext.Provider value="company">
    <div className="p-6 max-w-7xl mx-auto">
      <header className="mb-6">
        <div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#087f73]">Resources</div>
        <h1 className="text-2xl font-extrabold mt-2">Company resources</h1>
        <p className="text-sm text-[#6f8082] mt-1">Every team and person in one place: who is booked, who has room, and the calendars and leave behind it.</p>
      </header>
      <div role="tablist" aria-label="Resources sections" className="flex flex-wrap gap-1 border-b border-[#dce7e2] mb-5">
        {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px ${tab === t.id ? 'border-[#087f73] text-[#087f73]' : 'border-transparent text-[#6f8082] hover:text-[#20333a]'}`}>
          <t.icon className="w-4 h-4" /> {t.label}
        </button>)}
      </div>
      {tab === 'workload' && <WorkloadPanel />}
      {tab === 'teams' && <TeamsPanel />}
      {tab === 'people' && <PeoplePanel />}
      {tab === 'calendars' && <CalendarsPanel />}
    </div>
  </PlanningScopeContext.Provider>;
}
