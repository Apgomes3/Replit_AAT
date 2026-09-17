import { expect, test } from '@playwright/test';

test('highlights tied approved offers, excludes rejected offers, and warns when rates are missing', async ({ page }) => {
  await page.goto('/e2e/fixtures/vendor-price-comparison.html');

  await expect(page.getByRole('row', { name: 'Tie A Most competitive' }).getByText('Most competitive')).toBeVisible();
  await expect(page.getByRole('row', { name: 'Tie B Most competitive' }).getByText('Most competitive')).toBeVisible();
  await expect(page.getByRole('row', { name: 'Approved Higher' }).getByText('Most competitive')).toHaveCount(0);
  await expect(page.getByRole('row', { name: 'Rejected Cheap' }).getByText('Most competitive')).toHaveCount(0);
  await expect(page.getByRole('row', { name: 'USD Quote' }).getByText('Most competitive')).toHaveCount(0);
  await expect(page.getByRole('row', { name: 'EUR Quote' }).getByText('Most competitive')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText(
    'Some item codes cannot be compared because an exchange rate is missing: NO-RATE.',
  );
});