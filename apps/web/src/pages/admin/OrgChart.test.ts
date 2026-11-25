import { describe, expect, it } from 'vitest';
import { buildOrgTree, type OrgPerson } from './OrgChart';

const p = (id: string, manager_id: string | null, name = id): OrgPerson =>
  ({ id, name, job_title: null, manager_id, department: null, department_colour: null, office: null });

describe('buildOrgTree', () => {
  it('puts the person nobody manages at the top, managers before others, with head counts', () => {
    const t = buildOrgTree([p('ceo', null, 'John'), p('gm', 'ceo', 'Zed'), p('eng', 'gm'), p('pa', 'ceo', 'Amy'), p('admin', null, 'Platform Admin')]);
    expect(t.tops.map(n => n.id)).toEqual(['ceo']);
    expect(t.tops[0].reports.map(n => n.id)).toEqual(['gm', 'pa']); // Zed manages someone, so before Amy
    expect(t.tops[0].below).toBe(3);
    expect(t.maxDepth).toBe(2);
    expect(t.loose.map(n => n.id)).toEqual(['admin']);
  });

  it('survives a reporting loop and a manager who is not in the list', () => {
    const t = buildOrgTree([p('a', 'b'), p('b', 'a'), p('c', 'gone')]);
    expect(t.tops.map(n => n.id)).toEqual(['a']);
    expect(t.tops[0].reports.map(n => n.id)).toEqual(['b']);
    expect(t.loose.map(n => n.id)).toEqual(['c']);
  });
});
