// Turns Planner rows into drafting plans and tasks (pure; unit-tested).
import type { TaskPriority, TaskStatus } from '../validation';
import { PlannerTask, serialToIso } from './plannerFile';

export type ProjectRef = { code: string; name: string };

export type ImportTask = {
  plannerNumber: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string | null;
  dueDate: string | null;
  completedOn: string | null;
  group: string | null;
  assigneeNames: string[];
  notes: string | null;
};

export type ImportPlan = {
  project: ProjectRef;
  plannerHeader: string;
  startDate: string | null;
  targetDate: string | null;
  description: string | null;
  tasks: ImportTask[];
};

/** Marker stored in task notes so a re-import never duplicates a task. */
export const plannerMarker = (n: string) => `[Planner #${n}]`;

/** "001-042-Merlin Orlando" → 001-042 / Merlin Orlando; non-project headers become internal projects. */
export function parseProjectHeader(header: string, internal: Record<string, ProjectRef> = {}): ProjectRef {
  const text = header.replace(/\s+/g, ' ').trim();
  if (internal[text]) return internal[text]!;
  const m = text.match(/^(\d{3}-[0-9X]{3})\s*[-–:]?\s*(.*)$/i);
  if (!m) throw new Error(`"${text}" does not start with a project code (e.g. 061-043).`);
  return { code: m[1]!.toUpperCase(), name: (m[2] || m[1]!).trim() };
}

export function mapStatus(percent: string): TaskStatus {
  const p = Number(percent);
  if (!Number.isFinite(p) || p <= 0) return 'not_started';
  return p >= 1 ? 'done' : 'in_progress';
}

export function mapPriority(value: string): TaskPriority {
  const v = value.trim().toLowerCase();
  return v === 'urgent' || v === 'important' || v === 'low' ? v : 'medium';
}

/** "Sean Duan, Richard Xie" → names; aliases fix Planner names that differ from Shark OS accounts. */
export function splitAssignees(value: string, aliases: Record<string, string> = {}): string[] {
  return [...new Set(value.split(/[,;]/).map(s => s.trim()).filter(Boolean).map(n => aliases[n] ?? n))];
}

function taskNotes(t: PlannerTask, percent: number): string | null {
  const parts = [
    t['Notes'],
    t['Comment'] && `Comment: ${t['Comment']}`,
    t['Amendment'] && `Amendment: ${t['Amendment']}`,
    t['Delay'] && `Delay: ${t['Delay']}`,
    t['Checklist Items'] && `Checklist: ${t['Checklist Items'].split(';').filter(Boolean).join(' · ')}${t['Completed'] ? ` (${t['Completed']} done)` : ''}`,
    t['Depends on'] && `Depends on Planner task(s) ${t['Depends on']}`,
    t['Milestone'] === 'Yes' && 'Milestone',
    percent > 0 && percent < 1 && `Planner progress: ${Math.round(percent * 100)}%`,
  ].filter(Boolean);
  return [...parts, plannerMarker(t['Task number']!)].join('\n');
}

export function buildImport(rows: PlannerTask[], opts: { aliases?: Record<string, string>; internalProjects?: Record<string, ProjectRef> } = {}): ImportPlan[] {
  const plans: ImportPlan[] = [];
  let current: ImportPlan | null = null;
  for (const t of rows) {
    const outline = t['Outline number'] ?? '';
    if (!outline.includes('.')) {
      // Summary row = one project.
      current = {
        project: parseProjectHeader(t['Name'] ?? '', opts.internalProjects),
        plannerHeader: t['Name'] ?? '',
        startDate: serialToIso(t['Start']),
        targetDate: serialToIso(t['Finish']),
        description: t['Notes'] || null,
        tasks: [],
      };
      plans.push(current);
      continue;
    }
    if (!current) throw new Error(`Task ${t['Task number']} appears before any project row.`);
    const percent = Number(t['% complete']) || 0;
    const status = mapStatus(t['% complete'] ?? '');
    let start = serialToIso(t['Start']);
    let due = serialToIso(t['Finish']);
    if (start && due && due < start) [start, due] = [due, start];
    current.tasks.push({
      plannerNumber: t['Task number']!,
      title: (t['Name'] ?? '').trim() || `Planner task ${t['Task number']}`,
      status,
      priority: mapPriority(t['Priority'] ?? ''),
      startDate: start,
      dueDate: due,
      completedOn: status === 'done' ? due : null,
      group: t['Labels']?.trim() || null,
      assigneeNames: splitAssignees(t['Assigned to'] ?? '', opts.aliases),
      notes: taskNotes(t, percent),
    });
  }
  // Several header rows can belong to one project; merge them.
  const byCode = new Map<string, ImportPlan>();
  for (const p of plans) {
    const existing = byCode.get(p.project.code);
    if (!existing) { byCode.set(p.project.code, p); continue; }
    existing.tasks.push(...p.tasks);
    existing.startDate = [existing.startDate, p.startDate].filter(Boolean).sort()[0] ?? null;
    existing.targetDate = [existing.targetDate, p.targetDate].filter(Boolean).sort().reverse()[0] ?? null;
  }
  return [...byCode.values()];
}
