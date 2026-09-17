import { expect, test } from '@playwright/test';

test('a designer can reshape, validate, save, reload, and stale-lock a Bio Plenum', async ({ page }) => {
  let savedLayout: Record<string, unknown> | null = null;
  let saveCount = 0;
  const replaceNumber = async (label: string, value: string) => {
    const input = page.getByLabel(label);
    await input.click();
    await input.press('ControlOrMeta+A');
    await input.pressSequentially(value);
  };

  await page.route('**/api/v1/systems/browser-system/bio-degas-plenum**', async route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      savedLayout = body.layout;
      saveCount += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ layout: savedLayout }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(savedLayout ? { layout: savedLayout, source_crate_count: 6 } : null),
    });
  });

  await page.goto('/e2e/fixtures/bio-degas-plenum-designer.html');
  await expect(page.getByRole('heading', { name: 'Bio/Degas Plenum', exact: true })).toBeVisible();
  await expect(page.getByText(/6 crates required/)).toBeVisible();

  const topView = page.getByRole('img', { name: 'Dynamic top view of plenum tank' });
  const sectionView = page.getByRole('img', { name: /Dynamic section view of plenum tank/ });
  await expect(topView).toBeVisible();
  await expect(sectionView).toBeVisible();

  await replaceNumber('External length (mm)', '5000');
  await replaceNumber('External width (mm)', '2250');
  await replaceNumber('External height (mm)', '2450');
  await replaceNumber('Water level (mm)', '1450');
  await page.getByLabel('Rows across tank').selectOption('2');

  await expect(topView.getByRole('button', { name: 'Edit length, currently 5000 mm' })).toBeVisible();
  await expect(topView.getByRole('button', { name: 'Edit width, currently 2250 mm' })).toBeVisible();
  await expect(sectionView.getByRole('button', { name: 'Edit height, currently 2450 mm' })).toBeVisible();
  await expect(sectionView.getByRole('button', { name: 'Edit water level, currently 1450 mm' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Column 2' })).toBeVisible();

  await page.getByText('Adjust individual stack positions and quantities').click();
  await expect(page.getByLabel('Crates for stack 1')).toHaveValue('3');
  await replaceNumber('Row for stack 2', '0');
  await expect(page.getByText('Two crate stacks cannot occupy the same top-view position.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save layout' })).toBeDisabled();

  await replaceNumber('Column for stack 2', '1');
  await expect(page.getByText('Two crate stacks cannot occupy the same top-view position.')).toBeHidden();
  await expect(topView.getByRole('button', { name: 'Select stack S02' })).toBeVisible();
  await expect(sectionView.getByRole('button', { name: /Stack S02, column 1, position 2, 3 crates/ })).toBeVisible();

  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByText('Bio/Degas plenum layout saved')).toBeVisible();
  await expect.poll(() => saveCount).toBe(1);

  await page.reload();
  await expect(page.getByLabel('External length (mm)')).toHaveValue('5000');
  await expect(page.getByLabel('External width (mm)')).toHaveValue('2250');
  await expect(page.getByLabel('External height (mm)')).toHaveValue('2450');
  await expect(page.getByLabel('Water level (mm)')).toHaveValue('1450');
  await page.getByText('Adjust individual stack positions and quantities').click();
  await expect(page.getByLabel('Column for stack 2')).toHaveValue('1');

  await page.getByRole('button', { name: 'Mark Biological Media result stale' }).click();
  await expect(page.getByText(/Biological Media result is stale/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save layout' })).toBeDisabled();

  await page.reload();
  await expect(page.getByText(/Biological Media result is stale/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save layout' })).toBeDisabled();
  await expect(page.getByLabel('External length (mm)')).toHaveValue('5000');
  await page.getByText('Adjust individual stack positions and quantities').click();
  await expect(page.getByLabel('Column for stack 2')).toHaveValue('1');
  expect(saveCount).toBe(1);
});