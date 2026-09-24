import { expect, Page, test } from '@playwright/test';

const enquiry = {
  id: 'enq-1',
  enquiry_number: 'ENQ-1001',
  title: 'Current server enquiry title',
  description: 'Current server enquiry description',
  status: 'new',
  version: 2,
};

const purchaseOrder = {
  id: 'po-1',
  po_code: 'PO-1001',
  version: 2,
  status: 'draft',
  priority: 'normal',
  vendor_name: 'Current server vendor',
  items: [],
};

async function installApiFixture(
  page: Page,
  getPath: string,
  patchPath: string,
  record: unknown,
) {
  let patchBody: Record<string, unknown> | undefined;
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'GET' && pathname === getPath) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(record) });
      return;
    }
    if (request.method() === 'PATCH' && pathname === patchPath) {
      patchBody = request.postDataJSON();
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Record version is stale', current_record: record } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [] }),
    });
  });
  return () => patchBody;
}

test('EnquiryDetail submits the recovered stale version through its Save button', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('shark-draft:enquiry:admin-1:enq-1:edit', JSON.stringify({
      value: {
        id: 'enq-1',
        enquiry_number: 'ENQ-1001',
        title: 'Recovered local enquiry title',
        description: 'Recovered local enquiry description',
        status: 'new',
        project_id: null,
        design_book_id: null,
      },
      savedAt: '2025-01-01T00:00:00.000Z',
      source: '/enquiries/enq-1',
      version: '1',
    }));
  });
  const getPatchBody = await installApiFixture(page, '/enquiries/enq-1', '/enquiries/enq-1', enquiry);
  await page.goto('/e2e/fixtures/stale-version-recovery.html');

  await page.getByRole('button', { name: 'Edit enquiry' }).click();
  const recovery = page.getByRole('dialog', { name: 'Recover local draft' });
  await recovery.getByRole('button', { name: 'Restore draft' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Recovered local enquiry title');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect.poll(getPatchBody).toMatchObject({
    title: 'Recovered local enquiry title',
    expected_version: '1',
  });
  await expect(page.getByRole('status')).toContainText('Conflict');
  await expect(page.getByRole('heading', { name: 'Edit enquiry' })).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('Recovered local enquiry title');
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('shark-draft:enquiry:admin-1:enq-1:edit') || 'null')?.version,
  )).toBe('1');
});

test('PurchaseOrderDetail submits the recovered stale version through its Save button', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('shark-draft:purchase-order:admin-1:po-1:procurement-meta', JSON.stringify({
      value: { field: 'priority', values: { priority: 'high' } },
      savedAt: '2025-01-01T00:00:00.000Z',
      source: '/purchase-orders/po-1',
      version: '1',
    }));
  });
  const getPatchBody = await installApiFixture(
    page,
    '/purchase-orders/po-1',
    '/purchase-orders/po-1/procurement-meta',
    purchaseOrder,
  );
  await page.goto('/e2e/fixtures/stale-version-recovery.html?page=purchase-order');

  await page.getByText('Normal', { exact: true }).click();
  const recovery = page.getByRole('dialog', { name: 'Recover local draft' });
  await expect(recovery).toContainText('server version changed');
  await recovery.getByRole('button', { name: 'Restore draft' }).click();
  await expect(page.getByRole('combobox').last()).toHaveValue('high');
  await page.getByText('Priority', { exact: true }).locator('..').getByRole('button', { name: 'Save' }).click();

  await expect.poll(getPatchBody).toMatchObject({
    priority: 'high',
    expected_version: '1',
  });
  await expect(page.getByRole('status')).toContainText('Conflict');
  await expect(page.getByRole('combobox').last()).toHaveValue('high');
  await expect.poll(() => page.evaluate(() =>
    JSON.parse(localStorage.getItem('shark-draft:purchase-order:admin-1:po-1:procurement-meta') || 'null')?.version,
  )).toBe('1');
});