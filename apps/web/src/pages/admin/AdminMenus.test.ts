import { describe, expect, it } from 'vitest';
import { ruleSummary } from './AdminMenus';

const departments = [
  { id: '1', key: 'engineering', name: 'Engineering', parent_id: null, is_active: true },
  { id: '2', key: 'design', name: 'Design', parent_id: '1', is_active: true },
];

describe('Admin -> Menus rule summary', () => {
  it('says who sees a menu and what everyone else gets', () => {
    expect(ruleSummary({ visibility: 'everyone', department_keys: [], user_ids: [], include_unassigned: false, outside: 'hide' }, departments)).toBe('Everyone');
    expect(ruleSummary({ visibility: 'departments', department_keys: ['engineering', 'design'], user_ids: [], include_unassigned: true, outside: 'fold' }, departments))
      .toBe('Engineering, Design + people with no department; others see it folded');
    expect(ruleSummary({ visibility: 'people', department_keys: [], user_ids: ['a'], include_unassigned: false, outside: 'hide' }, departments))
      .toBe("1 person; others don't see it");
  });
});
