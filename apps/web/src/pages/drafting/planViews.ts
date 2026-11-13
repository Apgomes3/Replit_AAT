// Pure helpers that turn a plan's tasks into the sections shown by the List and Gantt views.
import {
  Task, TaskGroup, TaskPayload, TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS,
} from './draftingApi';

export const GROUP_BY = ['group', 'status', 'person', 'priority', 'none'] as const;
export type GroupBy = typeof GROUP_BY[number];
export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  group: 'Group', status: 'Status', person: 'Person', priority: 'Priority', none: 'No grouping',
};

export const SORT_KEYS = ['manual', 'title', 'priority', 'status', 'start', 'due'] as const;
export type SortKey = typeof SORT_KEYS[number];
export type Sort = { key: SortKey; desc: boolean };

export type Section = {
  key: string;
  label: string;
  /** The task group, when grouping by group (null = "No group"). */
  group?: TaskGroup | null;
  tasks: Task[];
  /** Fields a task added from this section's quick-add row starts with. */
  defaults: TaskPayload;
};

const rank = <T extends string>(list: readonly T[], v: T) => list.indexOf(v);

/** Tasks without the sorted date go last, whichever the direction. */
export function sortTasks(tasks: Task[], sort: Sort): Task[] {
  if (sort.key === 'manual') return tasks;
  const dir = sort.desc ? -1 : 1;
  const value = (t: Task): string | number | null => {
    switch (sort.key) {
      case 'title': return t.title.toLowerCase();
      case 'priority': return rank(TASK_PRIORITIES, t.priority);
      case 'status': return rank(TASK_STATUSES, t.status);
      case 'start': return t.start_date;
      case 'due': return t.due_date;
      default: return t.sort_order;
    }
  };
  return [...tasks].sort((a, b) => {
    const va = value(a), vb = value(b);
    if (va === vb) return a.sort_order - b.sort_order;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va < vb ? -1 : 1) * dir;
  });
}

/** Splits tasks into sections. When grouping by person, a task with two people shows under both. */
export function buildSections(tasks: Task[], groups: TaskGroup[], groupBy: GroupBy, sort: Sort): Section[] {
  const sorted = sortTasks(tasks, sort);
  switch (groupBy) {
    case 'group': {
      const known = new Set(groups.map(g => g.id));
      const ungrouped = sorted.filter(t => !t.group_id || !known.has(t.group_id));
      return [
        ...groups.map(g => ({ key: g.id, label: g.name, group: g, tasks: sorted.filter(t => t.group_id === g.id), defaults: { group_id: g.id } })),
        ...(ungrouped.length || !groups.length ? [{ key: 'none', label: 'No group', group: null, tasks: ungrouped, defaults: { group_id: null } }] : []),
      ];
    }
    case 'status':
      return TASK_STATUSES.map(s => ({ key: s, label: TASK_STATUS_LABELS[s], tasks: sorted.filter(t => t.status === s), defaults: { status: s } }));
    case 'priority':
      return TASK_PRIORITIES.map(p => ({ key: p, label: TASK_PRIORITY_LABELS[p], tasks: sorted.filter(t => t.priority === p), defaults: { priority: p } }));
    case 'person': {
      const people = new Map<string, string>();
      sorted.forEach(t => t.assignees.forEach(a => people.set(a.id, a.name)));
      const unassigned = sorted.filter(t => !t.assignees.length);
      return [
        ...[...people.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({
          key: id, label: name, tasks: sorted.filter(t => t.assignees.some(a => a.id === id)), defaults: { assignee_ids: [id] },
        })),
        ...(unassigned.length ? [{ key: 'unassigned', label: 'Unassigned', tasks: unassigned, defaults: {} }] : []),
      ];
    }
    default:
      return [{ key: 'all', label: 'All tasks', tasks: sorted, defaults: {} }];
  }
}
