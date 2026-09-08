import { expect, test } from '@playwright/test';

test('a local reference image is painted behind interactive footprint geometry', async ({ page }) => {
  await page.goto('/e2e/fixtures/custom-footprint-editor.html');
  const surface = page.getByRole('img', { name: 'Footprint drawing surface' });
  const beforeReference = await surface.screenshot();
  const input = page.getByLabel('Choose reference image');
  await input.setInputFiles({
    name: 'reference.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABQAAAAKAQMAAACOm+ylAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8AAP///0EdNBEAAAABYktHRAH/Ai3eAAAAB3RJTUUH6gkHCR00OsVrqgAAAAxJREFUCNdjYCAOAAAAKAAB5Hdt2wAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wOS0wN1QwOToyOTo1MiswMDowMKFE3nQAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDktMDdUMDk6Mjk6NTIrMDA6MDDQGWbIAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTA5LTA3VDA5OjI5OjUyKzAwOjAwhwxHFwAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(page.getByText('“reference.png” is ready to trace.')).toBeVisible();
  await expect.poll(async () => {
    const withReference = await surface.screenshot();
    return withReference.equals(beforeReference);
  }).toBe(false);

  const image = page.getByTestId('footprint-reference-image');
  await expect(image).toBeVisible();
  const painted = await image.evaluate(element => {
    const imageElement = element as SVGImageElement;
    const rect = imageElement.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      href: imageElement.href.baseVal,
      pointerEvents: getComputedStyle(imageElement).pointerEvents,
      firstLayer: imageElement.parentElement?.firstElementChild === imageElement,
    };
  });
  expect(painted.width).toBeGreaterThan(0);
  expect(painted.height).toBeGreaterThan(0);
  expect(painted.href).toMatch(/^blob:/);
  expect(painted.pointerEvents).toBe('none');
  expect(painted.firstLayer).toBe(true);

  await surface.click({ position: { x: 40, y: 40 } });
  await expect(surface).toBeFocused();
});

test('an animated GIF reference stays on its first frame while tracing', async ({ page }) => {
  await page.goto('/e2e/fixtures/custom-footprint-editor.html');
  await page.getByLabel('Choose reference image').setInputFiles({
    name: 'animated-reference.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('R0lGODlhAgACAIEAAP8AAAAA/////yH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQFCgAAACwAAAAAAgACAIEAAP8AAAAA/////wgGAAEIBBAQADs=', 'base64'),
  });
  await expect(page.getByText('“animated-reference.gif” is ready to trace.')).toBeVisible();

  const image = page.getByTestId('footprint-reference-image');
  await expect(image).toHaveAttribute('href', /^blob:/);
  const firstFrame = await image.screenshot();
  await page.waitForTimeout(750);
  const laterFrame = await image.screenshot();
  expect(laterFrame.equals(firstFrame)).toBe(true);
});