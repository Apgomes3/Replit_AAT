import { test, expect } from '@playwright/test';

test('server-paged work, filters, deep link and return state survive navigation', async ({ page }) => {
  const requested: string[] = [];
  await page.route('**/api/v1/search/my-work?*', route => {
    const url = new URL(route.request().url());
    requested.push(url.search);
    const pageNumber = Number(url.searchParams.get('page') || 1);
    const filtered = url.searchParams.get('module') === 'orders';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      total: filtered ? 251 : 0, page: pageNumber, page_size: 25,
      results: filtered ? [{ id: `po-${pageNumber}`, type: 'purchase_order', module: 'orders', code: `PO-${pageNumber}`,
        name: 'Pump', status: 'po_review', href: `/purchase-orders/po-${pageNumber}` }] : [],
    }) });
  });
  await page.goto('/e2e/fixtures/unified-work.html?target=%2Fmy-work');
  await expect(page.getByText('No work matches these filters.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Module' }).selectOption('orders');
  await expect(page.getByText('251 items needing attention')).toBeVisible();
  await page.getByRole('combobox', { name: 'Due date' }).selectOption('overdue');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Page 2 of 11')).toBeVisible();
  await page.getByRole('link', { name: /PO-2/ }).click();
  await expect(page).toHaveURL('/purchase-orders/po-2');
  await page.getByRole('link', { name: 'Return to My Work' }).click();
  await expect(page).toHaveURL('/my-work?module=orders&due=overdue&page=2');
  await expect(page.getByText('Page 2 of 11')).toBeVisible();
  expect(requested.some(q => q.includes('page=2') && q.includes('due=overdue'))).toBe(true);
});

test('search displays a no-results message and does not fetch before two characters', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/v1/search?*', route => {
    requests++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, results: [], page_size: 25, query: 'xy' }) });
  });
  await page.goto('/e2e/fixtures/unified-work.html?target=%2Fsearch');
  await expect(page.getByText('Enter at least 2 characters to search.')).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole('textbox', { name: 'Search records' }).fill('xy');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('No records match this search.')).toBeVisible();
  expect(requests).toBe(1);
});