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

function valveSchedulePdf(lines: string[]) {
  const doc = new PDFDocument();
  const chunks: Buffer[] = [];
  doc.on('data', chunk => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  lines.forEach(line => doc.text(line));
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

test('control valve size groups retain their own actuator evidence after save and reload', async ({ page }) => {
  const definition = {
    id: 'two-way-valve',
    name: 'Two way control valve',
    description: 'Modulating two-way control valve and actuator assembly.',
    tag_code: '2BV',
    signal_type: 'Analog',
    signal_direction: 'Output',
    minimum_quantity: 0,
  };
  const products = [
    { id: 'actuator-small', product_code: 'ACT-050', product_name: 'DN50 valve actuator', status: 'Active' },
    { id: 'actuator-medium', product_code: 'ACT-075', product_name: 'DN75 valve actuator', status: 'Active' },
    { id: 'actuator-large', product_code: 'ACT-100', product_name: 'DN100 valve actuator', status: 'Active' },
  ];
  let savedInstruments: any[] = [];
  let savedPayload: any;
  let nextSequence = 1;

  await page.route('**/api/v1/products/masters**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ items: products }),
  }));
  await page.route('**/api/v1/systems/system-1/control**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/io-schedule.pdf')) {
      const pdf = await valveSchedulePdf(savedInstruments.flatMap(item => [
        item.tag,
        item.nominal_size,
        `${item.product_snapshot.product_code} — ${item.product_snapshot.product_name}`,
      ]));
      await route.fulfill({
        contentType: 'application/pdf',
        headers: { 'Content-Disposition': 'attachment; filename="valve-schedule.pdf"' },
        body: pdf,
      });
      return;
    }
    if (route.request().method() === 'PUT') {
      savedPayload = route.request().postDataJSON();
      savedInstruments = savedPayload.instruments.flatMap((group: any) => {
        const existing = savedInstruments.filter(item => item.group_key === group.group_key);
        const retained = existing.slice(0, group.quantity).map(item => ({
          ...item,
          nominal_size: group.nominal_size,
          ...(Object.prototype.hasOwnProperty.call(group, 'product_master_id') ? {
            product_master_id: group.product_master_id,
            product_snapshot: products.find(product => product.id === group.product_master_id),
          } : {}),
        }));
        const added = Array.from({ length: Math.max(0, group.quantity - retained.length) }, () => {
          const sequence = nextSequence++;
          const selectedProductId = Object.prototype.hasOwnProperty.call(group, 'product_master_id')
            ? group.product_master_id
            : null;
          return {
            id: `${group.group_key}-${sequence}`,
            definition_id: definition.id,
            definition_snapshot: definition,
            group_key: group.group_key,
            nominal_size: group.nominal_size,
            quantity: 1,
            tag: `LSS-01-2BV-${String(sequence).padStart(2, '0')}`,
            product_master_id: selectedProductId,
            product_snapshot: products.find(product => product.id === selectedProductId),
            control_logic: null,
          };
        });
        return [...retained, ...added];
      });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        control: { panel_type: 'PLC' },
        definitions: [definition],
        instruments: savedInstruments,
      }),
    });
  });

  await page.goto('/e2e/fixtures/instrument-workspace.html?mode=valves');
  await expect(page.getByRole('heading', { name: 'LSS-01 · Field Instruments' })).toBeVisible();
  await page.waitForLoadState('networkidle');

  const sizes = page.getByLabel('Nominal size for 2-way Electric Ball Valve');
  const quantities = page.getByLabel('Quantity for 2-way Electric Ball Valve');
  const actuators = page.getByLabel('Product for 2-way Electric Ball Valve');
  await sizes.first().fill('DN50');
  await quantities.first().fill('');
  await quantities.first().pressSequentially('2');
  await actuators.first().selectOption('actuator-small');
  await expect(quantities.first()).toHaveValue('2');
  await expect(actuators.first()).toHaveValue('actuator-small');
  await page.getByRole('button', { name: '＋ Add size' }).first().click();
  await expect(sizes).toHaveCount(2);
  await sizes.nth(1).fill('DN100');
  await actuators.nth(1).selectOption('actuator-large');
  await expect(sizes.nth(1)).toHaveValue('DN100');
  await expect(actuators.nth(1)).toHaveValue('actuator-large');

  await page.getByRole('button', { name: 'Save control configuration' }).click();
  await expect.poll(() => savedPayload?.instruments?.length).toBe(2);
  expect(savedPayload.instruments).toEqual(expect.arrayContaining([
    expect.objectContaining({ nominal_size: 'DN50', quantity: 2, product_master_id: 'actuator-small' }),
    expect.objectContaining({ nominal_size: 'DN100', quantity: 1, product_master_id: 'actuator-large' }),
  ]));
  expect(new Set(savedPayload.instruments.map((item: any) => item.group_key)).size).toBe(2);

  await page.reload();
  await expect(sizes).toHaveCount(2);
  await expect(sizes.first()).toHaveValue('DN50');
  await expect(sizes.nth(1)).toHaveValue('DN100');
  await expect(quantities.first()).toHaveValue('2');
  await expect(quantities.nth(1)).toHaveValue('1');
  await expect(actuators.first()).toHaveValue('actuator-small');
  await expect(actuators.nth(1)).toHaveValue('actuator-large');
  const configuration = page.getByRole('table', { name: 'Field instrument definitions' });
  await expect(configuration.getByText('LSS-01-2BV-01, LSS-01-2BV-02')).toBeVisible();
  await expect(configuration.getByRole('cell', { name: 'LSS-01-2BV-03' })).toBeVisible();

  const schedule = page.getByRole('table', { name: 'PLC Output I/O schedule' });
  await expect(schedule.getByRole('cell', { name: 'DN50', exact: true })).toHaveCount(2);
  await expect(schedule.getByRole('cell', { name: 'DN100', exact: true })).toHaveCount(1);
  await expect(schedule.getByText('ACT-050 — DN50 valve actuator (Active)')).toHaveCount(2);
  await expect(schedule.getByText('ACT-100 — DN100 valve actuator (Active)')).toHaveCount(1);

  const csvDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const csvDownload = await csvDownloadPromise;
  const csvPath = await csvDownload.path();
  const csv = await readFile(csvPath!, 'utf8');
  expect(csv).toContain('DN50');
  expect(csv).toContain('ACT-050 — DN50 valve actuator (Active)');
  expect(csv).toContain('DN100');
  expect(csv).toContain('ACT-100 — DN100 valve actuator (Active)');

  const pdfDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const pdfDownload = await pdfDownloadPromise;
  const pdfPath = await pdfDownload.path();
  const { stdout: pdfText } = await execFileAsync('pdftotext', [pdfPath!, '-']);
  expect(pdfText).toContain('DN50');
  expect(pdfText).toContain('ACT-050 — DN50 valve actuator');
  expect(pdfText).toContain('DN100');
  expect(pdfText).toContain('ACT-100 — DN100 valve actuator');

  const untouchedGroupKey = savedInstruments.find(item => item.nominal_size === 'DN100')!.group_key;
  const untouchedEvidence = savedInstruments
    .filter(item => item.group_key === untouchedGroupKey)
    .map(item => ({
      nominal_size: item.nominal_size,
      product_master_id: item.product_master_id,
      product_snapshot: item.product_snapshot,
      tag: item.tag,
    }));

  await quantities.first().fill('');
  await quantities.first().pressSequentially('3');
  await actuators.first().selectOption('actuator-medium');
  await page.getByRole('button', { name: 'Save control configuration' }).click();
  await expect.poll(() => savedInstruments.filter(item => item.nominal_size === 'DN50').length).toBe(3);
  expect(savedInstruments.filter(item => item.group_key === untouchedGroupKey).map(item => ({
    nominal_size: item.nominal_size,
    product_master_id: item.product_master_id,
    product_snapshot: item.product_snapshot,
    tag: item.tag,
  }))).toEqual(untouchedEvidence);

  await page.reload();
  await expect(quantities.first()).toHaveValue('3');
  await expect(actuators.first()).toHaveValue('actuator-medium');
  await expect(sizes.nth(1)).toHaveValue('DN100');
  await expect(actuators.nth(1)).toHaveValue('actuator-large');
  await expect(configuration.getByRole('cell', { name: 'LSS-01-2BV-03' })).toBeVisible();
  await expect(schedule.getByRole('cell', { name: 'DN100', exact: true })).toHaveCount(1);
  await expect(schedule.getByText('ACT-100 — DN100 valve actuator (Active)')).toHaveCount(1);

  const remainingGroupKey = savedInstruments.find(item => item.nominal_size === 'DN50')!.group_key;
  const remainingEvidence = savedInstruments
    .filter(item => item.group_key === remainingGroupKey)
    .map(item => ({
      nominal_size: item.nominal_size,
      product_master_id: item.product_master_id,
      product_snapshot: item.product_snapshot,
      tag: item.tag,
    }));

  await page.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Save control configuration' }).click();
  await expect.poll(() => savedInstruments.some(item => item.group_key === untouchedGroupKey)).toBe(false);
  expect(savedInstruments.map(item => ({
    nominal_size: item.nominal_size,
    product_master_id: item.product_master_id,
    product_snapshot: item.product_snapshot,
    tag: item.tag,
  }))).toEqual(remainingEvidence);

  await page.reload();
  await expect(sizes).toHaveCount(1);
  await expect(sizes.first()).toHaveValue('DN50');
  await expect(quantities.first()).toHaveValue('3');
  await expect(actuators.first()).toHaveValue('actuator-medium');
  await expect(configuration.getByText('LSS-01-2BV-01, LSS-01-2BV-02, LSS-01-2BV-04')).toBeVisible();
  await expect(schedule.getByRole('cell', { name: 'DN50', exact: true })).toHaveCount(3);
  await expect(schedule.getByText('ACT-075 — DN75 valve actuator (Active)')).toHaveCount(3);
  await expect(schedule.getByRole('cell', { name: 'DN100', exact: true })).toHaveCount(0);
  await expect(schedule.getByText('ACT-100 — DN100 valve actuator (Active)')).toHaveCount(0);
});

test('two-way and three-way valve actuation controls save the matching tags without changing siblings', async ({ page }) => {
  const definitions = [
    { id: 'two-way', name: 'Two way control valve', tag_code: '2BV', signal_type: 'Analog', signal_direction: 'Output', minimum_quantity: 0 },
    { id: 'three-way', name: 'Three way control valve', tag_code: '3EBV', signal_type: 'Analog', signal_direction: 'Output', minimum_quantity: 0 },
  ];
  const products = [
    { id: 'two-product', product_code: '2WAY', product_name: 'Two-way valve', status: 'Active' },
    { id: 'three-product', product_code: '3WAY', product_name: 'Three-way valve', status: 'Active' },
  ];
  let savedInstruments = [
    { definition_id: 'two-way', group_key: 'two-dn50', nominal_size: 'DN50', actuation_type: 'Electric', quantity: 1, product_master_id: 'two-product', product_snapshot: products[0], tag: 'LSS-01-2EBV-01' },
    { definition_id: 'three-way', group_key: 'three-dn80', nominal_size: 'DN80', actuation_type: 'Electric', quantity: 1, product_master_id: 'three-product', product_snapshot: products[1], tag: 'LSS-01-3EBV-01' },
    { definition_id: 'three-way', group_key: 'three-dn80', nominal_size: 'DN80', actuation_type: 'Electric', quantity: 1, product_master_id: 'three-product', product_snapshot: products[1], tag: 'LSS-01-3EBV-02' },
  ];
  let savedPayload: any;

  await page.route('**/api/v1/products/masters**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ items: products }),
  }));
  await page.route('**/api/v1/systems/system-1/control**', async route => {
    if (route.request().method() === 'PUT') {
      savedPayload = route.request().postDataJSON();
      savedInstruments = savedPayload.instruments.flatMap((group: any) => {
        const definition = definitions.find(item => item.id === group.definition_id)!;
        const existing = savedInstruments.find(item => item.group_key === group.group_key);
        const code = `${definition.tag_code.startsWith('3') ? '3' : '2'}${group.actuation_type === 'Pneumatic' ? 'PBV' : 'EBV'}`;
        const productMasterId = Object.prototype.hasOwnProperty.call(group, 'product_master_id')
          ? group.product_master_id
          : existing?.product_master_id || null;
        const product = products.find(item => item.id === productMasterId);
        return Array.from({ length: group.quantity }, (_, index) => ({
          ...group,
          quantity: 1,
          product_master_id: productMasterId,
          product_snapshot: product,
          tag: `LSS-01-${code}-${String(index + 1).padStart(2, '0')}`,
        }));
      });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ control: { panel_type: 'PLC' }, definitions, instruments: savedInstruments }),
    });
  });

  await page.goto('/e2e/fixtures/instrument-workspace.html?mode=valves');
  await page.waitForLoadState('networkidle');
  const table = page.getByRole('table', { name: 'Field instrument definitions' });
  const twoType = page.getByLabel('Type for 2-way Electric Ball Valve');
  const threeType = page.getByLabel('Type for 3-way Electric Ball Valve');

  await expect(table.getByText('2EBV', { exact: true })).toBeVisible();
  await expect(table.getByText('3EBV', { exact: true })).toBeVisible();
  await twoType.selectOption('Pneumatic');
  await expect(table.getByText('2PBV', { exact: true })).toBeVisible();
  await expect(table.getByText('3EBV', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Save control configuration' }).click();
  await expect.poll(() => savedPayload?.instruments?.length).toBe(2);
  expect(savedPayload.instruments).toEqual(expect.arrayContaining([
    expect.objectContaining({ definition_id: 'two-way', group_key: 'two-dn50', nominal_size: 'DN50', actuation_type: 'Pneumatic', quantity: 1 }),
    expect.objectContaining({ definition_id: 'three-way', group_key: 'three-dn80', nominal_size: 'DN80', actuation_type: 'Electric', quantity: 2 }),
  ]));

  await page.reload();
  await expect(page.getByLabel('Type for 2-way Pneumatic Ball Valve')).toHaveValue('Pneumatic');
  await expect(page.getByLabel('Nominal size for 2-way Pneumatic Ball Valve')).toHaveValue('DN50');
  await expect(page.getByLabel('Product for 2-way Pneumatic Ball Valve')).toHaveValue('two-product');
  await expect(page.getByLabel('Quantity for 2-way Pneumatic Ball Valve')).toHaveValue('1');
  await expect(table.getByRole('cell', { name: 'LSS-01-2PBV-01' })).toBeVisible();
  await expect(page.getByLabel('Type for 3-way Electric Ball Valve')).toHaveValue('Electric');
  await expect(page.getByLabel('Nominal size for 3-way Electric Ball Valve')).toHaveValue('DN80');
  await expect(page.getByLabel('Product for 3-way Electric Ball Valve')).toHaveValue('three-product');
  await expect(page.getByLabel('Quantity for 3-way Electric Ball Valve')).toHaveValue('2');
  await expect(table.getByText('LSS-01-3EBV-01, LSS-01-3EBV-02')).toBeVisible();

  await page.getByLabel('Type for 3-way Electric Ball Valve').selectOption('Pneumatic');
  await expect(table.getByText('3PBV', { exact: true })).toBeVisible();
  await expect(table.getByText('2PBV', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save control configuration' }).click();
  await expect.poll(() => savedPayload.instruments.find((item: any) => item.definition_id === 'three-way')?.actuation_type).toBe('Pneumatic');

  await page.reload();
  await expect(table.getByRole('cell', { name: 'LSS-01-2PBV-01' })).toBeVisible();
  await expect(table.getByText('LSS-01-3PBV-01, LSS-01-3PBV-02')).toBeVisible();
  await expect(page.getByLabel('Type for 2-way Pneumatic Ball Valve')).toHaveValue('Pneumatic');
  await expect(page.getByLabel('Type for 3-way Pneumatic Ball Valve')).toHaveValue('Pneumatic');
});

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
    await page.getByRole('button', { name: 'Add control details and evidence for Pressure transmitter with an intentionally long field label' }).click();
    await logic.fill('Trip pump on high pressure');
    await cards.tap();

    const card = page.getByRole('article', { name: 'Pressure transmitter with an intentionally long field label' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Add control details and evidence for Pressure transmitter with an intentionally long field label' }).click();
    await expect(page.getByLabel('Control logic for Pressure transmitter with an intentionally long field label'))
      .toHaveValue('Trip pump on high pressure');

    const bounds = await card.locator('input, select, textarea').evaluateAll((fields, width) =>
      fields.map(field => {
        const rect = field.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width };
      }), viewport.width);
    expect(bounds.every(bound => bound.left >= 0 && bound.right <= bound.width)).toBe(true);

    await list.tap();
    await page.getByRole('button', { name: 'Add control details and evidence for Pressure transmitter with an intentionally long field label' }).click();
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
    await page.getByRole('button', { name: `View control details and evidence for ${issuedInstrumentName}` }).click();
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
    await card.getByRole('button', { name: `View control details and evidence for ${issuedInstrumentName}` }).click();
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