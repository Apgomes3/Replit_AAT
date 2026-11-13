// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readSheetRows, serialToIso, tasksFromRows } from './plannerFile';
import { buildImport, mapStatus, parseProjectHeader, splitAssignees } from './plannerPlan';

const row = (o: Record<string, string>) => o;

describe('Planner import mapping', () => {
  it('parses project headers and internal projects', () => {
    expect(parseProjectHeader('001-042-Merlin Orlando')).toEqual({ code: '001-042', name: 'Merlin Orlando' });
    expect(parseProjectHeader('064-xxx NZ Underwater UV')).toEqual({ code: '064-XXX', name: 'NZ Underwater UV' });
    expect(parseProjectHeader('AAT General Products', { 'AAT General Products': { code: 'AAT-GEN', name: 'AAT General Products' } }).code).toBe('AAT-GEN');
    expect(() => parseProjectHeader('Misc')).toThrow(/project code/);
  });

  it('maps status, dates and assignees', () => {
    expect([mapStatus('0'), mapStatus('0.5'), mapStatus('1'), mapStatus('')]).toEqual(['not_started', 'in_progress', 'done', 'not_started']);
    expect(serialToIso('46066')).toBe('2026-02-13');
    expect(serialToIso('')).toBeNull();
    expect(splitAssignees('David Dai, Sean Duan,David Dai', { 'David Dai': 'Davey Dai' })).toEqual(['Davey Dai', 'Sean Duan']);
  });

  it('groups tasks under their project row and merges repeated projects', () => {
    const plans = buildImport([
      row({ 'Task number': '1', 'Outline number': '1', Name: '001-042 Merlin', Start: '46066', Finish: '46070' }),
      row({ 'Task number': '2', 'Outline number': '1.1', Name: 'GA drawing', '% complete': '1', Priority: 'Urgent', Start: '46066', Finish: '46068', Labels: 'Tanks', 'Assigned to': 'Sean Duan' }),
      row({ 'Task number': '3', 'Outline number': '2', Name: '001-042 - Merlin', Start: '46060', Finish: '46080' }),
      row({ 'Task number': '4', 'Outline number': '2.1', Name: 'Details', '% complete': '0.4', Comment: 'waiting' }),
    ]);
    expect(plans).toHaveLength(1);
    const [p] = plans;
    expect(p!.startDate).toBe('2026-02-07');
    expect(p!.targetDate).toBe('2026-02-27');
    expect(p!.tasks.map(t => [t.status, t.priority, t.group, t.completedOn])).toEqual([
      ['done', 'urgent', 'Tanks', '2026-02-15'],
      ['in_progress', 'medium', null, null],
    ]);
    expect(p!.tasks[1]!.notes).toBe('Comment: waiting\nPlanner progress: 40%\n[Planner #4]');
  });

  it('reads Planner sheet XML with x: prefixes and positional cells', () => {
    const xml = '<x:sheetData><x:row><x:c t="inlineStr"><x:is><x:t>Task number</x:t></x:is></x:c><x:c t="inlineStr"><x:is><x:t>Name</x:t></x:is></x:c></x:row>'
      + '<x:row><x:c><x:v>1</x:v></x:c><x:c t="inlineStr"><x:is><x:t>A &amp; B</x:t></x:is></x:c></x:row></x:sheetData>';
    expect(tasksFromRows(readSheetRows(xml))).toEqual([{ 'Task number': '1', Name: 'A & B' }]);
  });
});
