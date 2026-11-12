// Writes a reviewed import plan to the database in a single transaction.
import type { PoolClient } from 'pg';
import { withTransaction } from '../../db';
import { DECISIONS, PlanRow } from './workbook';
import { MAX_CODE_LENGTH, NEW_FAMILIES } from './rules';
import type { ExistingComponent, ExistingProduct } from './plan';

type Db = Pick<PoolClient, 'query'>;

export type ApplyResult = {
  createdProducts: string[];
  updatedProducts: string[];
  createdComponents: string[];
  updatedComponents: string[];
  createdFamilies: string[];
  skipped: number;
};

/** Checks a reviewed plan before anything is written; returns human-readable problems. */
export function validatePlan(rows: PlanRow[], existingFamilyCodes: Set<string>): string[] {
  const problems: string[] = [];
  const codes = new Map<string, number>();
  for (const r of rows) {
    const at = `Row ${r.sheetRow}`;
    if (!DECISIONS.includes(r.decision)) { problems.push(`${at}: unknown decision "${r.decision}".`); continue; }
    if (r.decision === 'SKIP') continue;
    if (!r.code) problems.push(`${at}: Code is required.`);
    else if (r.code.length > MAX_CODE_LENGTH) problems.push(`${at}: code "${r.code}" is longer than ${MAX_CODE_LENGTH} characters.`);
    if (!r.name) problems.push(`${at}: Name is required.`);
    else if (r.name.length > 255) problems.push(`${at}: name is longer than 255 characters.`);
    if (r.costUsd == null) problems.push(`${at}: Cost USD is missing (add the currency rate in Admin › Exchange Rates and re-run the dry run, or set SKIP).`);
    if (r.decision.endsWith('PRODUCT') && r.familyCode && !existingFamilyCodes.has(r.familyCode) && !NEW_FAMILIES[r.familyCode]) {
      problems.push(`${at}: unknown product family "${r.familyCode}".`);
    }
    if (r.decision === 'CREATE_PRODUCT' && !r.familyCode) problems.push(`${at}: Product family is required.`);
    if (r.decision.startsWith('CREATE') && r.code) {
      const key = r.code.toUpperCase();
      if (codes.has(key)) problems.push(`${at}: code ${r.code} is also used by row ${codes.get(key)}.`);
      codes.set(key, r.sheetRow);
    }
  }
  return problems;
}

export async function loadExisting(db: Db) {
  const products: ExistingProduct[] = (await db.query(
    `SELECT pm.product_code AS code, pm.product_name AS name, pm.model, pm.manufacturer, pf.product_family_code AS "familyCode",
            pm.power_kw::float AS "powerKw", pm.ozone_production_capacity_g_h::float AS "ozoneGh"
     FROM product_masters pm LEFT JOIN product_families pf ON pf.id = pm.product_family_id`,
  )).rows;
  const components: ExistingComponent[] = (await db.query(
    `SELECT component_code AS code, component_name AS name, model FROM components`,
  )).rows;
  const rates = Object.fromEntries((await db.query(
    `SELECT currency_code, rate_per_usd::float AS rate FROM platform_exchange_rates`,
  )).rows.map((r: any) => [r.currency_code, r.rate]));
  const familyCodes = new Set<string>((await db.query(`SELECT product_family_code FROM product_families`)).rows.map((r: any) => r.product_family_code));
  return { products, components, ratesPerUsd: rates as Record<string, number>, familyCodes };
}

export async function applyPlan(rows: PlanRow[], actorId: string | null): Promise<ApplyResult> {
  return withTransaction(async db => {
    const result: ApplyResult = { createdProducts: [], updatedProducts: [], createdComponents: [], updatedComponents: [], createdFamilies: [], skipped: 0 };
    const familyIds = await ensureFamilies(db, rows, result);
    const categoryLabels = Object.fromEntries((await db.query(`SELECT code, name FROM product_categories`)).rows.map((r: any) => [r.code, r.name]));
    const familyCategory = Object.fromEntries((await db.query(`SELECT product_family_code, category_code FROM product_families`)).rows
      .map((r: any) => [r.product_family_code, r.category_code]));

    for (const r of rows) {
      switch (r.decision) {
        case 'SKIP': result.skipped++; break;
        case 'CREATE_PRODUCT': {
          const id = (await db.query(
            `INSERT INTO product_masters
               (product_code, product_family_id, product_name, product_description, product_category, manufacturer, model,
                power_kw, ozone_production_capacity_g_h, length_mm, width_mm, height_mm,
                cost, sell_price, currency, cost_is_override, status, standard_status, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'USD',true,'Active','Active',$15)
             RETURNING id`,
            [r.code, familyIds[r.familyCode!], r.name, describe(r), categoryLabels[familyCategory[r.familyCode!]] ?? null,
              r.brand ?? r.supplier, r.model, r.powerKw, r.ozoneGh && r.ozoneGh > 0 ? r.ozoneGh : null,
              r.lengthMm, r.widthMm, r.heightMm, r.costUsd, r.sellPriceUsd, r.notes],
          )).rows[0].id;
          await upsertTechnical(db, id, r);
          await upsertVendorOption(db, id, r);
          result.createdProducts.push(r.code!);
          break;
        }
        case 'UPDATE_PRODUCT': {
          // The price list becomes the cost basis: set cost explicitly and stop BOM roll-up overwriting it.
          // Descriptive fields are only filled where empty, never overwritten.
          const updated = await db.query(
            `UPDATE product_masters SET
               cost = $2, sell_price = COALESCE($3, sell_price), currency = 'USD', cost_is_override = true,
               model = COALESCE(model, $4), manufacturer = COALESCE(manufacturer, $5),
               power_kw = COALESCE(power_kw, $6),
               ozone_production_capacity_g_h = COALESCE(ozone_production_capacity_g_h, $7),
               notes = CASE WHEN notes IS NULL OR notes = '' THEN $8 ELSE notes || E'\\n' || $8 END,
               updated_at = NOW()
             WHERE product_code = $1 RETURNING id`,
            [r.code, r.costUsd, r.sellPriceUsd, r.model, r.brand ?? r.supplier, r.powerKw,
              r.ozoneGh && r.ozoneGh > 0 ? r.ozoneGh : null, r.notes],
          );
          if (!updated.rows[0]) throw new Error(`Row ${r.sheetRow}: product ${r.code} no longer exists.`);
          await upsertTechnical(db, updated.rows[0].id, r);
          await upsertVendorOption(db, updated.rows[0].id, r);
          result.updatedProducts.push(r.code!);
          break;
        }
        case 'CREATE_COMPONENT':
          await db.query(
            `INSERT INTO components
               (component_code, component_name, component_type, component_category, description, standard_size, unit,
                status, manufacturer, model, cost, sell_price, currency, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,'EA','Active',$7,$8,$9,$10,'USD',$11,$12)`,
            [r.code, r.name, r.componentType, r.componentCategory, r.description, r.size, r.brand ?? r.supplier, r.model,
              r.costUsd, r.sellPriceUsd, r.notes, actorId],
          );
          result.createdComponents.push(r.code!);
          break;
        case 'UPDATE_COMPONENT': {
          const updated = await db.query(
            `UPDATE components SET cost = $2, sell_price = COALESCE($3, sell_price), currency = 'USD',
               model = COALESCE(model, $4), manufacturer = COALESCE(manufacturer, $5),
               standard_size = COALESCE(standard_size, $6), updated_at = NOW()
             WHERE component_code = $1 RETURNING id`,
            [r.code, r.costUsd, r.sellPriceUsd, r.model, r.brand ?? r.supplier, r.size],
          );
          if (!updated.rows[0]) throw new Error(`Row ${r.sheetRow}: component ${r.code} no longer exists.`);
          result.updatedComponents.push(r.code!);
          break;
        }
      }
    }
    return result;
  });
}

function describe(r: PlanRow): string | null {
  const parts = [r.description, r.size ? `Size: ${r.size}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

async function ensureFamilies(db: Db, rows: PlanRow[], result: ApplyResult): Promise<Record<string, string>> {
  const needed = new Set(rows.filter(r => r.decision === 'CREATE_PRODUCT' && r.familyCode).map(r => r.familyCode!));
  for (const code of needed) {
    const def = NEW_FAMILIES[code];
    if (!def) continue;
    const inserted = await db.query(
      `INSERT INTO product_families (product_family_code, product_family_name, category_code, status, description)
       VALUES ($1, $2, $3, 'Active', 'Created by the ASW price list import') ON CONFLICT (product_family_code) DO NOTHING RETURNING id`,
      [def.code, def.name, def.categoryCode],
    );
    if (inserted.rows[0]) result.createdFamilies.push(def.code);
  }
  return Object.fromEntries((await db.query(`SELECT product_family_code, id FROM product_families`)).rows.map((r: any) => [r.product_family_code, r.id]));
}

async function upsertTechnical(db: Db, productId: string, r: PlanRow) {
  if (r.powerKw != null) {
    await db.query(
      `INSERT INTO product_electrical (product_master_id, rated_power_kw) VALUES ($1, $2)
       ON CONFLICT (product_master_id) DO UPDATE SET rated_power_kw = COALESCE(product_electrical.rated_power_kw, EXCLUDED.rated_power_kw), updated_at = NOW()`,
      [productId, r.powerKw],
    );
  }
  if (r.lengthMm != null || r.widthMm != null || r.heightMm != null || r.sandKg != null) {
    await db.query(
      `INSERT INTO product_dimensions (product_master_id, length_mm, width_mm, height_mm, sand_media_per_filter_kg) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (product_master_id) DO UPDATE SET
         length_mm = COALESCE(product_dimensions.length_mm, EXCLUDED.length_mm),
         width_mm = COALESCE(product_dimensions.width_mm, EXCLUDED.width_mm),
         height_mm = COALESCE(product_dimensions.height_mm, EXCLUDED.height_mm),
         sand_media_per_filter_kg = COALESCE(product_dimensions.sand_media_per_filter_kg, EXCLUDED.sand_media_per_filter_kg),
         updated_at = NOW()`,
      [productId, r.lengthMm, r.widthMm, r.heightMm, r.sandKg],
    );
  }
}

/** One vendor option per product + supplier + supplier model; re-imports update its price. */
async function upsertVendorOption(db: Db, productId: string, r: PlanRow) {
  if (!r.supplier) return;
  const existing = await db.query(
    `SELECT id FROM vendor_options WHERE product_master_id = $1 AND vendor_name = $2 AND COALESCE(vendor_item_code, '') = COALESCE($3, '')`,
    [productId, r.supplier, r.model],
  );
  if (existing.rows[0]) {
    await db.query(`UPDATE vendor_options SET unit_price = $2, currency = $3, updated_at = NOW() WHERE id = $1`,
      [existing.rows[0].id, r.supplierCost, r.supplierCurrency]);
    return;
  }
  await db.query(
    `INSERT INTO vendor_options (vendor_option_code, product_master_id, vendor_name, manufacturer_name, vendor_item_code,
       approved_status, status, unit_price, currency)
     VALUES ($1, $2, $3, $4, $5, 'Approved', 'Active', $6, $7)`,
    // Code: "VO-" + row number + start of the product code, within VARCHAR(50).
    [`VO-${r.sheetRow}-${r.code}`.slice(0, 50), productId, r.supplier, r.brand, r.model?.slice(0, 100) ?? null, r.supplierCost, r.supplierCurrency],
  );
}
