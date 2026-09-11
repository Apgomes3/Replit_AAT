"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const lssControls_1 = require("./lssControls");
(0, vitest_1.describe)('LSS control instrument rules', () => {
    (0, vitest_1.it)('formats tags from the LSS number and type sequence', () => {
        (0, vitest_1.expect)((0, lssControls_1.buildInstrumentTag)('LSS-01', 'TS', 1)).toBe('01-TS-01');
        (0, vitest_1.expect)((0, lssControls_1.buildInstrumentTag)('lss-01', 'pH', 2)).toBe('01-pH-02');
    });
    (0, vitest_1.it)('counts only configured pumps for pump-linked FS minimums', () => {
        (0, vitest_1.expect)((0, lssControls_1.requiredPumpLinkedQuantity)([
            { project_equipment_item_id: 'pump-a', pump_quantity: 2 },
            { project_equipment_item_id: null, pump_quantity: 8 },
            { project_equipment_item_id: 'pump-b' },
        ])).toBe(3);
    });
    (0, vitest_1.it)('imports the active definition default for new instances, not an older selection', () => {
        (0, vitest_1.expect)((0, lssControls_1.initialInstrumentProduct)('catalog-default', undefined)).toBe('catalog-default');
        (0, vitest_1.expect)((0, lssControls_1.initialInstrumentProduct)('catalog-default', { product_supplied: true, product_master_id: 'designer-choice' }))
            .toBe('designer-choice');
        (0, vitest_1.expect)((0, lssControls_1.initialInstrumentProduct)(null, undefined)).toBeNull();
    });
    (0, vitest_1.it)('imports editable default control logic only when an instance is first created', () => {
        (0, vitest_1.expect)((0, lssControls_1.initialInstrumentControlLogic)('Start pump when flow falls below setpoint.', undefined))
            .toBe('Start pump when flow falls below setpoint.');
        (0, vitest_1.expect)((0, lssControls_1.initialInstrumentControlLogic)('catalog logic', { control_logic_supplied: true, control_logic: 'Designer logic' }))
            .toBe('Designer logic');
        (0, vitest_1.expect)((0, lssControls_1.initialInstrumentControlLogic)(null, undefined)).toBeNull();
    });
    (0, vitest_1.it)('treats an explicitly supplied null product as a PIM-governed override', () => {
        (0, vitest_1.expect)((0, lssControls_1.hasExplicitInstrumentProductOverride)({ product_master_id: null })).toBe(true);
        (0, vitest_1.expect)((0, lssControls_1.hasExplicitInstrumentProductOverride)({})).toBe(false);
    });
    (0, vitest_1.it)('reconciles each editable design book using free sequences without changing existing evidence', async () => {
        const inserts = [];
        const runner = async (sql, params = []) => {
            if (sql.includes('FROM field_instrument_definitions')) {
                return { rows: [{ id: 'fs', name: 'Flow Switch', tag_code: 'FS', default_control_logic: 'Prove flow.', default_product_master_id: null }] };
            }
            if (sql.includes('SUM(COALESCE(pump_quantity,1))'))
                return { rows: [{ quantity: 3 }] };
            if (sql.includes('FROM design_books'))
                return { rows: [{ id: 'draft-a' }, { id: 'draft-b' }] };
            if (sql.includes('pg_advisory_xact_lock'))
                return { rows: [] };
            if (sql.includes('FROM design_book_lss_instruments')) {
                return { rows: params[0] === 'draft-a' ? [{ id: 'preserved', sequence_number: 2 }] : [] };
            }
            if (sql.includes('INSERT INTO design_book_lss_instruments')) {
                inserts.push(params);
                return { rows: [] };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        };
        await (0, lssControls_1.reconcilePumpLinkedInstruments)(runner, {
            projectId: 'project', systemId: 'lss', systemCode: 'LSS-01', userId: 'engineer',
        });
        (0, vitest_1.expect)(inserts.map(params => [params[0], params[4], params[3]])).toEqual([
            ['draft-a', 1, '01-FS-01'],
            ['draft-a', 3, '01-FS-03'],
            ['draft-b', 1, '01-FS-01'],
            ['draft-b', 2, '01-FS-02'],
            ['draft-b', 3, '01-FS-03'],
        ]);
        (0, vitest_1.expect)(inserts.every(params => params[5] === 'Prove flow.')).toBe(true);
    });
    (0, vitest_1.it)('creates automatic pump-linked evidence when governed logic is absent', async () => {
        const inserts = [];
        const runner = async (sql) => {
            if (sql.includes('FROM field_instrument_definitions')) {
                return { rows: [{ id: 'custom', name: 'Custom flow proof', tag_code: 'CFS', default_control_logic: null }] };
            }
            if (sql.includes('SUM(COALESCE(pump_quantity,1))'))
                return { rows: [{ quantity: 1 }] };
            if (sql.includes('FROM design_books'))
                return { rows: [{ id: 'draft-a' }] };
            if (sql.includes('pg_advisory_xact_lock'))
                return { rows: [] };
            if (sql.includes('FROM design_book_lss_instruments'))
                return { rows: [] };
            if (sql.includes('INSERT INTO design_book_lss_instruments')) {
                inserts.push(sql);
                return { rows: [] };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        };
        await (0, lssControls_1.reconcilePumpLinkedInstruments)(runner, {
            projectId: 'project', systemId: 'lss', systemCode: 'LSS-01', userId: 'engineer',
        });
        (0, vitest_1.expect)(inserts).toHaveLength(1);
    });
});
