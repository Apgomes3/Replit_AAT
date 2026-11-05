import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { expect, test } from '@playwright/test';

test.skip(!process.env.QUOTE_PRODUCT_E2E, 'Run npm run test:browser:quotes against a development database');

test('an enquiry can quote PIM products without engineering links and freezes the offered product evidence', async ({ page, request }) => {
  test.setTimeout(240_000);
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const suffix = randomUUID().slice(0, 8);
  const password = randomUUID();
  const ids: Record<string, string> = {};
  const code = `QTEST-${suffix}`;
  try {
    ids.user = (await db.query(
      `INSERT INTO users(email,password_hash,role) VALUES($1,$2,'admin') RETURNING id`,
      [`quote-${suffix}@example.test`, await bcrypt.hash(password, 4)],
    )).rows[0].id;
    ids.client = (await db.query(
      `INSERT INTO clients(client_code,name,created_by) VALUES($1,'Quote browser fixture',$2) RETURNING id`,
      [code, ids.user],
    )).rows[0].id;
    ids.enquiry = (await db.query(
      `INSERT INTO enquiries(enquiry_number,client_id,title,created_by) VALUES($1,$2,'Standalone product quotation',$3) RETURNING id`,
      [code, ids.client, ids.user],
    )).rows[0].id;
    ids.product = (await db.query(
      `INSERT INTO product_masters(product_code,product_name,product_description,sell_price,currency,status)
       VALUES($1,'Quotation test pump','Marine circulation pump',125.50,'USD','Active') RETURNING id`, [code],
    )).rows[0].id;

    const login = await request.post('/api/v1/auth/login', { data: { email: `quote-${suffix}@example.test`, password } });
    expect(login.status()).toBe(200);
    const token = (await login.json()).token;
    const headers = { Authorization: `Bearer ${token}` };
    const path = `/api/v1/enquiries/${ids.enquiry}`;
    await page.addInitScript(value => localStorage.setItem('edp_token', value), token);
    await page.goto(`/enquiries/${ids.enquiry}`);
    await page.getByRole('button', { name: /^Quote$/ }).click();
    await page.getByRole('button', { name: 'Add PIM product', exact: true }).last().click();
    const picker = page.getByRole('dialog', { name: /PIM/ });
    await picker.getByRole('textbox').first().fill(code);
    await picker.getByRole('button').filter({ hasText: code }).click();
    await expect(picker.getByLabel('Unit price (USD)')).toHaveValue('125.5');
    await picker.getByLabel('Quantity').click();
    await picker.getByLabel('Quantity').fill('2');
    await picker.getByLabel('Unit', { exact: true }).click();
    await expect(picker.getByLabel('Quantity')).toHaveValue('2');
    const addResponse = page.waitForResponse(r => r.url().endsWith('/quote/lines') && r.request().method() === 'POST', { timeout: 60_000 });
    await picker.getByRole('button', { name: 'Add to quote', exact: true }).click();
    expect((await addResponse).status()).toBe(201);
    await picker.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('table')).toContainText('251.00');
    await expect(page.getByRole('table')).toContainText(code);

    const getEnquiry = async () => (await request.get(path, { headers })).json();
    const saved = await getEnquiry();
    expect(saved.project_id).toBeNull();
    expect(saved.design_book_id).toBeNull();
    expect(saved.quote.lines[0].source_snapshot.product_master_id).toBe(ids.product);
    const snapshot = saved.quote.lines[0].source_snapshot;

    // Non-catalogue charges share the quote but do not require a product identity.
    await page.getByRole('button', { name: 'Add custom line', exact: true }).click();
    const custom = page.getByRole('dialog', { name: 'Add custom line', exact: true });
    await custom.getByLabel('Description').fill('Freight to site');
    await custom.getByLabel('Unit selling price (USD)').click();
    await custom.getByLabel('Unit selling price (USD)').fill('250');
    await custom.getByLabel('Unit', { exact: true }).click();
    await custom.getByRole('button', { name: 'Add custom line', exact: true }).click();
    await expect(custom).toBeHidden({ timeout: 30_000 });
    await expect(page.getByRole('table')).toContainText('Freight to site');
    await expect(page.getByRole('table')).toContainText('Manual');
    const combined = (await getEnquiry()).quote;
    expect(combined.lines).toHaveLength(2);
    expect(combined.lines.find((l: any) => l.description === 'Freight to site')).toMatchObject({
      currency: 'USD', source_snapshot: { source_type: 'manual' },
    });
    expect(combined.lines.reduce((sum: number, l: any) => sum + Number(l.quantity) * Number(l.unit_price), 0)).toBe(501);
    await page.screenshot({ path: 'test-results/quote-custom-lines.png', fullPage: true });
    await page.getByRole('button', { name: 'Remove line 2' }).click();
    await page.getByRole('dialog', { name: /Remove/ }).getByRole('button', { name: 'Remove line', exact: true }).click();
    await expect(page.getByText('Freight to site', { exact: true })).toHaveCount(0, { timeout: 30_000 });
    expect((await getEnquiry()).quote.lines).toHaveLength(1);

    await db.query(`UPDATE product_masters SET product_name='Changed catalog name',sell_price=999 WHERE id=$1`, [ids.product]);
    await page.reload();
    await page.getByRole('button', { name: /^Quote/ }).click();
    await expect(page.getByRole('table')).toContainText('125.50');
    expect((await getEnquiry()).quote.lines[0].source_snapshot).toEqual(snapshot);

    await page.getByRole('button', { name: 'Edit line 1' }).click();
    await page.getByRole('table').getByLabel('Quantity').click();
    await page.getByRole('table').getByLabel('Quantity').fill('3');
    await page.getByRole('table').getByLabel('Unit price (USD)').click();
    await page.getByRole('table').getByLabel('Unit price (USD)').fill('150');
    await page.getByRole('table').getByLabel('Unit', { exact: true }).click();
    await page.getByRole('table').getByRole('button', { name: /save/i }).click();
    await expect(page.getByRole('button', { name: 'Edit line 1' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('table')).toContainText('450.00');
    await page.getByRole('button', { name: 'Remove line 1' }).click();
    await page.getByRole('dialog', { name: /Remove/ }).getByRole('button', { name: 'Remove line', exact: true }).click();
    await expect(page.getByText('No quote lines captured')).toBeVisible({ timeout: 30_000 });
    expect((await getEnquiry()).quote.lines).toHaveLength(0);

    // Add once more, issue, and check both UI and server-side immutability.
    const added = await request.post(`${path}/quote/lines`, {
      headers, data: { product_master_id: ids.product, quantity: 1, unit_price: 150 },
    });
    expect(added.status()).toBe(201);
    expect((await request.patch(`${path}/quote`, { headers, data: { status: 'issued' } })).status()).toBe(200);
    await page.reload();
    await page.getByRole('button', { name: /^Quote/ }).click();
    await expect(page.getByRole('button', { name: 'Add PIM product', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add custom line', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit line 1' })).toHaveCount(0);
    expect((await request.post(`${path}/quote/lines`, {
      headers, data: { product_master_id: ids.product, quantity: 1, unit_price: 150 },
    })).status()).toBe(409);
    expect((await request.post(`${path}/quote/manual-lines`, {
      headers, data: { description: 'Installation', quantity: 1, unit_price: 500 },
    })).status()).toBe(409);
  } finally {
    await page.close();
    if (ids.enquiry) {
      await db.query(`DELETE FROM notifications WHERE entity_id=$1`, [ids.enquiry]);
      await db.query(`DELETE FROM enquiries WHERE id=$1`, [ids.enquiry]);
    }
    if (ids.client) await db.query('DELETE FROM clients WHERE id=$1', [ids.client]);
    if (ids.product) await db.query('DELETE FROM product_masters WHERE id=$1', [ids.product]);
    if (ids.user) await db.query('DELETE FROM users WHERE id=$1', [ids.user]);
    await db.end();
  }
});
