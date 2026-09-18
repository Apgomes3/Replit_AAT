import { Router, Response } from 'express';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import pool, { query } from '../db';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage } from '../middleware/auth';
import { isLifeSupportSystem } from '../lib/lssSystems';
import { isControlValveCode } from '../lib/lssControls';

const router = Router();
router.use(authenticate, requireModuleAccess('design_books'));
type Db = { query: typeof query; release?: () => void };

const transaction = async <T>(fn: (db: Db) => Promise<T>) => {
  const connect = (pool as any).connect;
  const db: Db = typeof connect === 'function' ? await connect.call(pool) : { query };
  try { await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result; }
  catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release?.(); }
};

const numberOrNull = (value: any) => value == null || value === '' ? null : Number(value);
const safeText = (value: any) => value == null ? null : String(value);
export const normalizeEquipmentCurrency = (value: any) => String(value || 'USD').toUpperCase() === 'RMB' ? 'CNY' : String(value || 'USD').toUpperCase();
export const equipmentCurrencyNumberFormat = (value: any) => ({
  USD: '$#,##0.00',
  CNY: '¥#,##0.00',
  AUD: '"A$"#,##0.00',
  NZD: '"NZ$"#,##0.00',
  EUR: '€#,##0.00',
}[normalizeEquipmentCurrency(value)] || '"$"#,##0.00');
const supportedCurrencies = new Set(['USD', 'CNY', 'AUD', 'NZD', 'EUR']);
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const calculateEquipmentPricing = (row: any) => {
  const unitCost = numberOrNull(row?.unit_cost);
  const markup = numberOrNull(row?.markup);
  const quantity = numberOrNull(row?.quantity);
  const sellingPrice = unitCost != null && Number.isFinite(unitCost) && markup != null && Number.isFinite(markup)
    ? roundMoney(unitCost * (1 + markup / 100))
    : null;
  const totalPrice = sellingPrice != null && quantity != null && Number.isFinite(quantity)
    ? roundMoney(quantity * sellingPrice)
    : null;
  return { selling_price: sellingPrice, total_price: totalPrice };
};
export function calculateSystemAllowance(rows: any[], allowance: any, rates: Map<string, number>) {
  const percentage = numberOrNull(allowance?.allowance_percentage);
  const targetCurrency = normalizeEquipmentCurrency(allowance?.currency);
  const targetRate = rates.get(targetCurrency);
  if (percentage == null || targetRate == null || !(targetRate > 0)) return null;
  let subtotal = 0;
  for (const row of rows) {
    if (row.source_kind === 'allowance' || row.system_id !== allowance.system_id) continue;
    const cost = numberOrNull(row.unit_cost), quantity = numberOrNull(row.quantity);
    const sourceRate = rates.get(normalizeEquipmentCurrency(row.currency));
    if (cost == null || quantity == null) continue;
    if (sourceRate == null || !(sourceRate > 0)) return null;
    subtotal += cost * quantity / sourceRate * targetRate;
  }
  return roundMoney(subtotal * percentage / 100);
}
async function withSystemAllowances(db: Db, rows: any[]) {
  if (!rows.some(row => row.source_kind === 'allowance')) return rows.map(withCalculatedPricing);
  const rates = (await db.query('SELECT currency_code,rate_per_usd FROM platform_exchange_rates')).rows;
  const rateMap = new Map<string, number>(rates.map(row => [normalizeEquipmentCurrency(row.currency_code), Number(row.rate_per_usd)]));
  if (!rateMap.has('USD')) rateMap.set('USD', 1);
  return rows.map(row => {
    if (row.source_kind !== 'allowance') return withCalculatedPricing(row);
    const unitCost = calculateSystemAllowance(rows, row, rateMap);
    return withCalculatedPricing({ ...row, quantity: 1, unit: 'EA', unit_cost: unitCost, markup: 0 });
  });
}
export const pimMarkup = (costValue: any, sellValue: any) => {
  const cost = numberOrNull(costValue);
  const sell = numberOrNull(sellValue);
  return cost != null && sell != null && cost > 0
    ? Math.round((sell - cost) / cost * 100)
    : null;
};
export const convertEquipmentCurrency = (amount: any, oldRatePerUsd: any, nextRatePerUsd: any) => {
  const value = numberOrNull(amount), oldRate = numberOrNull(oldRatePerUsd), nextRate = numberOrNull(nextRatePerUsd);
  if (value == null) return null;
  if (oldRate == null || nextRate == null || !(oldRate > 0) || !(nextRate > 0)) return null;
  return roundMoney(value / oldRate * nextRate);
};
const withCalculatedPricing = (row: any) => ({ ...row, ...calculateEquipmentPricing(row) });
export const equipmentBreakdownColumns = [
  { key: 'system', label: 'System', value: (row: any) => row.system_name || 'Unassigned' },
  { key: 'source_kind', label: 'Source', value: (row: any) => row.source_kind },
  { key: 'description', label: 'Description', value: (row: any) => row.description },
  { key: 'quantity', label: 'Qty', value: (row: any) => Number(row.quantity) },
  { key: 'unit', label: 'Unit', value: (row: any) => row.unit },
  { key: 'supplier', label: 'Supplier', value: (row: any) => row.supplier || '' },
  { key: 'manufacturer', label: 'Manufacturer', value: (row: any) => row.manufacturer || '' },
  { key: 'model', label: 'Model', value: (row: any) => row.model || '' },
  { key: 'unit_cost', label: 'Unit Cost', value: (row: any) => numberOrNull(row.unit_cost) },
  { key: 'markup', label: 'Markup %', value: (row: any) => numberOrNull(row.markup) },
  { key: 'selling_price', label: 'Selling Price', value: (row: any) => calculateEquipmentPricing(row).selling_price },
  { key: 'total_price', label: 'Total Price', value: (row: any) => calculateEquipmentPricing(row).total_price },
  { key: 'currency', label: 'Currency', value: (row: any) => row.currency },
  { key: 'lead_time', label: 'Lead Time', value: (row: any) => row.lead_time || '' },
  { key: 'exclusions', label: 'Exclusions', value: (row: any) => row.exclusions || '' },
  { key: 'notes', label: 'Notes', value: (row: any) => row.notes || '' },
];
const configurableColumnKeys = new Set(equipmentBreakdownColumns.filter(column => column.key !== 'system').map(column => column.key));
const normalizeHiddenColumns = (value: any) => Array.isArray(value)
  ? [...new Set(value.map(String).filter(key => configurableColumnKeys.has(key)))]
  : [];

export function expandAllocationProducts(
  allocation: any,
  productById: Map<string, any>,
  fallback: string,
) {
  return (Array.isArray(allocation?.products) ? allocation.products : []).map((product: any, index: number) => {
    const catalog = productById.get(String(product?.product_master_id)) || {};
    return {
      ...product,
      ...catalog,
      source_id: product?.product_master_id || allocation.id,
      source_key: `${allocation.id}:${product?.product_master_id || index}`,
      description: product?.product_name || catalog.product_name || fallback,
      quantity: product?.quantity || 1,
      unit: product?.unit || 'EA',
    };
  });
}

export function expandSandFilterProducts(allocation: any, productById: Map<string, any>) {
  return expandAllocationProducts(allocation, productById, 'Sand filter').flatMap(product => {
    const filterQuantity = Number(product.quantity);
    const mediaPerFilterKg = Number(product.sand_media_per_filter_kg);
    const lines = [{ ...product, line_kind: 'filter' }];
    if (Number.isFinite(filterQuantity) && filterQuantity > 0
        && Number.isFinite(mediaPerFilterKg) && mediaPerFilterKg > 0) {
      lines.push({
        source_id: product.source_id,
        source_key: `${product.source_key}:sand-media`,
        line_kind: 'filter_media',
        description: `${product.description} sand/media`,
        quantity: filterQuantity * mediaPerFilterKg,
        unit: 'kg',
        notes: `${mediaPerFilterKg} kg per filter × ${filterQuantity} filter${filterQuantity === 1 ? '' : 's'}`,
        product_master_id: product.product_master_id,
        sand_media_per_filter_kg: mediaPerFilterKg,
        filter_quantity: filterQuantity,
      });
    }
    return lines;
  });
}

const BIO_CRATE_MEDIA_CAPACITY_M3 = 0.238;

export function expandBiologicalMediaProducts(biologicalCase: any) {
  const result = biologicalCase?.preview_result?.media;
  if (!result) return [];
  const requiredMediaL = Number(result.required_media_l);
  const installedMediaM3 = Number(result.installed_media_m3 ?? (
    Number.isFinite(Number(result.installed_media_l)) ? Number(result.installed_media_l) / 1000
      : result.required_media_m3 ?? (Number.isFinite(requiredMediaL) ? requiredMediaL / 1000 : NaN)
  ));
  const products: any[] = [];
  if (Number.isFinite(installedMediaM3) && installedMediaM3 > 0) {
    products.push({
      source_key: `${biologicalCase.id}:bio-crates`,
      description: 'Bio media crate (1,040 × 740 × 530 mm)',
      quantity: Math.ceil(installedMediaM3 / BIO_CRATE_MEDIA_CAPACITY_M3),
      unit: 'EA',
      notes: `${BIO_CRATE_MEDIA_CAPACITY_M3} m³ media capacity per crate`,
      biological_media_result: result,
    });
  }
  if (Number.isFinite(requiredMediaL) && requiredMediaL > 0) {
    products.push({
      source_key: `${biologicalCase.id}:required-media`,
      description: 'Biological filter media',
      quantity: requiredMediaL,
      unit: 'L',
      notes: 'Required media volume from Biological Media calculation',
      biological_media_result: result,
    });
  }
  return products;
}

export function expandBioDegasPlenumProducts(plenum: any) {
  const trayCount = Number(plenum?.layout?.tray_count);
  if (!Number.isInteger(trayCount) || trayCount <= 0) return [];
  return [{
    source_key: `bio-degas-plenum:${plenum.id}:dispersion-trays`,
    description: 'Dispersion tray',
    quantity: trayCount,
    unit: 'EA',
    notes: 'Quantity from the saved Bio/Degas plenum layout',
    plenum_layout_id: plenum.id,
    layout: plenum.layout,
  }];
}

export function groupEquipmentInstrumentSources(instruments: any[]) {
  const grouped = new Map<string, any>();

  for (const instrument of instruments) {
    const definition = instrument.definition_snapshot || {};
    const tagCode = String(definition.tag_code || instrument.tag_code || '').toUpperCase();
    const isControlValve = isControlValveCode(tagCode);
    const definitionId = instrument.definition_id || definition.id || tagCode;
    const nominalSize = String(instrument.nominal_size || '').trim();
    const productId = instrument.product_master_id || instrument.product_snapshot?.id || '';
    const groupIdentity = isControlValve
      ? instrument.group_key || `legacy:${definitionId}:${nominalSize}:${productId}`
      : `product:${productId || 'unassigned'}`;
    const key = `${instrument.system_id}:${definitionId}:${groupIdentity}`;
    const current = grouped.get(key);
    if (current) {
      current.quantity += 1;
      current.instrument_ids.push(instrument.id);
      continue;
    }

    const name = definition.name || instrument.tag_code || 'Control valve';
    grouped.set(key, {
      ...instrument,
      equipment_source_key: `instrument-group:${definitionId}:${groupIdentity}`,
      instrument_ids: [instrument.id],
      quantity: 1,
      description: isControlValve && nominalSize ? `${name} — ${nominalSize}` : name,
      notes: [
        isControlValve && nominalSize ? `Nominal size: ${nominalSize}` : null,
        instrument.notes || null,
      ].filter(Boolean).join('\n') || null,
    });
  }

  return [...grouped.values()];
}

async function sources(db: Db, bookId: string) {
  const book = (await db.query('SELECT project_id FROM design_books WHERE id=$1', [bookId])).rows[0];
  if (!book) throw Object.assign(new Error('Design Book not found'), { status: 404, code: 'NOT_FOUND' });
  const systems = (await db.query(
    `SELECT * FROM systems WHERE project_id=$1 AND (LOWER(COALESCE(system_type,''))='lss'
      OR LOWER(COALESCE(system_type,'')) LIKE '%life support%'
      OR COALESCE(system_code,'') ~* '^LSS([[:space:]_-]|[0-9]|$)') ORDER BY system_code`,
    [book.project_id],
  )).rows;
  if (!systems.length) return [];
  const ids = systems.map(s => s.id);
  const tanks = (await db.query(
    `SELECT t.*, pm.product_code, pm.product_name, pm.manufacturer, pm.model, pm.cost, pm.sell_price, pm.currency
     FROM tanks t LEFT JOIN product_masters pm ON pm.id=t.product_master_id
     WHERE t.system_id=ANY($1::uuid[]) ORDER BY t.system_id,t.tank_code`, [ids])).rows;
  const equipment = (await db.query(
    `SELECT pei.*, pm.product_code, pm.product_name, pm.manufacturer, pm.model, pm.cost, pm.sell_price, pm.currency
     FROM project_equipment_items pei LEFT JOIN product_masters pm ON pm.id=pei.product_master_id
     WHERE pei.system_id=ANY($1::uuid[]) ORDER BY pei.system_id,pei.equip_code`, [ids])).rows;
  const pumps = (await db.query(
    `SELECT sps.system_id, sps.id, sps.project_equipment_item_id, sps.pump_role,
            pei.equip_code, pei.description, pei.quantity, pei.unit,
            pm.id AS product_master_id, pm.product_code, pm.product_name, pm.manufacturer,
            pm.model, pm.cost, pm.sell_price, pm.currency
     FROM system_pump_selections sps
     LEFT JOIN project_equipment_items pei ON pei.id=sps.project_equipment_item_id
     LEFT JOIN product_masters pm ON pm.id=pei.product_master_id
     WHERE sps.system_id=ANY($1::uuid[]) ORDER BY sps.system_id,sps.circuit_key`, [ids])).rows;
  const uv = (await db.query(
    `SELECT * FROM design_book_uv_selections
     WHERE design_book_id=$1 AND system_id=ANY($2::uuid[])`, [bookId, ids])).rows;
  const thermal = (await db.query(
    `SELECT t.*,pm.product_code,pm.product_name,pm.manufacturer,pm.model,pm.cost,pm.sell_price,pm.currency
     FROM design_book_thermal_selections t LEFT JOIN product_masters pm ON pm.id=t.product_master_id
     WHERE t.design_book_id=$1 AND t.system_id=ANY($2::uuid[])`,
    [bookId, ids])).rows;
  const controls = (await db.query(
    `SELECT * FROM design_book_lss_controls WHERE design_book_id=$1 AND system_id=ANY($2::uuid[])`, [bookId, ids])).rows;
  const instruments = (await db.query(
    `SELECT i.*, pm.product_code,pm.product_name,pm.manufacturer,pm.model,pm.cost,pm.sell_price,pm.currency
     FROM design_book_lss_instruments i LEFT JOIN product_masters pm ON pm.id=i.product_master_id
     WHERE i.design_book_id=$1 AND i.system_id=ANY($2::uuid[])`, [bookId, ids])).rows;
  const compactIds = systems.map(s => s.compact_unit_id).filter(Boolean);
  const compact = compactIds.length ? (await db.query(
    `SELECT lcu.id,s.id AS system_id,e.*,pm.product_code,pm.product_name,pm.manufacturer,pm.model,pm.cost,pm.sell_price,pm.currency
     FROM lss_compact_units lcu JOIN systems s ON s.compact_unit_id=lcu.id
     JOIN lss_compact_unit_equipment e ON e.compact_unit_id=lcu.id
     LEFT JOIN product_masters pm ON pm.id=e.source_product_id
     WHERE lcu.id=ANY($1::uuid[]) AND e.included=true ORDER BY s.id,e.sort_order`, [compactIds])).rows : [];
  const fractionators = (await db.query(
    `SELECT * FROM system_flow_fractionator_allocations WHERE system_id=ANY($1::uuid[])`, [ids])).rows;
  const sandFilters = (await db.query(
    `SELECT * FROM system_flow_sand_filter_allocations WHERE system_id=ANY($1::uuid[])`, [ids])).rows;
  const ozone = (await db.query(
    `SELECT * FROM design_book_ozone_calculations WHERE design_book_id=$1 AND system_id=ANY($2::uuid[])`, [bookId, ids],
  )).rows;
  const biologicalMedia = (await db.query(
    `SELECT id,system_id,preview_result,preview_stale,status
     FROM lss_biological_media_cases
     WHERE design_book_id=$1 AND system_id=ANY($2::uuid[])`,
    [bookId, ids],
  )).rows;
  const bioDegasPlenums = (await db.query(
    `SELECT id,system_id,layout,source_crate_count
     FROM design_book_bio_degas_plenum_layouts
     WHERE design_book_id=$1 AND system_id=ANY($2::uuid[])`,
    [bookId, ids],
  )).rows;
  const selectedProductIds = [...fractionators, ...sandFilters]
    .flatMap(allocation => Array.isArray(allocation.products) ? allocation.products : [])
    .map(product => String(product?.product_master_id || ''))
    .filter(id => /^[0-9a-f-]{36}$/i.test(id));
  ozone.forEach(row => {
    const raw = row.allocation_snapshot || {};
    const allocations = Array.isArray(raw.products) ? raw.products : [raw];
    allocations.forEach((product: any) => {
      if (Number(product?.quantity) > 0 && /^[0-9a-f-]{36}$/i.test(String(product.product_id))) selectedProductIds.push(String(product.product_id));
    });
  });
  const productMasters = selectedProductIds.length ? (await db.query(
    `SELECT pm.id,pm.product_code,pm.product_name,pm.manufacturer,pm.model,pm.cost,pm.sell_price,
             pd.sand_media_per_filter_kg,
            COALESCE(NULLIF(currency,''),'USD') AS currency
      FROM product_masters pm
      LEFT JOIN product_dimensions pd ON pd.product_master_id=pm.id
      WHERE pm.id=ANY($1::uuid[])`, [[...new Set(selectedProductIds)]],
  )).rows : [];
  const productById = new Map(productMasters.map(product => [String(product.id), product]));
  const uvProducts = uv.flatMap(selection => {
    const streams = Array.isArray(selection.result_snapshot?.streams) ? selection.result_snapshot.streams : [];
    return streams.filter((stream: any) => Number(stream?.unit_quantity) > 0 && (stream?.product_master_id || stream?.product_code || stream?.product_name))
      .map((stream: any, index: number) => ({
        ...stream,
        selection_id: selection.id,
        system_id: selection.system_id,
        stream_key: stream.side_stream_id || stream.stream_id || stream.circuit_key || index,
      }));
  });
  const uvProductIds = uvProducts.map((product: any) => String(product.product_master_id)).filter(id => /^[0-9a-f-]{36}$/i.test(id));
  const uvCatalog = uvProductIds.length ? (await db.query(
    `SELECT id,product_code,product_name,manufacturer,model,cost,sell_price,
            COALESCE(NULLIF(currency,''),'USD') AS currency
     FROM product_masters WHERE id=ANY($1::uuid[])`, [[...new Set(uvProductIds)]],
  )).rows : [];
  const uvById = new Map(uvCatalog.map(product => [String(product.id), product]));
  const equipmentInstruments = groupEquipmentInstrumentSources(instruments);
  const line = (kind: string, systemId: string, id: any, key: string, row: any, fallback: string, qty = 1, unit = 'EA') => {
    const cost = numberOrNull(row.cost), sell = numberOrNull(row.sell_price);
    const markup = pimMarkup(cost, sell);
    return {
      source_kind: kind, system_id: systemId, source_id: id || null, source_key: `${kind}:${key}`,
      source_snapshot: row, description: row.description || row.product_name || row.component_name || fallback,
      quantity: numberOrNull(row.quantity) ?? qty, unit: row.unit || unit, supplier: null,
      manufacturer: row.manufacturer || null, model: row.model || null, unit_cost: cost,
        markup,
        selling_price: calculateEquipmentPricing({ unit_cost: cost, markup }).selling_price,
       currency: row.currency || 'USD', lead_time: null, exclusions: null, notes: row.notes || null,
    };
  };
  return systems.flatMap(system => {
    const systemId = system.id;
    const rows = [
      ...tanks.filter(r => r.system_id === systemId).map(r => line('tank', systemId, r.id, r.id, r, `Tank ${r.tank_code}`, r.quantity || 1)),
      ...equipment.filter(r => r.system_id === systemId && !pumps.some(pump => pump.project_equipment_item_id === r.id)).map(r => line('equipment', systemId, r.id, r.id, r, r.equip_code, r.quantity || 1, r.unit || 'EA')),
      ...pumps.filter(r => r.system_id === systemId).map(r => line('pump', systemId, r.id, r.id, r, `${r.pump_role || 'Pump'} ${r.equip_code || ''}`)),
      ...uvProducts.filter(r => r.system_id === systemId).map(r => {
        const catalog = uvById.get(String(r.product_master_id)) || {};
        return line('uv', systemId, r.product_master_id || r.selection_id, `${r.selection_id}:${r.stream_key}`, { ...r, ...catalog }, r.product_name || catalog.product_name || 'UV system', r.unit_quantity, r.unit || 'EA');
      }),
      ...thermal.filter(r => r.system_id === systemId).map(r => {
        const snapshot = r.product_snapshot || r.result_snapshot || r;
        return line('thermal', systemId, r.id, r.id, { ...snapshot, ...r }, `${r.duty || 'Thermal'} equipment`);
      }),
      ...controls.filter(r => r.system_id === systemId).map(r => line('control_panel', systemId, r.id, r.id, r.control || r, 'Control panel')),
      ...equipmentInstruments.filter(r => r.system_id === systemId).map(r => line(
        'instrument',
        systemId,
        r.id,
        r.equipment_source_key,
        r,
        r.definition_snapshot?.name || r.tag_code || 'Field instrument',
        r.quantity,
      )),
      ...compact.filter(r => r.system_id === systemId).map(r => line('compact_unit', systemId, r.id, r.id, r, r.component_name, r.quantity || 1, r.unit || 'EA')),
      ...fractionators.filter(r => r.system_id === systemId).flatMap(r => expandAllocationProducts(r, productById, 'Foam fractionator')
        .map(product => line('fractionator', systemId, product.source_id, product.source_key, product, product.description, product.quantity, product.unit))),
      ...sandFilters.filter(r => r.system_id === systemId).flatMap(r => expandSandFilterProducts(r, productById)
        .map(product => line(product.line_kind, systemId, product.source_id, product.source_key, product, product.description, product.quantity, product.unit))),
      ...ozone.filter(r => r.system_id === systemId).flatMap(r => {
        const raw = r.allocation_snapshot || {};
        const allocations = Array.isArray(raw.products) ? raw.products : [raw];
        return allocations.filter((product: any) => Number(product?.quantity) > 0 && product?.product_id).map((product: any, index: number) => {
          const catalog = productById.get(String(product.product_id)) || {};
          return line('equipment', systemId, product.product_id, `${r.id}:${product.product_id || index}`, { ...product, ...catalog }, product.product_name || catalog.product_name || 'Ozone generator', product.quantity, product.unit || 'EA');
        });
      }),
      ...biologicalMedia.filter(r => r.system_id === systemId).flatMap(r => expandBiologicalMediaProducts(r)
        .map(product => line('equipment', systemId, r.id, product.source_key, product, product.description, product.quantity, product.unit))),
      ...bioDegasPlenums.filter(r => r.system_id === systemId).flatMap(r => expandBioDegasPlenumProducts(r)
        .map(product => line('equipment', systemId, r.id, product.source_key, product, product.description, product.quantity, product.unit))),
    ];
    return rows.map((r, index) => ({ ...r, sort_order: index }));
  });
}

async function sync(db: Db, bookId: string, userId?: string) {
  let breakdown = (await db.query('SELECT * FROM design_book_equipment_breakdowns WHERE design_book_id=$1', [bookId])).rows[0];
  if (!breakdown) breakdown = (await db.query(
    'INSERT INTO design_book_equipment_breakdowns (design_book_id,updated_by) VALUES ($1,$2) RETURNING *', [bookId, userId || null],
  )).rows[0];
  const next = await sources(db, bookId);
  const existing = (await db.query(
    'SELECT * FROM design_book_equipment_breakdown_lines WHERE breakdown_id=$1 ORDER BY id FOR UPDATE',
    [breakdown.id],
  )).rows;
  const nextSortOrderBySystem = new Map<string, number>();
  existing.forEach(item => {
    const key = String(item.system_id || '');
    nextSortOrderBySystem.set(key, Math.max(nextSortOrderBySystem.get(key) ?? 0, (Number(item.sort_order) || 0) + 1));
  });
  const keys = new Set(next.map(row => row.source_key));
  for (const row of next) {
    const old = existing.find(item => item.source_key === row.source_key);
    if (!old) {
      const systemKey = String(row.system_id || '');
      const nextSortOrder = nextSortOrderBySystem.get(systemKey) ?? 0;
      nextSortOrderBySystem.set(systemKey, nextSortOrder + 1);
      await db.query(`INSERT INTO design_book_equipment_breakdown_lines
        (breakdown_id,system_id,source_kind,source_id,source_key,source_snapshot,description,quantity,unit,supplier,manufacturer,model,unit_cost,markup,selling_price,currency,lead_time,exclusions,notes,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [breakdown.id,row.system_id,row.source_kind,row.source_id,row.source_key,row.source_snapshot,row.description,row.quantity,row.unit,row.supplier,row.manufacturer,row.model,row.unit_cost,row.markup,row.selling_price,row.currency,row.lead_time,row.exclusions,row.notes,nextSortOrder]);
      continue;
    }
    const overrides = old.override_fields || {};
     const value = (field: string) => overrides[field] ? old[field] : row[field];
     const pricing = calculateEquipmentPricing({ unit_cost: value('unit_cost'), markup: value('markup'), quantity: value('quantity') });
    await db.query(`UPDATE design_book_equipment_breakdown_lines SET
      system_id=$1,source_id=$2,source_snapshot=$3,description=$4,quantity=$5,unit=$6,manufacturer=$7,model=$8,unit_cost=$9,markup=$10,selling_price=$11,currency=$12,notes=$13,updated_at=NOW()
       WHERE id=$14`, [row.system_id,row.source_id,row.source_snapshot,value('description'),value('quantity'),value('unit'),value('manufacturer'),value('model'),value('unit_cost'),value('markup'),pricing.selling_price,value('currency'),value('notes'),old.id]);
  }
  const obsolete = existing.filter(item => item.source_kind !== 'manual' && !keys.has(item.source_key));
  if (obsolete.length) await db.query('DELETE FROM design_book_equipment_breakdown_lines WHERE id=ANY($1::uuid[])', [obsolete.map(item => item.id)]);
  await db.query('UPDATE design_book_equipment_breakdowns SET updated_at=NOW(),updated_by=$2 WHERE id=$1', [breakdown.id,userId || null]);
  const rows = (await db.query(`SELECT l.*,s.system_code,s.system_name FROM design_book_equipment_breakdown_lines l
    LEFT JOIN systems s ON s.id=l.system_id WHERE l.breakdown_id=$1 ORDER BY s.system_code,l.sort_order,l.created_at`, [breakdown.id])).rows;
  return withSystemAllowances(db, rows);
}

export async function readExisting(db: Db, bookId: string) {
  const breakdown = (await db.query(
    'SELECT id,hidden_columns FROM design_book_equipment_breakdowns WHERE design_book_id=$1',
    [bookId],
  )).rows[0];
  if (!breakdown) return { initialized: false, items: [], hidden_columns: [] };
  const items = (await db.query(`SELECT l.*,s.system_code,s.system_name
    FROM design_book_equipment_breakdown_lines l LEFT JOIN systems s ON s.id=l.system_id
    WHERE l.breakdown_id=$1 ORDER BY s.system_code,l.sort_order,l.created_at`, [breakdown.id])).rows;
  return { initialized: true, items: await withSystemAllowances(db, items), hidden_columns: normalizeHiddenColumns(breakdown.hidden_columns) };
}

router.get('/design-books/:id/equipment-breakdown', async (req: AuthRequest, res: Response) => {
  const result = await readExisting({ query }, String(req.params.id));
  res.json(result);
});
router.put('/design-books/:id/equipment-breakdown/columns', requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  const hiddenColumns = normalizeHiddenColumns(req.body?.hidden_columns);
  const result = await query(
    `INSERT INTO design_book_equipment_breakdowns (design_book_id,hidden_columns,updated_by)
     SELECT id,$2::jsonb,$3 FROM design_books WHERE id=$1
     ON CONFLICT (design_book_id) DO UPDATE SET hidden_columns=EXCLUDED.hidden_columns,updated_by=EXCLUDED.updated_by,updated_at=NOW()
     RETURNING hidden_columns`,
    [req.params.id, JSON.stringify(hiddenColumns), req.user?.id || null],
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Design Book not found' } });
  res.json({ hidden_columns: normalizeHiddenColumns(result.rows[0].hidden_columns) });
});
router.post('/design-books/:id/equipment-breakdown/refresh', requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  const items = await transaction(db => sync(db, String(req.params.id), req.user?.id));
  res.json({ items });
});
router.put('/design-books/:id/equipment-breakdown/order', requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  const lineIds = Array.isArray(req.body?.line_ids) ? req.body.line_ids.map(String) : [];
  const systemId = req.body?.system_id ? String(req.body.system_id) : null;
  if (!lineIds.length || new Set(lineIds).size !== lineIds.length) {
    return res.status(400).json({ error: { code: 'INVALID_ORDER', message: 'A unique ordered list of line IDs is required.' } });
  }
  const reordered = await transaction(async db => {
    const breakdown = (await db.query('SELECT id FROM design_book_equipment_breakdowns WHERE design_book_id=$1', [req.params.id])).rows[0];
    if (!breakdown) throw Object.assign(new Error('Equipment Breakdown not found'), { status: 404, code: 'NOT_FOUND' });
    const current = (await db.query(
      `SELECT id FROM design_book_equipment_breakdown_lines
       WHERE breakdown_id=$1 AND system_id IS NOT DISTINCT FROM $2::uuid
       FOR UPDATE`,
      [breakdown.id, systemId],
    )).rows.map(row => String(row.id));
    if (current.length !== lineIds.length || current.some(id => !lineIds.includes(id))) {
      throw Object.assign(new Error('The requested order must contain every current line in this system exactly once.'), { status: 409, code: 'ORDER_CHANGED' });
    }
    for (const [index, lineId] of lineIds.entries()) {
      await db.query(
        'UPDATE design_book_equipment_breakdown_lines SET sort_order=$1,updated_at=NOW() WHERE id=$2 AND breakdown_id=$3',
        [index, lineId, breakdown.id],
      );
    }
    return lineIds;
  });
  res.json({ line_ids: reordered });
});
router.put('/design-books/:id/equipment-breakdown/lines/:lineId', requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  const allowed = ['description','quantity','unit','supplier','manufacturer','model','unit_cost','markup','currency','lead_time','exclusions','notes','allowance_percentage'];
  const values: any[] = [], sets: string[] = [], fields: string[] = [];
  for (const field of allowed) if (Object.prototype.hasOwnProperty.call(req.body, field)) {
    if (['quantity','unit_cost','markup','allowance_percentage'].includes(field) && req.body[field] !== null && (!Number.isFinite(Number(req.body[field])) || Number(req.body[field]) < 0)) return res.status(400).json({ error: { code: 'INVALID_VALUE', message: `${field} must be non-negative` } });
    values.push(req.body[field] === '' ? null : req.body[field]);
    const cast = ['quantity','unit_cost','markup','allowance_percentage'].includes(field) ? '::numeric' : '';
    sets.push(`${field}=$${values.length}${cast}`);
    fields.push(field);
  }
  if (!sets.length) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'No editable fields supplied' } });
  const updated = await transaction(async db => {
    const current = (await db.query(`SELECT l.currency,l.unit_cost FROM design_book_equipment_breakdown_lines l
      JOIN design_book_equipment_breakdowns b ON b.id=l.breakdown_id
      WHERE l.id=$1 AND b.design_book_id=$2 FOR UPDATE OF l`, [req.params.lineId, req.params.id])).rows[0];
    if (!current) throw Object.assign(new Error('Breakdown line not found'), { status: 404, code: 'NOT_FOUND' });
    if (fields.includes('currency')) {
      const nextCurrency = normalizeEquipmentCurrency(req.body.currency);
      if (!supportedCurrencies.has(nextCurrency)) throw Object.assign(new Error('Currency must be USD, RMB, AUD, NZD, or EUR'), { status: 400, code: 'INVALID_CURRENCY' });
      const currencyIndex = fields.indexOf('currency');
      values[currencyIndex] = nextCurrency;
      const oldCurrency = normalizeEquipmentCurrency(current.currency);
      const explicitCostIndex = fields.indexOf('unit_cost');
      if (oldCurrency !== nextCurrency && explicitCostIndex < 0) {
        if (current.unit_cost == null) throw Object.assign(new Error('Enter a Unit Cost before changing currency'), { status: 409, code: 'CURRENCY_REQUIRES_COST' });
        const rates = (await db.query('SELECT currency_code,rate_per_usd FROM platform_exchange_rates WHERE currency_code=ANY($1::text[])', [[oldCurrency, nextCurrency]])).rows;
        const rate = (currency: string) => Number(rates.find(item => item.currency_code === currency)?.rate_per_usd);
        const converted = convertEquipmentCurrency(current.unit_cost, rate(oldCurrency), rate(nextCurrency));
        if (converted == null) throw Object.assign(new Error('An administrator must configure both exchange rates before changing currency'), { status: 409, code: 'EXCHANGE_RATE_MISSING' });
        values.push(converted); sets.push(`unit_cost=$${values.length}`); fields.push('unit_cost');
      }
    }
    const overrideParam = values.length + 1;
    const lineIdParam = values.length + 2;
    const bookIdParam = values.length + 3;
    const costExpression = fields.includes('unit_cost') ? `$${fields.indexOf('unit_cost') + 1}::numeric` : 'l.unit_cost';
    const markupExpression = fields.includes('markup') ? `$${fields.indexOf('markup') + 1}::numeric` : 'l.markup';
    const result = await db.query(`UPDATE design_book_equipment_breakdown_lines l SET ${sets.join(',')},
        selling_price=CASE
          WHEN ${costExpression} IS NULL OR ${markupExpression} IS NULL THEN NULL
          ELSE ROUND(${costExpression} * (1 + ${markupExpression} / 100), 2)
        END,
        override_fields=override_fields || $${overrideParam}::jsonb,updated_at=NOW()
      FROM design_book_equipment_breakdowns b
      WHERE l.id=$${lineIdParam} AND l.breakdown_id=b.id AND b.design_book_id=$${bookIdParam} RETURNING l.*`,
      [...values, JSON.stringify(Object.fromEntries(fields.map(f => [f, true]))), req.params.lineId, req.params.id]);
    return result.rows[0];
  });
  res.json(withCalculatedPricing(updated));
});
router.post('/design-books/:id/equipment-breakdown/lines', requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  const body = req.body || {};
  if (!String(body.description || '').trim()) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Description is required' } });
  const currency = normalizeEquipmentCurrency(body.currency);
  if (!supportedCurrencies.has(currency)) return res.status(400).json({ error: { code: 'INVALID_CURRENCY', message: 'Currency must be USD, RMB, AUD, NZD, or EUR' } });
  for (const field of ['quantity', 'unit_cost', 'markup']) {
    if (body[field] != null && body[field] !== '' && (!Number.isFinite(Number(body[field])) || Number(body[field]) < 0)) {
      return res.status(400).json({ error: { code: 'INVALID_VALUE', message: `${field} must be non-negative` } });
    }
  }
  const created = await transaction(async db => {
    const book = (await db.query('SELECT project_id FROM design_books WHERE id=$1', [req.params.id])).rows[0];
    if (!book) throw Object.assign(new Error('Design Book not found'), { status: 404, code: 'NOT_FOUND' });
    if (body.system_id) {
      const system = (await db.query('SELECT * FROM systems WHERE id=$1 AND project_id=$2', [body.system_id, book.project_id])).rows[0];
      if (!system || !isLifeSupportSystem(system)) {
        throw Object.assign(new Error('System is not an LSS in this Design Book project'), { status: 400, code: 'INVALID_SYSTEM' });
      }
    }
    const breakdown = (await db.query('SELECT id FROM design_book_equipment_breakdowns WHERE design_book_id=$1', [req.params.id])).rows[0]
      || (await db.query('INSERT INTO design_book_equipment_breakdowns (design_book_id,updated_by) VALUES ($1,$2) RETURNING id', [req.params.id,req.user?.id])).rows[0];
    const pricing = calculateEquipmentPricing(body);
    const nextOrder = Number((await db.query(
      'SELECT COALESCE(MAX(sort_order),-1)+1 AS next_order FROM design_book_equipment_breakdown_lines WHERE breakdown_id=$1 AND system_id IS NOT DISTINCT FROM $2::uuid',
      [breakdown.id, body.system_id || null],
    )).rows[0]?.next_order || 0);
    const requestedOrder = body.insert_at == null ? nextOrder : Number(body.insert_at);
    if (!Number.isInteger(requestedOrder) || requestedOrder < 0 || requestedOrder > nextOrder) {
      throw Object.assign(new Error('The requested insertion position is no longer valid. Refresh and try again.'), { status: 409, code: 'ORDER_CHANGED' });
    }
    await db.query(
      `SELECT id FROM design_book_equipment_breakdown_lines
       WHERE breakdown_id=$1 AND system_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE`,
      [breakdown.id, body.system_id || null],
    );
    if (requestedOrder < nextOrder) {
      await db.query(
        `UPDATE design_book_equipment_breakdown_lines SET sort_order=sort_order+1,updated_at=NOW()
         WHERE breakdown_id=$1 AND system_id IS NOT DISTINCT FROM $2::uuid AND sort_order >= $3`,
        [breakdown.id, body.system_id || null, requestedOrder],
      );
    }
    return (await db.query(`INSERT INTO design_book_equipment_breakdown_lines
      (breakdown_id,system_id,source_kind,source_key,description,quantity,unit,supplier,manufacturer,model,unit_cost,markup,selling_price,currency,lead_time,exclusions,notes,override_fields,sort_order)
      VALUES ($1,$2,'manual',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [breakdown.id,body.system_id || null,`manual:${randomUUID()}`,body.description.trim(),body.quantity ?? 1,body.unit || 'EA',body.supplier || null,body.manufacturer || null,body.model || null,body.unit_cost ?? null,body.markup ?? null,pricing.selling_price,currency,body.lead_time || null,body.exclusions || null,body.notes || null,JSON.stringify({ description:true,quantity:true,unit:true }),requestedOrder])).rows[0];
  });
  res.status(201).json(withCalculatedPricing(created));
});
router.post('/design-books/:id/equipment-breakdown/allowances', requireModuleManage('design_books'), async (req: AuthRequest, res: Response) => {
  const type = String(req.body?.allowance_type || '');
  const labels: Record<string, string> = {
    pipe_fittings_supports: 'Pipe, Fittings and Supports',
    cable_trays_supports: 'Cable, Cable Trays and Supports',
  };
  if (!labels[type]) return res.status(400).json({ error: { code: 'INVALID_ALLOWANCE', message: 'Select a supported allowance type' } });
  const percentage = Number(req.body?.allowance_percentage);
  if (!Number.isFinite(percentage) || percentage < 0) return res.status(400).json({ error: { code: 'INVALID_VALUE', message: 'Percentage must be non-negative' } });
  const systemId = String(req.body?.system_id || '');
  const currency = normalizeEquipmentCurrency(req.body?.currency);
  if (!supportedCurrencies.has(currency)) return res.status(400).json({ error: { code: 'INVALID_CURRENCY', message: 'Currency must be USD, RMB, AUD, NZD, or EUR' } });
  const created = await transaction(async db => {
    const book = (await db.query('SELECT project_id FROM design_books WHERE id=$1', [req.params.id])).rows[0];
    if (!book) throw Object.assign(new Error('Design Book not found'), { status: 404, code: 'NOT_FOUND' });
    const system = (await db.query('SELECT * FROM systems WHERE id=$1 AND project_id=$2', [systemId, book.project_id])).rows[0];
    if (!system || !isLifeSupportSystem(system)) throw Object.assign(new Error('System is not an LSS in this Design Book project'), { status: 400, code: 'INVALID_SYSTEM' });
    const breakdown = (await db.query('SELECT id FROM design_book_equipment_breakdowns WHERE design_book_id=$1', [req.params.id])).rows[0]
      || (await db.query('INSERT INTO design_book_equipment_breakdowns (design_book_id,updated_by) VALUES ($1,$2) RETURNING id', [req.params.id,req.user?.id])).rows[0];
    const sourceKey = `allowance:${systemId}:${type}`;
    const nextOrder = Number((await db.query(
      'SELECT COALESCE(MAX(sort_order),-1)+1 AS next_order FROM design_book_equipment_breakdown_lines WHERE breakdown_id=$1 AND system_id=$2',
      [breakdown.id, systemId],
    )).rows[0]?.next_order || 0);
    return (await db.query(
      `INSERT INTO design_book_equipment_breakdown_lines
        (breakdown_id,system_id,source_kind,source_key,source_snapshot,description,quantity,unit,unit_cost,markup,currency,allowance_percentage,sort_order)
       VALUES ($1,$2,'allowance',$3,$4,$5,1,'EA',0,0,$6,$7,$8)
       ON CONFLICT (breakdown_id,source_key) DO UPDATE SET allowance_percentage=EXCLUDED.allowance_percentage,currency=EXCLUDED.currency,updated_at=NOW()
       RETURNING *`,
      [breakdown.id, systemId, sourceKey, JSON.stringify({ allowance_type: type, basis: 'system_cost_excluding_allowances' }), labels[type], currency, percentage, nextOrder],
    )).rows[0];
  });
  res.status(201).json(created);
});
router.delete('/design-books/:id/equipment-breakdown/lines/:lineId', requireModuleManage('design_books'), async (req, res) => {
  const result = await query(`DELETE FROM design_book_equipment_breakdown_lines l USING design_book_equipment_breakdowns b
    WHERE l.id=$1 AND l.breakdown_id=b.id AND b.design_book_id=$2 AND l.source_kind IN ('manual','allowance') RETURNING l.id`, [req.params.lineId,req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Manual line not found' } });
  res.status(204).end();
});

export async function createWorkbookBuffer(items: any[], hiddenColumns: string[] = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EDP Design Book';
  const hidden = new Set(normalizeHiddenColumns(hiddenColumns));
  // Source kind is internal Design Book linkage (including manual-row identity),
  // not part of the customer-facing commercial workbook.
  const columns = equipmentBreakdownColumns.filter(column => column.key !== 'source_kind' && !hidden.has(column.key));
  const safeCell = (value: any) => {
    if (typeof value !== 'string') return value;
    return /^[=+\-@]/.test(value) ? `'${value}` : value;
  };
  const addRows = (sheet: ExcelJS.Worksheet, rows: any[]) => {
    sheet.addRow(columns.map(column => column.label));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    const columnNumber = (key: string) => {
      const index = columns.findIndex(column => column.key === key);
      return index < 0 ? null : index + 1;
    };
    const quantityColumn = columnNumber('quantity');
    const costColumn = columnNumber('unit_cost');
    const markupColumn = columnNumber('markup');
    const sellingColumn = columnNumber('selling_price');
    const totalColumn = columnNumber('total_price');
    rows.forEach(row => {
      const excelRow = sheet.addRow(columns.map(column => safeCell(column.value(row))));
      const rowNumber = excelRow.number;
      const currencyFormat = equipmentCurrencyNumberFormat(row.currency);
      if (costColumn) excelRow.getCell(costColumn).numFmt = currencyFormat;
      if (sellingColumn && costColumn && markupColumn) {
        const cost = sheet.getColumn(costColumn).letter;
        const markup = sheet.getColumn(markupColumn).letter;
        excelRow.getCell(sellingColumn).value = {
          formula: `IF(OR(${cost}${rowNumber}="",${markup}${rowNumber}=""),"",ROUND(${cost}${rowNumber}*(1+${markup}${rowNumber}/100),2))`,
          result: calculateEquipmentPricing(row).selling_price ?? '',
        };
        excelRow.getCell(sellingColumn).numFmt = currencyFormat;
      }
      if (totalColumn && quantityColumn && sellingColumn) {
        const quantity = sheet.getColumn(quantityColumn).letter;
        const selling = sheet.getColumn(sellingColumn).letter;
        excelRow.getCell(totalColumn).value = {
          formula: `IF(OR(${quantity}${rowNumber}="",${selling}${rowNumber}=""),"",ROUND(${quantity}${rowNumber}*${selling}${rowNumber},2))`,
          result: calculateEquipmentPricing(row).total_price ?? '',
        };
        excelRow.getCell(totalColumn).numFmt = currencyFormat;
      }
    });
    sheet.columns = columns.map(column => ({ header: column.label, width: Math.max(14, Math.min(34, column.label.length + 4, rows.reduce((n, row) => Math.max(n, String(column.value(row) || '').length + 2), 0))) }));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(columns.length).letter}${Math.max(1, rows.length + 1)}` };
  };
  const summary = workbook.addWorksheet('Summary'); addRows(summary, items);
  const grouped = new Map<string, any[]>();
  items.forEach(item => { const name = String(item.system_code || item.system_name || 'Unassigned').replace(/[\\/*?:[\]]/g, '-').slice(0, 31) || 'LSS'; let list = grouped.get(name); if (!list) grouped.set(name, list = []); list.push(item); });
  const usedNames = new Set(['summary']);
  grouped.forEach((rows, originalName) => {
    const base = originalName || 'LSS';
    let name = base; let suffix = 2;
    while (usedNames.has(name.toLowerCase())) name = `${base.slice(0, 28)}-${suffix++}`.slice(0, 31);
    usedNames.add(name.toLowerCase());
    addRows(workbook.addWorksheet(name), rows);
  });
  return workbook.xlsx.writeBuffer();
}

router.get('/design-books/:id/equipment-breakdown/export', async (req: AuthRequest, res: Response) => {
  const { items, hidden_columns } = await readExisting({ query }, String(req.params.id));
  const buffer = await createWorkbookBuffer(items, hidden_columns);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="design-book-equipment-breakdown.xlsx"`);
  res.send(Buffer.from(buffer));
});

export default router;