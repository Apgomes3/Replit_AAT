"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const designBooks_1 = require("./designBooks");
(0, vitest_1.describe)('Design Book LSS control summaries', () => {
    (0, vitest_1.it)('associates saved panel selections with LSS systems in one query', async () => {
        const runner = vitest_1.vi.fn().mockResolvedValue({
            rows: [
                { id: 'control-1', system_id: 'system-1', panel_type: 'GPO' },
                { id: 'control-2', system_id: 'system-2', panel_type: 'PLC' },
            ],
        });
        const summaries = await (0, designBooks_1.loadLssControlSummaries)(runner, 'book-1', [
            { id: 'system-1', system_type: 'Life Support' },
            { id: 'system-2', system_type: 'LSS Compact' },
            { id: 'pump-1', system_type: 'Pump' },
        ]);
        (0, vitest_1.expect)(runner).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(runner).toHaveBeenCalledWith(vitest_1.expect.stringContaining('FROM design_book_lss_controls'), ['book-1', ['system-1', 'system-2']]);
        (0, vitest_1.expect)(summaries).toEqual([
            {
                system_id: 'system-1',
                control: vitest_1.expect.objectContaining({ panel_type: 'GPO' }),
            },
            {
                system_id: 'system-2',
                control: vitest_1.expect.objectContaining({ panel_type: 'PLC' }),
            },
        ]);
    });
    (0, vitest_1.it)('keeps an unconfigured LSS in the chooser summary', async () => {
        const runner = vitest_1.vi.fn().mockResolvedValue({ rows: [] });
        await (0, vitest_1.expect)((0, designBooks_1.loadLssControlSummaries)(runner, 'book-1', [
            { id: 'system-1', system_type: 'Life Support' },
        ])).resolves.toEqual([{ system_id: 'system-1', control: null }]);
    });
});
