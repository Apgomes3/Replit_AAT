import { describe, expect, it } from 'vitest';
import { DirectoryUser, planReportingImport, usersToCsv } from './reportingImport';

const u = (id: string, first: string, last: string, extra: Partial<DirectoryUser> = {}): DirectoryUser => ({
  id, email: `${first.toLowerCase()}@aat.test`, first_name: first, last_name: last, job_title: null,
  role: 'user', is_active: true, reports_to_user_id: null, ...extra,
});

const people = () => [
  u('1', 'Ana', 'Boss'),
  u('2', 'Ben', 'Lead', { reports_to_user_id: '1', job_title: 'Lead' }),
  u('3', 'Cai', 'Drafter', { reports_to_user_id: '2' }),
  u('4', 'Dee', 'Gone', { is_active: false }),
];
const H = ['email', 'first_name', 'last_name', 'job_title', 'role', 'status', 'reports_to_email', 'reports_to_name', 'office', 'department'];
const OFFICES = [{ id: 'o1', name: 'Philippines' }, { id: 'o2', name: 'China office' }];

describe('usersToCsv', () => {
  it('lists people by name with their manager email and name, and office', () => {
    const csv = usersToCsv(people().map(p => p.id === '2' ? { ...p, office_id: 'o1', departments: ['Engineering', 'Drafting', 'engineering'] } : p), OFFICES);
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe(H.join(','));
    expect(lines[1]).toBe('ana@aat.test,Ana,Boss,,user,active,,,,');
    expect(lines[2]).toBe('ben@aat.test,Ben,Lead,Lead,user,active,ana@aat.test,Ana Boss,Philippines,Engineering; Drafting');
    expect(lines[4]).toContain(',blocked,');
  });

  it('quotes commas and defuses formulas', () => {
    const csv = usersToCsv([u('9', 'Zed', 'X', { job_title: '=HYPERLINK("x"), boss' })]);
    expect(csv).toContain(`"'=HYPERLINK(""x""), boss"`);
  });
});

describe('planReportingImport', () => {
  const row = (email: string, reportsEmail = '', reportsName = '', job = '') =>
    ({ email, reports_to_email: reportsEmail, reports_to_name: reportsName, job_title: job });

  it('sets, keeps and clears managers', () => {
    const plan = planReportingImport(people(), [
      row('ana@aat.test'),
      row('ben@aat.test', 'ana@aat.test', 'Ana Boss', 'Lead'),
      row('cai@aat.test'),
    ], H);
    expect(plan.errors).toEqual([]);
    expect(plan.unchanged).toBe(2);
    expect(plan.changes).toEqual([expect.objectContaining({
      email: 'cai@aat.test', reports_to: { from: 'Ben Lead', to: null, to_id: null },
    })]);
  });

  it('accepts a manager by name when the email is blank, and changes job positions', () => {
    const plan = planReportingImport(people(), [row('cai@aat.test', '', 'ana boss', 'Senior Drafter')], H);
    expect(plan.errors).toEqual([]);
    expect(plan.changes[0].reports_to).toEqual({ from: 'Ben Lead', to: 'Ana Boss', to_id: '1' });
    expect(plan.changes[0].job_title).toEqual({ from: null, to: 'Senior Drafter' });
  });

  it('reports unknown, blocked, self, mismatched and duplicate rows', () => {
    const plan = planReportingImport(people(), [
      row('nobody@aat.test', 'ana@aat.test'),
      row('ana@aat.test', 'dee@aat.test'),
      row('ben@aat.test', 'ben@aat.test'),
      row('cai@aat.test', 'ana@aat.test', 'Ben Lead'),
      row('cai@aat.test', 'ana@aat.test'),
    ], H);
    expect(plan.changes).toEqual([]);
    expect(plan.errors.map(e => e.message)).toEqual([
      'No user with this email',
      'Dee Gone is blocked and cannot be a manager',
      'A person cannot report to themselves',
      expect.stringMatching(/different people/),
      'This person appears more than once in the file',
    ]);
  });

  it('refuses loops but allows swapping places within one file', () => {
    const loop = planReportingImport(people(), [row('ana@aat.test', 'cai@aat.test')], H);
    expect(loop.errors[0].message).toMatch(/loop/);
    expect(loop.changes).toEqual([]);

    const swap = planReportingImport(people(), [
      row('ana@aat.test', 'ben@aat.test'),
      row('ben@aat.test'),
    ], H);
    expect(swap.errors).toEqual([]);
    expect(swap.changes.map(c => [c.email, c.reports_to?.to])).toEqual([['ana@aat.test', 'Ben Lead'], ['ben@aat.test', null]]);
  });

  it('leaves managers alone when the file only has job positions', () => {
    const plan = planReportingImport(people(), [{ email: 'cai@aat.test', job_title: 'Drafter' }], ['email', 'job_title']);
    expect(plan.changes).toEqual([expect.objectContaining({ job_title: { from: null, to: 'Drafter' } })]);
    expect(plan.changes[0].reports_to).toBeUndefined();
  });

  it('moves people to offices by name, leaves blank cells alone and reports unknown offices', () => {
    const users = people().map(p => p.id === '2' ? { ...p, office_id: 'o1', departments: ['Engineering', 'Drafting', 'engineering'] } : p);
    const plan = planReportingImport(users, [
      { email: 'ana@aat.test', office: 'china OFFICE' },
      { email: 'ben@aat.test', office: 'Philippines' },
      { email: 'cai@aat.test', office: '' },
      { email: 'dee@aat.test', office: 'Mars' },
    ], ['email', 'office'], OFFICES);
    expect(plan.changes).toEqual([expect.objectContaining({ email: 'ana@aat.test', office: { from: null, to: 'China office', to_id: 'o2' } })]);
    expect(plan.unchanged).toBe(3); // Ben, Cai, and Dee (whose office is not found)
    expect(plan.errors).toEqual([{ row: 5, email: 'dee@aat.test', message: 'No office called Mars' }]);
  });
});
