import { Router } from 'express';
import { AuthRequest, requireModuleAccess, requireModuleManage } from '../middleware/auth';
import { query, withTransaction } from '../db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (status: number, code: string, message: string) =>
  Object.assign(new Error(message), { status, code });
const productColumns = 'id, product_code, product_name, product_description, product_category, manufacturer, model, sell_price, currency, status, updated_at';
const unavailable = (product: any) =>
  ['obsolete', 'inactive', 'archived'].includes(String(product.status || '').toLowerCase());

function number(value: any, label: string, positive = false) {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && !value.trim()) ||
      !Number.isFinite(Number(value)) || Number(value) < 0 || (positive && Number(value) === 0) ||
      Number(value) > 1e12) {
    throw fail(400, 'VALIDATION', `${label} must be a finite ${positive ? 'positive' : 'non-negative'} number.`);
  }
  return Number(value);
}

function text(value: any, fallback: string, label: string, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw fail(400, 'VALIDATION', `${label} is required and must be at most ${max} characters.`);
  }
  return value.trim();
}

export function enquiryQuoteLines(services: {
  ensureQuote: (db: any, id: any, user: string, body: any) => Promise<any>;
  recordActivity: (db: any, id: any, user: string, action: string, details: any) => Promise<any>;
}) {
  const router = Router({ mergeParams: true });
  router.use((req, res, next) => {
    if (!UUID.test(String(req.params.id))) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid enquiry id.' } });
    next();
  });
  const endpoint = (action: (req: AuthRequest, res: any) => Promise<any>) =>
    async (req: AuthRequest, res: any, next: any) => {
      try { await action(req, res); }
      catch (error: any) {
        if (error.status) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
        next(error);
      }
    };

  router.get('/products', requireModuleAccess('pim'), endpoint(async (req, res) => {
    const enquiry = await query('SELECT id FROM enquiries WHERE id=$1', [req.params.id]);
    if (!enquiry.rows[0]) throw fail(404, 'NOT_FOUND', 'Enquiry not found.');
    const quote = await query('SELECT currency FROM enquiry_quotes WHERE enquiry_id=$1', [req.params.id]);
    const search = String(req.query.search || '').trim().slice(0, 120);
    const products = await query(
      `SELECT ${productColumns} FROM product_masters
       WHERE LOWER(COALESCE(status,'active')) NOT IN ('obsolete','inactive','archived')
         AND ($1::text='' OR product_code ILIKE $2 OR product_name ILIKE $2
              OR product_description ILIKE $2 OR manufacturer ILIKE $2 OR model ILIKE $2
              OR product_category ILIKE $2)
       ORDER BY product_code, id LIMIT 40`, [search, `%${search}%`],
    );
    res.json({ items: products.rows, quote_currency: quote.rows[0]?.currency || 'USD' });
  }));

  async function draft(db: any, req: AuthRequest, create: boolean) {
    const id = String(req.params.id);
    if (create) await services.ensureQuote(db, id, req.user!.id, req.body || {});
    else if (!(await db.query('SELECT id FROM enquiries WHERE id=$1 FOR UPDATE', [id])).rows[0]) {
      throw fail(404, 'NOT_FOUND', 'Enquiry not found.');
    }
    const current = (await db.query('SELECT * FROM enquiry_quotes WHERE enquiry_id=$1 FOR UPDATE', [id])).rows[0];
    if (!current) throw fail(404, 'NOT_FOUND', 'Quote not found.');
    if (current.status !== 'draft') throw fail(409, 'QUOTE_LOCKED', 'Only draft quotes can change products or commercial lines.');
    if (!create && current.updated_at) {
      const expected = req.body?.expected_quote_version;
      if (!expected || !Number.isFinite(Date.parse(expected)) ||
          new Date(expected).getTime() !== new Date(current.updated_at).getTime()) {
        throw fail(409, 'VERSION_CONFLICT', 'This quote has changed. Reload it before editing this line.');
      }
    }
    return current;
  }
  async function changed(db: any, req: AuthRequest, quote: any, action: string, line: any) {
    await db.query('UPDATE enquiry_quotes SET updated_by=$1,updated_at=clock_timestamp() WHERE id=$2', [req.user!.id, quote.id]);
    await services.recordActivity(db, req.params.id, req.user!.id, action,
      { quote_id: quote.id, line_id: line.id, product_master_id: line.source_snapshot?.product_master_id || null });
  }

  router.post('/lines', requireModuleManage('business_development'), requireModuleAccess('pim'), endpoint(async (req, res) => {
    const body = req.body || {};
    if (!UUID.test(String(body.product_master_id))) throw fail(400, 'VALIDATION', 'Select a PIM product.');
    if (body.idempotency_key !== undefined && !UUID.test(String(body.idempotency_key))) throw fail(400, 'VALIDATION', 'Invalid add-product request key.');
    if (body.currency !== undefined && !/^[A-Z]{3}$/.test(body.currency)) throw fail(400, 'VALIDATION', 'Currency must be an uppercase ISO code.');
    const quantity = number(body.quantity, 'Quantity', true);
    const result = await withTransaction(async db => {
      const q = await draft(db, req, true);
      if (body.idempotency_key) {
        const previous = (await db.query(
          `SELECT * FROM enquiry_quote_lines WHERE quote_id=$1
           AND source_snapshot->>'add_request_key'=$2 AND source_snapshot->>'added_by'=$3`,
          [q.id, body.idempotency_key, req.user!.id],
        )).rows[0];
        if (previous) return previous;
      }
      if (body.currency && body.currency !== q.currency) throw fail(409, 'CURRENCY_MISMATCH', 'Quote currency changed. Reload the quote before adding products.');
      const product = (await db.query(`SELECT ${productColumns} FROM product_masters WHERE id=$1 FOR SHARE`, [body.product_master_id])).rows[0];
      if (!product || unavailable(product)) throw fail(400, 'INVALID_PRODUCT', 'This PIM product is unavailable. Choose an active product.');
      const sourceCurrency = product.currency || 'USD';
      const sourcePrice = sourceCurrency === q.currency ? product.sell_price : null;
      const unitPrice = number(body.unit_price === undefined ? sourcePrice : body.unit_price, `Unit selling price in ${q.currency}`);
      const description = text(body.description, product.product_description || product.product_name, 'Description', 10000);
      const unit = text(body.unit, 'EA', 'Unit', 50);
      const snapshot = {
        source_type: 'pim_product', product_master_id: product.id,
        product_code: product.product_code, product_name: product.product_name,
        product_description: product.product_description, product_category: product.product_category,
        manufacturer: product.manufacturer, model: product.model,
        sell_price: product.sell_price, currency: sourceCurrency,
        source_updated_at: product.updated_at, captured_at: new Date().toISOString(),
        add_request_key: body.idempotency_key || null, added_by: req.user!.id,
      };
      const saved = (await db.query(
        `INSERT INTO enquiry_quote_lines(quote_id,source_snapshot,description,quantity,unit,unit_price,currency,sort_order)
         VALUES($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM enquiry_quote_lines WHERE quote_id=$1))
         RETURNING *`,
        [q.id, snapshot, description, quantity, unit, Number(unitPrice.toFixed(2)), q.currency],
      )).rows[0];
      await changed(db, req, q, 'quote_line_added', saved);
      return saved;
    });
    res.status(201).json(result);
  }));

  router.patch('/lines/:lineId', requireModuleManage('business_development'), endpoint(async (req, res) => {
    if (!UUID.test(String(req.params.lineId))) throw fail(400, 'VALIDATION', 'Invalid quote line id.');
    const body = req.body || {};
    const result = await withTransaction(async db => {
      const q = await draft(db, req, false);
      const current = (await db.query('SELECT * FROM enquiry_quote_lines WHERE id=$1 AND quote_id=$2', [req.params.lineId, q.id])).rows[0];
      if (!current) throw fail(404, 'NOT_FOUND', 'Quote line not found.');
      const quantity = number(body.quantity ?? current.quantity, 'Quantity', true);
      const price = number(body.unit_price === undefined ? current.unit_price : body.unit_price, `Unit selling price in ${q.currency}`);
      if (current.currency !== q.currency) throw fail(409, 'CURRENCY_MISMATCH', 'This line has a different currency from the quote. Resolve its source currency before editing.');
      const saved = (await db.query(
        `UPDATE enquiry_quote_lines SET description=$1,quantity=$2,unit=$3,unit_price=$4 WHERE id=$5 AND quote_id=$6 RETURNING *`,
        [text(body.description, current.description, 'Description', 10000), quantity,
          text(body.unit, current.unit, 'Unit', 50), Number(price.toFixed(2)), current.id, q.id],
      )).rows[0];
      await changed(db, req, q, 'quote_line_updated', saved);
      return saved;
    });
    res.json(result);
  }));

  router.delete('/lines/:lineId', requireModuleManage('business_development'), endpoint(async (req, res) => {
    if (!UUID.test(String(req.params.lineId))) throw fail(400, 'VALIDATION', 'Invalid quote line id.');
    await withTransaction(async db => {
      const q = await draft(db, req, false);
      const removed = (await db.query('DELETE FROM enquiry_quote_lines WHERE id=$1 AND quote_id=$2 RETURNING *', [req.params.lineId, q.id])).rows[0];
      if (!removed) throw fail(404, 'NOT_FOUND', 'Quote line not found.');
      await changed(db, req, q, 'quote_line_removed', removed);
    });
    res.status(204).end();
  }));
  return router;
}
