import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/notifications', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ notifications: [], unread_count: 0 }),
  }));
});

test('legacy deep links redirect and canonical detail routes expose active navigation and breadcrumbs', async ({ page }) => {
  await page.goto('/e2e/fixtures/navigation-integrity.html?target=%2Forders');
  await expect(page).toHaveURL('/order-management');

  await page.goto('/e2e/fixtures/navigation-integrity.html?target=%2Fpurchase-orders%2Fpo-1');
  await expect(page.getByRole('link', { name: 'Purchase Orders', exact: true }).last()).toHaveClass(/text-blue-600/);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Order Management');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('PO-1001');
  await expect(page.getByRole('link', { name: 'Purchase Orders', exact: true }).first()).toHaveAttribute('href', '/purchase-orders');
});

test('detail back action restores the originating filtered register', async ({ page }) => {
  await page.goto('/e2e/fixtures/navigation-integrity.html?target=%2Fpurchase-orders%3Fstatus%3Dpo_review%26q%3Dpump');
  await page.getByRole('link', { name: 'Open PO-1001' }).click();
  await expect(page).toHaveURL('/purchase-orders/po-1');
  await page.getByRole('link', { name: 'Return to Purchase Orders' }).click();
  await expect(page).toHaveURL('/purchase-orders?status=po_review&q=pump');
});

for (const origin of [
  { path: '/projects/project-1?tab=bom-release', expected: '/projects/project-1?tab=bom-release', label: 'PRJ-01' },
  { path: '/systems/system-1?tab=equipment', expected: '/systems/system-1?tab=equipment', label: 'SYS-01' },
]) {
  test(`purchase orders return to their ${origin.label} origin`, async ({ page }) => {
    await page.goto(`/e2e/fixtures/navigation-integrity.html?target=${encodeURIComponent(origin.path)}`);
    await page.getByRole('link', { name: 'Open origin PO' }).click();
    await page.getByRole('link', { name: `Return to ${origin.label}` }).click();
    await expect(page).toHaveURL(origin.expected);
  });
}

test('keyboard focus and narrow-screen navigation remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('nav-sidebar-collapsed', 'true'));
  await page.goto('/e2e/fixtures/navigation-integrity.html?target=%2Fpurchase-orders');

  const open = page.getByRole('button', { name: 'Open navigation' });
  await expect(open).toBeVisible();
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Purchase Orders' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse Order Management' })).toBeVisible();

  await page.getByRole('button', { name: 'Collapse Order Management' }).focus();
  await expect(page.getByRole('button', { name: 'Collapse Order Management' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/order-management');
  await expect(open).toBeVisible();
  await expect(page.getByRole('link', { name: 'Purchase Orders' })).not.toBeVisible();

  await open.click();
  await page.getByRole('button', { name: 'Platform Admin' }).click();
  await page.getByRole('menuitem', { name: 'Users' }).click();
  await expect(page).toHaveURL('/admin/users');
  await expect(open).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Users' })).not.toBeVisible();
});