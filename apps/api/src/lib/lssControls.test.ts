import { describe, expect, it } from 'vitest';
import {
  buildInstrumentTag, initialInstrumentControlLogic, initialInstrumentProduct,
  hasExplicitInstrumentProductOverride, hasValidRetainedRequiredControlLogic,
  PumpLinkedInstrumentValidationError, reconcilePumpLinkedInstruments, requiredPumpLinkedQuantity,
} from './lssControls';

describe('LSS control instrument rules', () => {
  it('formats tags from the LSS number and type sequence', () => {
    expect(buildInstrumentTag('LSS-01', 'TS', 1)).toBe('01-TS-01');
    expect(buildInstrumentTag('lss-01', 'pH', 2)).toBe('01-pH-02');
  });

  it('counts only configured pumps for pump-linked FS minimums', () => {
    expect(requiredPumpLinkedQuantity([
      { project_equipment_item_id: 'pump-a', pump_quantity: 2 },
      { project_equipment_item_id: null, pump_quantity: 8 },
      { project_equipment_item_id: 'pump-b' },
    ])).toBe(3);
  });

  it('imports the active definition default for new instances, not an older selection', () => {
    expect(initialInstrumentProduct('catalog-default', undefined)).toBe('catalog-default');
    expect(initialInstrumentProduct('catalog-default', { product_supplied: true, product_master_id: 'designer-choice' }))
      .toBe('designer-choice');
    expect(initialInstrumentProduct(null, undefined)).toBeNull();
  });

  it('imports editable default control logic only when an instance is first created', () => {
    expect(initialInstrumentControlLogic('Start pump when flow falls below setpoint.', undefined))
      .toBe('Start pump when flow falls below setpoint.');
    expect(initialInstrumentControlLogic('catalog logic', { control_logic_supplied: true, control_logic: 'Designer logic' }))
      .toBe('Designer logic');
    expect(initialInstrumentControlLogic(null, undefined)).toBeNull();
  });

  it('treats an explicitly supplied null product as a PIM-governed override', () => {
    expect(hasExplicitInstrumentProductOverride({ product_master_id: null })).toBe(true);
    expect(hasExplicitInstrumentProductOverride({})).toBe(false);
  });

  it('does not allow retained mandatory or pump-linked evidence to have blank logic', () => {
    const blank = [{ control_logic: '   ' }];
    expect(hasValidRetainedRequiredControlLogic('mandatory', blank, undefined)).toBe(false);
    expect(hasValidRetainedRequiredControlLogic('pump_linked', [{ control_logic: 'Existing logic' }], {
      control_logic_supplied: true, control_logic: null,
    })).toBe(false);
    expect(hasValidRetainedRequiredControlLogic('mandatory', blank, {
      control_logic_supplied: true, control_logic: 'Replacement logic',
    })).toBe(true);
    expect(hasValidRetainedRequiredControlLogic('optional', blank, undefined)).toBe(true);
  });

  it('reconciles each editable design book using free sequences without changing existing evidence', async () => {
    const inserts: any[] = [];
    const runner = async (sql: string, params: any[] = []) => {
      if (sql.includes('FROM field_instrument_definitions')) {
        return { rows: [{ id: 'fs', name: 'Flow Switch', tag_code: 'FS', default_control_logic: 'Prove flow.', default_product_master_id: null }] };
      }
      if (sql.includes('SUM(COALESCE(pump_quantity,1))')) return { rows: [{ quantity: 3 }] };
      if (sql.includes('FROM design_books')) return { rows: [{ id: 'draft-a' }, { id: 'draft-b' }] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('FROM design_book_lss_instruments')) {
        return { rows: params[0] === 'draft-a' ? [{ id: 'preserved', sequence_number: 2 }] : [] };
      }
      if (sql.includes('INSERT INTO design_book_lss_instruments')) {
        inserts.push(params);
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    };

    await reconcilePumpLinkedInstruments(runner, {
      projectId: 'project', systemId: 'lss', systemCode: 'LSS-01', userId: 'engineer',
    });

    expect(inserts.map(params => [params[0], params[4], params[3]])).toEqual([
      ['draft-a', 1, '01-FS-01'],
      ['draft-a', 3, '01-FS-03'],
      ['draft-b', 1, '01-FS-01'],
      ['draft-b', 2, '01-FS-02'],
      ['draft-b', 3, '01-FS-03'],
    ]);
    expect(inserts.every(params => params[5] === 'Prove flow.')).toBe(true);
  });

  it('rejects automatic pump-linked evidence when governed logic is absent', async () => {
    const runner = async (sql: string) => {
      if (sql.includes('FROM field_instrument_definitions')) {
        return { rows: [{ id: 'custom', name: 'Custom flow proof', tag_code: 'CFS', default_control_logic: null }] };
      }
      if (sql.includes('SUM(COALESCE(pump_quantity,1))')) return { rows: [{ quantity: 1 }] };
      if (sql.includes('FROM design_books')) return { rows: [{ id: 'draft-a' }] };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('FROM design_book_lss_instruments')) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    };
    await expect(reconcilePumpLinkedInstruments(runner, {
      projectId: 'project', systemId: 'lss', systemCode: 'LSS-01', userId: 'engineer',
    })).rejects.toBeInstanceOf(PumpLinkedInstrumentValidationError);
  });
});