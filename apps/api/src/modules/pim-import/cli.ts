// ASW price list → PIM import (one-time migration with a reviewed dry run).
//
//   npm run import:pricelist -- --dry-run --file "<price list.xlsx>" [--out review.xlsx] [--date 2024-06-24]
//       Reads the price list and the database (no writes) and writes a review spreadsheet.
//   npm run import:pricelist -- --apply review.xlsx
//       Validates the reviewed spreadsheet and imports it in one transaction (all or nothing).
//
// Uses DATABASE_URL from .env.
import path from 'path';
import pool from '../../db';
import { logAudit } from '../../db/audit';
import { applyPlan, loadExisting, validatePlan } from './apply';
import { buildPlan } from './plan';
import { readLssEquipment, readReview, writeReview, PlanRow } from './workbook';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function summarise(rows: PlanRow[]) {
  const count = (d: string) => rows.filter(r => r.decision === d).length;
  const missingRates = [...new Set(rows.filter(r => r.decision !== 'SKIP' && r.costUsd == null && r.supplierCurrency).map(r => r.supplierCurrency!))];
  return { count, missingRates, warnings: rows.filter(r => r.warnings).length };
}

async function dryRun() {
  const file = arg('--file');
  if (!file) throw new Error('--file "<price list.xlsx>" is required');
  const out = arg('--out') ?? path.resolve(`asw-pricelist-review-${new Date().toISOString().slice(0, 10)}.xlsx`);
  const date = arg('--date') ?? (path.basename(file).match(/(\d{4})(\d{2})(\d{2})/)?.slice(1).join('-') ?? 'unknown date');

  const source = await readLssEquipment(file);
  const existing = await loadExisting({ query: (text: string, params?: any[]) => pool.query(text, params) } as any);
  const rows = buildPlan(source, { ...existing, priceListDate: date });
  const s = summarise(rows);

  await writeReview(out, rows, [
    ['ASW price list import — review', `Source: ${path.basename(file)} (sheet "LSS Equipment", ${source.length} rows), price list date ${date}`],
    ['Generated', new Date().toISOString()],
    ['', ''],
    ['Create products', s.count('CREATE_PRODUCT')],
    ['Update existing products (prices)', s.count('UPDATE_PRODUCT')],
    ['Create components', s.count('CREATE_COMPONENT')],
    ['Update existing components', s.count('UPDATE_COMPONENT')],
    ['Skip', s.count('SKIP')],
    ['Rows with warnings', s.warnings],
    ['Currencies without an app exchange rate', s.missingRates.join(', ') || 'none'],
    ['', ''],
    ['How to review', 'Open the "Review" sheet. Green headers can be edited: Decision, Code, family/type, Name, Description, Size, prices and technical values.'],
    ['', 'Filter the Warnings column first. "Suggested match" rows update an existing product — change Decision to CREATE_PRODUCT if it is a different item.'],
    ['', 'UPDATE_* rows: Code must be the existing product/component code. CREATE_* rows: Code is the new code (max 50 characters, unique).'],
    ['', 'Updates set cost and sell price and only fill empty descriptive fields; names and descriptions of existing products are not changed.'],
    ['Missing exchange rates', 'Add them in Shark OS › Admin › Exchange Rates, then run the dry run again (rows without Cost USD cannot be imported).'],
    ['Apply', 'npm run import:pricelist -- --apply <this file>   (all-or-nothing; nothing is written if any row has a problem)'],
  ]);
  console.log(`Review file: ${out}`);
  console.log(`create products ${s.count('CREATE_PRODUCT')}, update products ${s.count('UPDATE_PRODUCT')}, create components ${s.count('CREATE_COMPONENT')}, update components ${s.count('UPDATE_COMPONENT')}, skip ${s.count('SKIP')}; ${s.warnings} rows with warnings; missing rates: ${s.missingRates.join(', ') || 'none'}`);
}

async function apply() {
  const file = arg('--apply');
  if (!file) throw new Error('--apply <review.xlsx> is required');
  const rows = await readReview(file);
  const { familyCodes } = await loadExisting({ query: (text: string, params?: any[]) => pool.query(text, params) } as any);
  const problems = validatePlan(rows, familyCodes);
  if (problems.length) {
    console.error(`Nothing was imported — ${problems.length} problem(s) in the review file:`);
    problems.slice(0, 50).forEach(p => console.error(`  - ${p}`));
    if (problems.length > 50) console.error(`  … and ${problems.length - 50} more`);
    process.exitCode = 1;
    return;
  }
  const result = await applyPlan(rows, null);
  await logAudit(null, 'pim_import', 'asw-pricelist', 'IMPORT', {
    summary: 'ASW price list import',
    file: path.basename(file),
    created_products: result.createdProducts.length,
    updated_products: result.updatedProducts.length,
    created_components: result.createdComponents.length,
    updated_components: result.updatedComponents.length,
    created_families: result.createdFamilies,
    skipped: result.skipped,
  });
  console.log(`Imported: ${result.createdProducts.length} products created, ${result.updatedProducts.length} updated; `
    + `${result.createdComponents.length} components created, ${result.updatedComponents.length} updated; `
    + `families created: ${result.createdFamilies.join(', ') || 'none'}; ${result.skipped} rows skipped.`);
}

(process.argv.includes('--apply') ? apply() : process.argv.includes('--dry-run') ? dryRun() : Promise.reject(new Error('Use --dry-run or --apply')))
  .catch(e => { console.error(e.message || e); process.exitCode = 1; })
  .finally(() => pool.end());
