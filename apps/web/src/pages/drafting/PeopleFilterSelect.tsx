import { byDepartment, PeopleFilter, usePlanningScope, useScopedTeams } from './planningApi';

/** '' = everyone, 'team:<id>' = one team, 'dept:<name>' = every team in a department. */
export function parsePeopleFilter(value: string): PeopleFilter {
  if (value.startsWith('team:')) return { teamId: value.slice(5) };
  if (value.startsWith('dept:')) return { department: value.slice(5) };
  return {};
}

/** Picks whose people to show. In Resources it offers departments and every company team. */
export default function PeopleFilterSelect({ value, onChange, everyoneLabel }: {
  value: string; onChange: (value: string) => void; everyoneLabel?: string;
}) {
  const company = usePlanningScope() === 'company';
  const teams = (useScopedTeams().data ?? []).filter(t => t.active);
  const groups = byDepartment(teams);

  return <select aria-label={company ? 'Department or team' : 'Team'} value={value} onChange={e => onChange(e.target.value)}
    className="border border-[#dce7e2] rounded-lg px-3 py-2 text-sm bg-white font-bold max-w-xs">
    <option value="">{everyoneLabel ?? (company ? 'Whole company' : 'Everyone')}</option>
    {company
      ? <>
          <optgroup label="Departments">{groups.map(g => <option key={g.department} value={`dept:${g.department}`}>{g.department} (all teams)</option>)}</optgroup>
          {groups.map(g => <optgroup key={g.department} label={g.department}>
            {g.teams.map(t => <option key={t.id} value={`team:${t.id}`}>{t.name}</option>)}
          </optgroup>)}
        </>
      : teams.map(t => <option key={t.id} value={`team:${t.id}`}>{t.name}</option>)}
  </select>;
}
