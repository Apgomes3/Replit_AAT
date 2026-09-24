import { expect, test } from '@playwright/test';

test('keeps interrupted edits, recovers after reload, and cleans up after save', async ({ page }) => {
  await page.goto('/e2e/fixtures/protected-draft.html');
  await page.getByRole('textbox', { name: 'Draft text' }).fill('Unsent engineering notes');
  await expect(page.getByRole('status')).toContainText('Unsaved');
  await page.getByRole('button', { name: 'Toggle request failure' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Save failed');
  await expect(page.getByRole('status')).toContainText('Interrupted request');
  await page.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await page.reload();
  const recovery = page.getByRole('dialog', { name: 'Recover local draft' });
  await expect(recovery).toContainText('protected-draft.html');
  await expect(recovery).toContainText('Unsent engineering notes');
  await recovery.getByRole('button', { name: 'Restore draft' }).click();
  await expect(page.getByRole('textbox', { name: 'Draft text' })).toHaveValue('Unsent engineering notes');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('shark-draft:browser-test:record-1'))).toBeNull();
});