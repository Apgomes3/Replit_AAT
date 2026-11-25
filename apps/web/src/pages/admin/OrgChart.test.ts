import { describe, expect, it } from 'vitest';
import { buildOrgTree, departmentPalette, type OrgPerson } from './OrgChart';

const p = (id: string, manager_id: string | null, name = id, department: string | null = null): OrgPerson =>
  ({ id, name, job_title: null, manager_id, department_id: department, department, department_colour: null, office: null, heads: [] });

describe('buildOrgTree', () => {
  it('puts the person nobody manages at the top, managers before others, with head counts', () => {
    const t = buildOrgTree([p('ceo', null, 'John'), p('gm', 'ceo', 'Zed'), p('eng', 'gm'), p('pa', 'ceo', 'Amy'), p('admin', null, 'Platform Admin')]);
    expect(t.tops.map(n => n.id)).toEqual(['ceo']);
    expect(t.tops[0].reports.map(n => n.id)).toEqual(['gm', 'pa']); // Zed manages someone, so before Amy
    expect(t.tops[0].below).toBe(3);
    expect(t.maxDepth).toBe(2);
    expect(t.loose.map(n => n.id)).toEqual(['admin']);
  });

  it('groups people under a manager by department, then name', () => {
    const t = buildOrgTree([p('m', null), p('a', 'm', 'Ann', 'Sales'), p('b', 'm', 'Bob', 'Finance'), p('c', 'm', 'Cat'), p('d', 'm', 'Dan', 'Finance')]);
    expect(t.tops[0].reports.map(n => n.name)).toEqual(['Bob', 'Dan', 'Ann', 'Cat']);
  });

  it('survives a reporting loop and a manager who is not in the list', () => {
    const t = buildOrgTree([p('a', 'b'), p('b', 'a'), p('c', 'gone')]);
    expect(t.tops.map(n => n.id)).toEqual(['a']);
    expect(t.tops[0].reports.map(n => n.id)).toEqual(['b']);
    expect(t.loose.map(n => n.id)).toEqual(['c']);
  });
});

describe('departmentPalette', () => {
  it('keeps chosen colours and gives grey or clashing departments distinct spare ones', () => {
    const d = (id: string, colour: string) => ({ id, key: id, name: id, parent_id: null, colour, is_active: true });
    const pal = departmentPalette([d('a', 'blue'), d('b', 'slate'), d('c', 'slate'), d('d', 'blue')]);
    expect(pal.get('a')).toBe('#3b82f6');
    expect(new Set([pal.get('a'), pal.get('b'), pal.get('c'), pal.get('d')]).size).toBe(4);
  });
});
