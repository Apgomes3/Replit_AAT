// User list export and the "update reporting from file" import (Admin › Users).
// The export is a CSV people can edit offline; the import reads it back and changes only
// "reports to" and job positions of existing users. Planning is pure so it can be previewed.

export interface DirectoryUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  role: string;
  is_active: boolean;
  reports_to_user_id: string | null;
}

export const EXPORT_COLUMNS = [
  'email', 'first_name', 'last_name', 'job_title', 'role', 'status', 'reports_to_email', 'reports_to_name',
] as const;

export function displayName(u: Pick<DirectoryUser, 'first_name' | 'last_name' | 'email'>): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return name || u.email;
}

function csvCell(value: string | null | undefined): string {
  const v = value ?? '';
  // Guard against spreadsheet formulas, then quote when needed.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The user list as CSV (with a BOM so Excel reads accents), sorted by name. */
export function usersToCsv(users: DirectoryUser[]): string {
  const byId = new Map(users.map(u => [u.id, u]));
  const sorted = [...users].sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const lines = [EXPORT_COLUMNS.join(',')];
  for (const u of sorted) {
    const manager = u.reports_to_user_id ? byId.get(u.reports_to_user_id) : undefined;
    lines.push([
      u.email, u.first_name, u.last_name, u.job_title, u.role, u.is_active ? 'active' : 'blocked',
      manager?.email ?? '', manager ? displayName(manager) : '',
    ].map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export interface ReportingChange {
  row: number;
  user_id: string;
  email: string;
  name: string;
  reports_to?: { from: string | null; to: string | null; to_id: string | null };
  job_title?: { from: string | null; to: string };
}

export interface ReportingPlan {
  total: number;
  changes: ReportingChange[];
  unchanged: number;
  errors: Array<{ row: number; email?: string; message: string }>;
}

const clean = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

/**
 * Works out what a reporting file would change. Rows are keyed by lower-case header.
 * - reports_to_email (or, when blank, a unique reports_to_name) sets the manager; both blank clears it.
 * - job_title, when the column is present and the cell is not blank, replaces the job position.
 * - Unknown people, inactive or ambiguous managers, self-reporting and loops are reported as errors
 *   and leave that row's manager unchanged.
 */
export function planReportingImport(users: DirectoryUser[], rows: Array<Record<string, string>>, headers: string[]): ReportingPlan {
  const plan: ReportingPlan = { total: rows.length, changes: [], unchanged: 0, errors: [] };
  if (!headers.includes('email')) {
    plan.errors.push({ row: 1, message: 'The file must have an email column' });
    return plan;
  }
  const hasReporting = headers.includes('reports_to_email') || headers.includes('reports_to_name');
  const hasJobTitle = headers.includes('job_title');
  if (!hasReporting && !hasJobTitle) {
    plan.errors.push({ row: 1, message: 'The file needs a reports_to_email, reports_to_name or job_title column' });
    return plan;
  }

  const byEmail = new Map(users.map(u => [u.email.toLowerCase(), u]));
  const byName = new Map<string, DirectoryUser[]>();
  for (const u of users) {
    const key = displayName(u).toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), u]);
  }
  const byId = new Map(users.map(u => [u.id, u]));
  const finalManager = new Map(users.map(u => [u.id, u.reports_to_user_id]));
  const seen = new Set<string>();
  const pending: Array<{ change: ReportingChange; user: DirectoryUser }> = [];

  rows.forEach((raw, index) => {
    const row = index + 2;
    const email = clean(raw.email).toLowerCase();
    if (!email) return; // blank line
    const user = byEmail.get(email);
    if (!user) { plan.errors.push({ row, email, message: 'No user with this email' }); return; }
    if (seen.has(user.id)) { plan.errors.push({ row, email, message: 'This person appears more than once in the file' }); return; }
    seen.add(user.id);

    const change: ReportingChange = { row, user_id: user.id, email: user.email, name: displayName(user) };

    if (hasReporting) {
      const mEmail = clean(raw.reports_to_email).toLowerCase();
      const mName = clean(raw.reports_to_name).toLowerCase();
      let manager: DirectoryUser | null = null;
      let problem: string | null = null;
      if (mEmail) {
        manager = byEmail.get(mEmail) ?? null;
        if (!manager) problem = `No user with the email ${mEmail}`;
        else if (mName && displayName(manager).toLowerCase() !== mName && !(byName.get(mName) ?? []).some(m => m.id === manager!.id)) {
          problem = `reports_to_email (${mEmail}) and reports_to_name (${clean(raw.reports_to_name)}) are different people`;
        }
      } else if (mName) {
        const matches = (byName.get(mName) ?? []).filter(m => m.is_active);
        if (matches.length === 1) manager = matches[0];
        else problem = matches.length ? `More than one active user is called ${clean(raw.reports_to_name)}; use reports_to_email` : `No active user called ${clean(raw.reports_to_name)}`;
      }
      if (!problem && manager && manager.id === user.id) problem = 'A person cannot report to themselves';
      if (!problem && manager && !manager.is_active) problem = `${displayName(manager)} is blocked and cannot be a manager`;
      if (problem) {
        plan.errors.push({ row, email, message: problem });
      } else {
        const toId = manager?.id ?? null;
        if (toId !== user.reports_to_user_id) {
          const from = user.reports_to_user_id ? byId.get(user.reports_to_user_id) : undefined;
          change.reports_to = { from: from ? displayName(from) : null, to: manager ? displayName(manager) : null, to_id: toId };
          finalManager.set(user.id, toId);
        }
      }
    }

    if (hasJobTitle) {
      const title = clean(raw.job_title);
      if (title.length > 150) plan.errors.push({ row, email, message: 'Job position must be 150 characters or fewer' });
      else if (title && title !== (user.job_title ?? '')) change.job_title = { from: user.job_title, to: title };
    }

    pending.push({ change, user });
  });

  // Loops are judged on the final picture, so swapping two people's places in one file works.
  const inLoop = (id: string) => {
    let current = finalManager.get(id) ?? null;
    for (let steps = 0; current && steps <= users.length; steps++) {
      if (current === id) return true;
      current = finalManager.get(current) ?? null;
    }
    return false;
  };
  let removed = true;
  while (removed) {
    removed = false;
    for (const p of pending) {
      if (p.change.reports_to && inLoop(p.user.id)) {
        plan.errors.push({ row: p.change.row, email: p.user.email, message: `Reporting to ${p.change.reports_to.to} would make a loop` });
        finalManager.set(p.user.id, p.user.reports_to_user_id);
        delete p.change.reports_to;
        removed = true;
      }
    }
  }

  for (const p of pending) {
    if (p.change.reports_to || p.change.job_title) plan.changes.push(p.change);
    else plan.unchanged++;
  }
  plan.errors.sort((a, b) => a.row - b.row);
  return plan;
}
