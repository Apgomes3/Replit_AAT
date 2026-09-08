import type { Page } from '@playwright/test';

export async function rejectUnexpectedApiRequests(page: Page) {
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    await route.abort('failed');
    throw new Error(
      `Unexpected API request in browser fixture: ${request.method()} ${request.url()}`,
    );
  });
}