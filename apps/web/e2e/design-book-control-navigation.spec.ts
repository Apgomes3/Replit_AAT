import { expect, test, type Page } from '@playwright/test';

const book = {
  id: 'book-1',
  book_code: 'DB-001',
  book_title: 'Aquarium Design Book',
  revision: 'A',
  status: 'Draft',
  project_id: null,
  exhibits: [],
  tanks: [],
  thermal_calculations: [],
  friction_loss_calculations: [],
  systems: [
    {
      id: 'system-1',
      system_code: 'LSS-01',
      system_name: 'Main LSS',
      system_type: 'Life Support',
      status: 'Draft',
    },
    {
      id: 'system-2',
      system_code: 'P-01',
      system_name: 'Unrelated Pump',
      system_type: 'Pump',
      status: 'Draft',
    },
  ],
  lss_controls: [{
    system_id: 'system-1',
    control: { panel_type: 'GPO' },
  }],
};

async function openDesignBook(page: Page, target: string) {
  await page.route('**/api/v1/thermal-correlations', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ items: [] }),
  }));
  await page.route('**/api/v1/design-books/book-1', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(book),
  }));
  await page.route('**/api/v1/systems/system-1/control**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      control: { panel_type: 'GPO' },
      definitions: [],
      instruments: [],
      products: [],
    }),
  }));
  await page.goto(`/e2e/fixtures/design-book-control-navigation.html?target=${encodeURIComponent(target)}`);
}

test('Control tab resets retained system links while explicit Control links still open the LSS', async ({ page }) => {
  await openDesignBook(page, '/design-books/book-1?tab=thermal&system=system-1&revision=revision-2');
  await expect(page.getByRole('button', { name: /Thermal/ })).toHaveClass(/border-blue-600/);

  await page.getByRole('button', { name: /Control and Field Instruments/ }).click();

  await expect(page).toHaveURL('/design-books/book-1?tab=control&revision=revision-2');
  await expect(page.getByRole('heading', { name: 'Control and Field Instruments' })).toBeVisible();
  await expect(page.getByText('Main LSS')).toBeVisible();
  await expect(page.getByText('Unrelated Pump')).toHaveCount(0);

  await openDesignBook(page, '/design-books/book-1?tab=control&system=system-1');

  await expect(page).toHaveURL('/design-books/book-1?tab=control&system=system-1');
  await expect(page.getByRole('heading', { name: 'Main LSS' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Control panel' })).toBeVisible();
});