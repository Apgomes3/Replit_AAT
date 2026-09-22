import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';

type Row = Record<string, any>;

test('system allowances recalculate, exclude one another, handle currencies, remove, and export', async ({ page }) => {
  const rates = new Map([['USD', 1], ['EUR', 0.8]]);
  let rows: Row[] = [
    {
      id: 'pump',
      system_id: 'browser-system',
      system_code: 'LSS-01',
      system_name: 'Main Life Support',
      source_kind: 'selection',
      source_key: 'pump:1',
      description: 'Circulation Pump',
      quantity: 2,
      unit: 'EA',
      unit_cost: 100,
      markup: 0,
      currency: 'USD',
    },
    {
      id: 'filter',
      system_id: 'browser-system',
      system_code: 'LSS-01',
      system_name: 'Main Life Support',
      source_kind: 'selection',
      source_key: 'filter:1',
      description: 'Sand Filter',
      quantity: 1,
      unit: 'EA',
      unit_cost: 80,
      markup: 0,
      currency: 'EUR',
    },
  ];

  const pricedRows = () => rows.map(row => {
    if (row.source_kind !== 'allowance') {
      const selling = row.unit_cost == null ? null : Number(row.unit_cost) * (1 + Number(row.markup || 0) / 100);
      return { ...row, selling_price: selling, total_price: selling == null ? null : selling * Number(row.quantity) };
    }
    const targetRate = rates.get(row.currency);
    let unitCost: number | null = null;
    if (targetRate) {
      const subtotal = rows
        .filter(item => item.system_id === row.system_id && item.source_kind !== 'allowance')
        .reduce((sum, item) => {
          const sourceRate = rates.get(item.currency);
          return sourceRate ? sum + Number(item.unit_cost) * Number(item.quantity) / sourceRate * targetRate : sum;
        }, 0);
      unitCost = Math.round(subtotal * Number(row.allowance_percentage) / 100 * 100) / 100;
    }
    return { ...row, quantity: 1, unit: 'EA', unit_cost: unitCost, markup: 0, selling_price: unitCost, total_price: unitCost };
  });

  await page.route('**/api/v1/design-books/browser-book/equipment-breakdown**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname.endsWith('/export')) {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Summary');
      sheet.addRow(['System', 'Description', 'Unit Cost', 'Currency', 'Selling Price', 'Total Price']);
      pricedRows().forEach(row => sheet.addRow([
        row.system_name, row.description, row.unit_cost, row.currency, row.selling_price, row.total_price,
      ]));
      const body = Buffer.from(await workbook.xlsx.writeBuffer());
      await route.fulfill({
        status: 200,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body,
      });
      return;
    }

    if (method === 'GET') {
      await route.fulfill({ json: { initialized: true, hidden_columns: [], items: pricedRows() } });
      return;
    }

    if (method === 'POST' && url.pathname.endsWith('/allowances')) {
      const body = request.postDataJSON();
      const labels: Record<string, string> = {
        pipe_fittings_supports: 'Pipe, Fittings and Supports',
        cable_trays_supports: 'Cable, Cable Trays and Supports',
      };
      const sourceKey = `allowance:${body.system_id}:${body.allowance_type}`;
      if (!rows.some(row => row.source_key === sourceKey)) {
        rows.push({
          id: body.allowance_type,
          system_id: body.system_id,
          system_code: 'LSS-01',
          system_name: 'Main Life Support',
          source_kind: 'allowance',
          source_key: sourceKey,
          description: labels[body.allowance_type],
          allowance_percentage: body.allowance_percentage,
          quantity: 1,
          unit: 'EA',
          unit_cost: 0,
          markup: 0,
          currency: body.currency,
        });
      }
      await route.fulfill({ status: 201, json: rows.find(row => row.source_key === sourceKey) });
      return;
    }

    const lineMatch = url.pathname.match(/\/lines\/([^/]+)$/);
    if (method === 'PUT' && lineMatch) {
      const id = lineMatch[1];
      const updates = request.postDataJSON();
      rows = rows.map(row => {
        if (row.id !== id) return row;
        if (updates.currency && rates.has(row.currency) && rates.has(updates.currency)) {
          updates.unit_cost = Math.round(Number(row.unit_cost) / rates.get(row.currency)! * rates.get(updates.currency)! * 100) / 100;
        }
        return { ...row, ...updates };
      });
      await route.fulfill({ json: pricedRows().find(row => row.id === id) });
      return;
    }

    if (method === 'DELETE' && lineMatch) {
      rows = rows.filter(row => row.id !== lineMatch[1]);
      await route.fulfill({ status: 204 });
      return;
    }

    await route.fulfill({ status: 404, json: { error: { message: 'Unexpected fixture request' } } });
  });

  await page.goto('/e2e/fixtures/equipment-breakdown.html');
  await expect(page.getByRole('heading', { name: 'Equipment Breakdown' })).toBeVisible();

  await page.getByRole('button', { name: 'Add Pipe, Fittings and Supports %' }).click();
  await page.getByRole('button', { name: 'Add Cable, Cable Trays and Supports %' }).click();
  await expect(page.getByRole('button', { name: 'Add Pipe, Fittings and Supports %' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Cable, Cable Trays and Supports %' })).toHaveCount(0);

  const pipeRow = page.getByRole('row').filter({ hasText: 'Pipe, Fittings and Supports' });
  const cableRow = page.getByRole('row').filter({ hasText: 'Cable, Cable Trays and Supports' });
  await pipeRow.locator('input[type=number]').first().fill('10');
  await pipeRow.locator('input[type=number]').first().press('Enter');
  await cableRow.locator('input[type=number]').first().fill('20');
  await cableRow.locator('input[type=number]').first().press('Enter');
  await expect(pipeRow.getByTestId('total_price-pipe_fittings_supports')).toHaveText('30.00');
  await expect(cableRow.getByTestId('total_price-cable_trays_supports')).toHaveText('60.00');

  const pumpRow = page.getByRole('button', { name: 'Drag Circulation Pump' }).locator('xpath=ancestor::tr');
  await pumpRow.locator('input[type=number]').nth(1).fill('200');
  await pumpRow.locator('input[type=number]').nth(1).press('Enter');
  await expect(pipeRow.getByTestId('total_price-pipe_fittings_supports')).toHaveText('50.00');
  await expect(cableRow.getByTestId('total_price-cable_trays_supports')).toHaveText('100.00');

  await pumpRow.getByTitle('Currency').selectOption('EUR');
  await expect(pumpRow.locator('input[type=number]').nth(1)).toHaveValue('160');
  await expect(pipeRow.getByTestId('total_price-pipe_fittings_supports')).toHaveText('50.00');

  await pipeRow.getByTitle('Currency').selectOption('AUD');
  await expect(pipeRow.getByTestId('selling_price-pipe_fittings_supports')).toBeEmpty();
  await expect(pipeRow.getByTestId('total_price-pipe_fittings_supports')).toBeEmpty();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel' }).click();
  const download = await downloadPromise;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path() as string);
  const sheet = workbook.getWorksheet('Summary')!;
  const exported = new Map<string, any[]>();
  sheet.eachRow((row, index) => {
    if (index > 1) exported.set(String(row.getCell(2).value), row.values as any[]);
  });
  expect(exported.get('Pipe, Fittings and Supports')?.[3]).toBeUndefined();
  expect(exported.get('Cable, Cable Trays and Supports')?.[3]).toBe(100);
  expect(exported.get('Cable, Cable Trays and Supports')?.[6]).toBe(100);

  await cableRow.getByTitle('Remove line').click();
  await expect(page.getByText('Cable, Cable Trays and Supports', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Cable, Cable Trays and Supports %' })).toBeVisible();
});