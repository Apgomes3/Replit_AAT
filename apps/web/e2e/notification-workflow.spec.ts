import { expect, test } from '@playwright/test';

type Notification = {
  id: string;
  type: 'po_submitted' | 'system';
  title: string;
  body: string;
  entity_type: string;
  entity_id: string;
  href?: string;
  action_required: boolean;
  is_read: boolean;
  created_at: string;
};

function makeNotifications(): Notification[] {
  return Array.from({ length: 25 }, (_, index) => ({
    id: `notification-${index + 1}`,
    type: index % 2 === 0 ? 'po_submitted' : 'system',
    title: `Notification ${String(index + 1).padStart(2, '0')}`,
    body: `Details for notification ${index + 1}`,
    entity_type: 'purchase_order',
    entity_id: `po-${index + 1}`,
    ...(index === 16 ? { href: '/purchase-orders/po-17?tab=items&source=notification' } : {}),
    action_required: index % 2 === 0,
    is_read: index >= 23,
    created_at: '2025-01-01T12:00:00.000Z',
  }));
}

async function mockNotifications(page: import('@playwright/test').Page) {
  const notifications = makeNotifications();
  const readAllFilters: string[] = [];
  await page.route('**/api/v1/notifications**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');

    if (request.method() === 'PATCH' && path === '/notifications/read-all') {
      const body = request.postDataJSON() as { filter?: string };
      const filter = body.filter ?? 'all';
      readAllFilters.push(filter);
      for (const notification of notifications) {
        if (filter === 'all' || (filter === 'unread' && !notification.is_read) ||
          (filter === 'action' && notification.action_required)) {
          notification.is_read = true;
        }
      }
      await route.fulfill({ json: { success: true } });
      return;
    }

    if (request.method() === 'PATCH' && /^\/notifications\/[^/]+\/read$/.test(path)) {
      const id = path.split('/')[2];
      const notification = notifications.find(item => item.id === id);
      if (notification) notification.is_read = true;
      await route.fulfill({ json: { success: true } });
      return;
    }

    if (request.method() === 'GET' && path === '/notifications') {
      const filter = url.searchParams.get('filter') ?? 'all';
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 20);
      const filtered = notifications.filter(item =>
        filter === 'unread' ? !item.is_read :
          filter === 'action' ? item.action_required && !item.is_read : true,
      );
      await route.fulfill({
        json: {
          notifications: filtered.slice(offset, offset + limit),
          unread_count: notifications.filter(item => !item.is_read).length,
          total: filtered.length,
        },
      });
      return;
    }

    await route.continue();
  });
  return { notifications, readAllFilters };
}

test('loads notifications beyond the first page and marks a filtered group read', async ({ page }) => {
  const { readAllFilters } = await mockNotifications(page);
  await page.goto('/e2e/fixtures/notification-workflow.html');

  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.getByText('Notification 01')).toBeVisible();
  await expect(page.getByText('Notification 20', { exact: true })).toBeVisible();
  await expect(page.getByText('Notification 21', { exact: true })).toHaveCount(0);
  await expect(page.getByText('23', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByText('Notification 25', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Unread' }).click();
  await expect(page.getByRole('button', { name: 'Mark filtered read' })).toBeVisible();
  await page.getByRole('button', { name: 'Mark filtered read' }).click();
  await expect(page.getByText('No unread notifications')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark filtered read' })).toHaveCount(0);
  expect(readAllFilters).toContain('unread');
});

test('notification deep link preserves the exact record and context', async ({ page }) => {
  await mockNotifications(page);
  await page.goto('/e2e/fixtures/notification-workflow.html');
  await page.getByRole('button', { name: 'Notifications' }).click();
  await page.getByText('Notification 17', { exact: true }).click();
  await expect(page.getByLabel('Current route')).toHaveText(
    '/purchase-orders/po-17?tab=items&source=notification',
  );
});

test('shows saved-notification error states while offline and while hidden', async ({ page, context }) => {
  await mockNotifications(page);
  await page.goto('/e2e/fixtures/notification-workflow.html');
  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.getByText('Notification 01')).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByRole('alert')).toContainText('You are offline.');
  await expect(page.getByRole('alert')).toContainText('Showing saved notifications.');

  await context.setOffline(false);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('alert')).toContainText('Notifications are paused while this page is hidden.');
  await expect(page.getByRole('alert')).toContainText('Showing saved notifications.');
});