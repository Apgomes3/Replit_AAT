// My plans: plans you own, are shared on or have tasks in, and (second tab) every plan you can see.
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader';
import PlanList from './PlanList';
import { usePlannerPlans } from './plansApi';

export default function MyPlansPage() {
  const [params, setParams] = useSearchParams();
  const all = params.get('show') === 'all';
  const plans = usePlannerPlans({ mine: !all });
  const tab = (active: boolean) => `px-3 py-1.5 rounded-lg text-sm font-bold ${active ? 'bg-blue-600 text-white' : 'text-stone-600 hover:bg-stone-100'}`;

  return <div>
    <PageHeader
      crumbs={[{ label: 'My Plans' }]}
      title="My Plans"
      subtitle="Task lists with dates and people. Link a plan to a project, design book or enquiry, or keep it standalone."
    />
    <div className="p-6 max-w-7xl mx-auto">
    
    <div className="flex gap-2 mb-4" role="tablist">
      <button role="tab" aria-selected={!all} className={tab(!all)} onClick={() => setParams({}, { replace: true })}>My plans</button>
      <button role="tab" aria-selected={all} className={tab(all)} onClick={() => setParams({ show: 'all' }, { replace: true })}>All plans I can see</button>
    </div>
    <PlanList plans={plans.data} loading={plans.isLoading} error={plans.isError} onRetry={() => plans.refetch()}
      emptyText={all ? 'No plans you can see yet.' : 'You have no plans yet. Plans you create, are shared on or have tasks in show here.'} />
    </div>
  </div>;
}

/** The Plans panel on a project, design book, enquiry or initiative page. */
export function LinkedPlans({ projectId, designBookId, enquiryId, initiativeId }: { projectId?: string; designBookId?: string; enquiryId?: string; initiativeId?: string }) {
  const plans = usePlannerPlans({ project_id: projectId, design_book_id: designBookId, enquiry_id: enquiryId, initiative_id: initiativeId });
  return <PlanList compact plans={plans.data} loading={plans.isLoading} error={plans.isError} onRetry={() => plans.refetch()}
    showLink={!!projectId}
    defaults={{ project_id: projectId ?? null, design_book_id: designBookId ?? null, enquiry_id: enquiryId ?? null, initiative_id: initiativeId ?? null }}
    emptyText="No plans linked here yet." />;
}
