import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
];

async function openWorkspace(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.route('**/api/v1/systems/system-1/control**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      control: { panel_type: 'GPO' },
      definitions: [{
        id: 'pressure',
        name: 'Pressure transmitter with an intentionally long field label',
        description: 'Monitors the circulation header pressure and protects the pump from an unsafe operating condition.',
        tag_code: 'PT',
        signal_type: 'Analog',
        signal_direction: 'Input',
        minimum_quantity: 1,
        allow_range_override: true,
        allow_calibration_override: true,
      }],
      instruments: [{
        definition_id: 'pressure',
        tag: 'LSS-01-PT-01',
        quantity: 1,
        control_logic: 'Alarm high',
      }],
    }),
  }));
  await page.goto('/e2e/fixtures/instrument-workspace.html');
  await expect(page.getByRole('heading', { name: 'LSS-01 · Field Instruments' })).toBeVisible();
}

for (const viewport of viewports) {
  test(`${viewport.name}: field instrument list and cards remain usable`, async ({ page }) => {
    await openWorkspace(page, viewport.width, viewport.height);

    const list = page.getByRole('button', { name: 'List' });
    const cards = page.getByRole('button', { name: 'Cards' });
    await expect(list).toBeVisible();
    await expect(cards).toBeVisible();
    expect((await list.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect((await cards.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    const table = page.getByRole('table', { name: 'Field instrument definitions' });
    const scroller = table.locator('xpath=..');
    await expect(table).toBeVisible();
    const listMetrics = await scroller.evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
      right: element.getBoundingClientRect().right,
    }));
    expect(listMetrics.scrollWidth).toBeGreaterThan(listMetrics.clientWidth);
    expect(listMetrics.overflowX).toBe('auto');
    expect(listMetrics.right).toBeLessThanOrEqual(viewport.width);

    const logic = page.getByLabel('Control logic for Pressure transmitter with an intentionally long field label');
    await logic.fill('Trip pump on high pressure');
    await cards.tap();

    const card = page.getByRole('article', { name: 'Pressure transmitter with an intentionally long field label' });
    await expect(card).toBeVisible();
    await expect(page.getByLabel('Control logic for Pressure transmitter with an intentionally long field label'))
      .toHaveValue('Trip pump on high pressure');

    const bounds = await card.locator('input, select, textarea').evaluateAll((fields, width) =>
      fields.map(field => {
        const rect = field.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width };
      }), viewport.width);
    expect(bounds.every(bound => bound.left >= 0 && bound.right <= bound.width)).toBe(true);

    await list.tap();
    await expect(page.getByLabel('Control logic for Pressure transmitter with an intentionally long field label'))
      .toHaveValue('Trip pump on high pressure');
  });
}