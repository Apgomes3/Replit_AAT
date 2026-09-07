import { describe, expect, it, vi } from 'vitest';
import { loadLssControlSummaries } from './designBooks';

describe('Design Book LSS control summaries', () => {
  it('associates saved panel selections with LSS systems in one query', async () => {
    const runner = vi.fn().mockResolvedValue({
      rows: [
        { id: 'control-1', system_id: 'system-1', panel_type: 'GPO' },
        { id: 'control-2', system_id: 'system-2', panel_type: 'PLC' },
      ],
    });

    const summaries = await loadLssControlSummaries(runner, 'book-1', [
      { id: 'system-1', system_type: 'Life Support' },
      { id: 'system-2', system_type: 'LSS Compact' },
      { id: 'pump-1', system_type: 'Pump' },
    ]);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      expect.stringContaining('FROM design_book_lss_controls'),
      ['book-1', ['system-1', 'system-2']],
    );
    expect(summaries).toEqual([
      {
        system_id: 'system-1',
        control: expect.objectContaining({ panel_type: 'GPO' }),
      },
      {
        system_id: 'system-2',
        control: expect.objectContaining({ panel_type: 'PLC' }),
      },
    ]);
  });

  it('keeps an unconfigured LSS in the chooser summary', async () => {
    const runner = vi.fn().mockResolvedValue({ rows: [] });

    await expect(loadLssControlSummaries(runner, 'book-1', [
      { id: 'system-1', system_type: 'Life Support' },
    ])).resolves.toEqual([{ system_id: 'system-1', control: null }]);
  });
});