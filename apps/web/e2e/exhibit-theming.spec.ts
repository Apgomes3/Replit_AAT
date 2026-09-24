import { expect, test } from '@playwright/test';
import { rejectUnexpectedApiRequests } from './fixtures/api-request-guard';

test('custom tank percentage preview, save and refreshed hydraulic displacement use the same gross volume', async ({ page }) => {
  let gross = 320; // 50 m² × 2.9 m × 2 tanks, plus a 30 m³ PIM tank
  let saved: any = null;
  let submitted: any = null;
  await rejectUnexpectedApiRequests(page);
  await page.route('**/api/v1/design-books/book-1/exhibits/exhibit-1/substrate', async route => {
    submitted = route.request().postDataJSON();
    saved = {
      exhibit_id: 'exhibit-1',
      substrate_volume_m3: submitted.substrate_volume_m3,
      theming_volume_pct: submitted.theming_volume_pct,
      theming_volume_m3: null,
      theming_height_mm: null,
      theming_type: submitted.theming_type,
    };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(saved) });
  });
  await page.route('**/api/v1/design-books/book-1', route => {
    const pct = saved?.theming_volume_pct ?? 0;
    const displaced = gross * pct / 100;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'book-1', book_code: 'DB-001', book_title: 'Aquarium',
        status: 'Draft', project_id: null,
        exhibits: [{ id: 'exhibit-1', exhibit_name: 'Main Exhibit', exhibit_code: 'EX-1' }],
        tanks: [
          {
            id: 'tank-1', tank_name: 'Main Tank', tank_code: 'TK-1',
            exhibit_id: 'exhibit-1', quantity: 2, shape_type: 'Custom', eff_shape: 'Custom',
            eff_water_level_mm: gross === 320 ? 2900 : 2500,
          },
          {
            id: 'tank-2', tank_name: 'PIM Tank', tank_code: 'TK-2',
            exhibit_id: 'exhibit-1', quantity: 1, shape_type: 'Custom',
            project_operating_volume_m3: 30,
          },
        ],
        substrate: saved ? [saved] : [],
        species: [], hydraulics: [], lights: [], systems: [],
        engineering_calculations: {
          exhibits: [{
            inputs: {
              exhibit_id: 'exhibit-1',
              tanks: [{ formula: 'Saved custom footprint area × operating water level ÷ 1,000' }],
              gross_operating_volume_m3: gross,
              substrate_volume_m3: saved?.substrate_volume_m3 || 0,
              theming_volume_m3: displaced,
            },
            results: { operating_volume_m3: gross - (saved?.substrate_volume_m3 || 0) - displaced },
          }],
        },
      }),
    });
  });

  await page.goto('/e2e/fixtures/exhibit-theming.html');
  await expect(page.getByText('Theming & Substrate', { exact: true })).toBeVisible();
  const section = page.locator('div.bg-white').filter({ has: page.getByText('Theming & Substrate', { exact: true }) }).last();
  await section.getByRole('button', { name: 'Edit' }).click();
  await section.getByRole('button', { name: '% Vol' }).click();
  await section.getByPlaceholder('e.g. 15', { exact: true }).fill('10');
  await expect(section.getByText(/Gross operating volume from saved custom footprint and water level:/)).toContainText('320.0000 m³');
  await expect(section.getByText('32.0000 m³', { exact: true }).first()).toBeVisible();
  await section.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => submitted?.theming_volume_pct).toBe(10);
  expect(submitted.theming_volume_m3).toBeNull();
  await expect(section.getByText(/10% of gross operating volume = 32.0000 m³ displaced/)).toBeVisible();

  gross = 280;
  await page.goto('/e2e/fixtures/exhibit-theming.html');
  await expect(page.getByText(/10% of gross operating volume = 28.0000 m³ displaced/)).toBeVisible();
  await expect(page.getByText('252.000 m³', { exact: true })).toBeVisible();
});