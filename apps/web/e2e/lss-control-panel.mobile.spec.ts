import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import PDFDocument from 'pdfkit';

const execFileAsync = promisify(execFile);

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

const issuedInstrumentName = 'Historic pressure transmitter with an intentionally long archived description';
const issuedProduct = 'HPT-1987 — Heritage pressure transmitter for seawater circulation systems (Retired)';
const issuedProcedure = 'CAL-PRESSURE-ARCHIVE-1987-REVISION-VERY-LONG';
const issuedDatasheet = 'ARCHIVE/DATASHEETS/PRESSURE/HPT-1987-SEA-WATER-CIRCULATION-TRANSMITTER-REV-12.pdf';
const issuedTag = 'LSS-ISSUED-ARCHIVE-PT-0001';
const issuedControlLogic = 'Alarm and stop the circulation pump when archived high-pressure limits are exceeded.';

function issuedSchedulePdf() {
  const doc = new PDFDocument();
  const chunks: Buffer[] = [];
  doc.on('data', chunk => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.text(issuedTag);
  doc.text(issuedInstrumentName);
  doc.text(issuedProduct);
  doc.text(issuedControlLogic);
  doc.end();
  return completed;
}

async function openIssuedWorkspace(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.route('**/api/v1/systems/system-1/control**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      frozen: true,
      control: { panel_type: 'PLC' },
      definitions: [],
      instruments: [{
        definition_id: 'historic-pressure',
        definition_snapshot: {
          id: 'historic-pressure',
          name: issuedInstrumentName,
          description: 'Frozen evidence retained from an issued Design Book even after the original catalog definition was retired.',
          tag_code: 'PT-HIST',
          signal_type: '4–20 mA analogue input with archived isolation requirements',
          signal_direction: 'Input',
          minimum_quantity: 1,
          allow_range_override: true,
          allow_calibration_override: true,
        },
        product_master_id: 'historic-product',
        product_snapshot: {
          id: 'historic-product',
          product_code: 'HPT-1987',
          product_name: 'Heritage pressure transmitter for seawater circulation systems',
          status: 'Retired',
        },
        tag: issuedTag,
        quantity: 1,
        control_logic: issuedControlLogic,
        range_min: -12.5,
        range_max: 9876.543,
        unit: 'kilopascals gauge (historic calibration basis)',
        calibration_required: true,
        calibration_interval_days: 365,
        calibration_procedure: issuedProcedure,
        datasheet_reference: issuedDatasheet,
      }],
    }),
  }));
  await page.goto('/e2e/fixtures/instrument-workspace.html?mode=issued');
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

  test(`${viewport.name}: issued field instrument evidence remains readable and navigable`, async ({ page }) => {
    await openIssuedWorkspace(page, viewport.width, viewport.height);

    await expect(page.getByText(/configuration is read-only/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /save control configuration/i })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: /programmable logic controller/i })).toBeDisabled();

    const table = page.getByRole('table', { name: 'Field instrument definitions' });
    const scroller = table.locator('xpath=..');
    await expect(table.getByText(issuedTag)).toBeVisible();
    await expect(page.getByLabel(`Product for ${issuedInstrumentName}`)).toHaveValue('historic-product');
    await expect(page.getByLabel(`Product for ${issuedInstrumentName}`)).toBeDisabled();
    await expect(page.getByLabel(`Range minimum for ${issuedInstrumentName}`)).toHaveValue('-12.5');
    await expect(page.getByLabel(`Range maximum for ${issuedInstrumentName}`)).toHaveValue('9876.543');
    await expect(page.getByLabel(`Range unit for ${issuedInstrumentName}`)).toHaveValue('kilopascals gauge (historic calibration basis)');
    await expect(page.getByLabel(`Calibration procedure for ${issuedInstrumentName}`)).toHaveValue(issuedProcedure);
    await expect(page.getByLabel(`Datasheet reference for ${issuedInstrumentName}`)).toHaveValue(issuedDatasheet);

    const scrollMetrics = await scroller.evaluate(element => {
      element.scrollLeft = element.scrollWidth;
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        scrollLeft: element.scrollLeft,
        right: element.getBoundingClientRect().right,
      };
    });
    expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth);
    expect(scrollMetrics.scrollLeft).toBeGreaterThan(0);
    expect(scrollMetrics.right).toBeLessThanOrEqual(viewport.width);

    await page.getByRole('button', { name: 'Cards' }).tap();
    const card = page.getByRole('article', { name: issuedInstrumentName });
    await expect(card).toBeVisible();
    await expect(card.getByText(issuedTag)).toBeVisible();
    await expect(card.getByText('Frozen product evidence')).toBeVisible();
    await expect(card.getByText('Frozen calibration and datasheet evidence')).toBeVisible();

    const cardBounds = await card.locator('input, select, textarea').evaluateAll((fields, width) =>
      fields.map(field => {
        const rect = field.getBoundingClientRect();
        return { left: rect.left, right: rect.right, disabled: (field as HTMLInputElement).disabled };
      }), viewport.width);
    expect(cardBounds.every(bound => bound.left >= 0 && bound.right <= viewport.width && bound.disabled)).toBe(true);

    await page.getByRole('button', { name: 'List' }).tap();
    await expect(table).toBeVisible();
    await expect(table.getByText(issuedTag)).toBeVisible();
  });

  test(`${viewport.name}: issued I/O schedule remains scrollable with exports reachable`, async ({ page }) => {
    await openIssuedWorkspace(page, viewport.width, viewport.height);
    const pdf = await issuedSchedulePdf();
    await page.route('**/api/v1/systems/system-1/control/io-schedule.pdf**', route => route.fulfill({
      contentType: 'application/pdf',
      headers: { 'Content-Disposition': 'attachment; filename="BOOK-ISSUED-lss-io-schedule.pdf"' },
      body: pdf,
    }));

    const schedule = page.getByRole('table', { name: 'PLC Input I/O schedule' });
    const scroller = page.getByRole('region', { name: 'I/O schedule columns' });
    const csvExport = page.getByRole('button', { name: 'Export CSV' });
    const pdfExport = page.getByRole('button', { name: 'Download PDF' });

    await expect(page.getByRole('heading', { name: 'I/O schedule preview' })).toBeVisible();
    await expect(page.getByText('Frozen saved-instance evidence')).toBeVisible();
    await expect(csvExport).toBeVisible();
    await expect(csvExport).toBeEnabled();
    await expect(pdfExport).toBeVisible();
    await expect(pdfExport).toBeEnabled();

    for (const column of ['Tag', 'Instrument', 'Signal type', 'Direction', 'Assigned product', 'Saved control logic']) {
      await expect(schedule.getByRole('columnheader', { name: column, exact: true })).toBeAttached();
    }
    await expect(schedule.getByText(issuedTag)).toBeVisible();
    await expect(schedule.getByText(issuedInstrumentName)).toBeVisible();
    await expect(schedule.getByText('4–20 mA analogue input with archived isolation requirements')).toBeVisible();
    await expect(schedule.getByText('Input', { exact: true })).toBeVisible();

    const initialMetrics = await scroller.evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
    }));
    expect(initialMetrics.scrollWidth).toBeGreaterThan(initialMetrics.clientWidth);
    expect(initialMetrics.overflowX).toBe('auto');
    expect(initialMetrics.left).toBeGreaterThanOrEqual(0);
    expect(initialMetrics.right).toBeLessThanOrEqual(viewport.width);

    await pdfExport.focus();
    await page.keyboard.press('Tab');
    await expect(scroller).toBeFocused();
    expect(await scroller.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
    await scroller.press('End');
    await expect.poll(() => scroller.evaluate(element => element.scrollLeft))
      .toBe(initialMetrics.scrollWidth - initialMetrics.clientWidth);
    await expect(schedule.getByText(issuedProduct)).toBeVisible();
    const savedLogic = schedule.getByRole('cell', { name: issuedControlLogic });
    await expect(savedLogic).toBeVisible();
    const [scrollerBounds, savedLogicBounds] = await Promise.all([scroller.boundingBox(), savedLogic.boundingBox()]);
    expect(scrollerBounds && savedLogicBounds
      && savedLogicBounds.x >= scrollerBounds.x
      && savedLogicBounds.x + savedLogicBounds.width <= scrollerBounds.x + scrollerBounds.width).toBe(true);

    await scroller.press('Home');
    await expect.poll(() => scroller.evaluate(element => element.scrollLeft)).toBe(0);
    const firstTag = schedule.getByRole('cell', { name: issuedTag });
    const [firstScrollerBounds, firstTagBounds] = await Promise.all([scroller.boundingBox(), firstTag.boundingBox()]);
    expect(firstScrollerBounds && firstTagBounds
      && firstTagBounds.x >= firstScrollerBounds.x
      && firstTagBounds.x + firstTagBounds.width <= firstScrollerBounds.x + firstScrollerBounds.width).toBe(true);

    const controlsBounds = await Promise.all([csvExport, pdfExport].map(button => button.boundingBox()));
    expect(controlsBounds.every(bounds => bounds
      && bounds.x >= 0
      && bounds.x + bounds.width <= viewport.width
      && bounds.height >= 44)).toBe(true);

    const csvDownloadPromise = page.waitForEvent('download');
    await csvExport.tap();
    const csvDownload = await csvDownloadPromise;
    expect(csvDownload.suggestedFilename()).toBe('io-schedule-system-1.csv');
    const csvPath = await csvDownload.path();
    expect(csvPath).not.toBeNull();
    const csv = await readFile(csvPath!, 'utf8');
    expect(csv).toContain(issuedTag);
    expect(csv).toContain(issuedInstrumentName);
    expect(csv).toContain(issuedProduct);
    expect(csv).toContain(issuedControlLogic);

    const pdfDownloadPromise = page.waitForEvent('download');
    await pdfExport.tap();
    const pdfDownload = await pdfDownloadPromise;
    expect(pdfDownload.suggestedFilename()).toBe('io-schedule-system-1.pdf');
    const pdfPath = await pdfDownload.path();
    expect(pdfPath).not.toBeNull();
    const { stdout: pdfText } = await execFileAsync('pdftotext', [pdfPath!, '-']);
    expect(pdfText).toContain(issuedTag);
    expect(pdfText).toContain(issuedInstrumentName);
    expect(pdfText).toContain(issuedProduct);
    expect(pdfText).toContain(issuedControlLogic);
  });
}