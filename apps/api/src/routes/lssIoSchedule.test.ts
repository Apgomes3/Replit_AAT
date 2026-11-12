// @vitest-environment node
import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { projectLssIoSchedule, renderLssIoSchedulePdf } from '../lib/lssIoSchedule';

const secret = 'lss-io-schedule-test';
const execFileAsync = promisify(execFile);
// PDF text checks need poppler's `pdftotext` (apt: poppler-utils; Windows: install poppler and add to PATH).
// Without it those checks are reported as skipped instead of failing.
const pdftotextAvailable = !spawnSync('pdftotext', ['-v']).error;
const frozenTag = 'LSS-01-PS-HISTORIC-01';
const frozenInstrument = 'Retired pressure switch';
const frozenProduct = 'P-OLD — Frozen assigned product';
const frozenLogic = 'Frozen trip logic retained after issue';
const frozenBook = {
  id: 'book-1', book_code: 'BOOK-01', book_title: 'Frozen controls',
  project_id: 'project-1', status: 'Released',
  release_snapshot: {
    systems: [{ id: 'system-1', system_code: 'LSS-01', system_name: 'Frozen LSS', system_type: 'Life Support System' }],
    lss_control_configurations: [{ system_id: 'system-1', panel_type: 'PLC' }],
    lss_instrument_instances: [{
      id: 'frozen-instance', system_id: 'system-1', tag: frozenTag, sequence_number: 1,
      control_logic: frozenLogic,
      definition_snapshot: { name: frozenInstrument, tag_code: 'PS', sort_order: 1, signal_type: 'digital', signal_direction: 'input' },
      product_snapshot: { product_code: 'P-OLD', product_name: 'Frozen assigned product' },
    }],
  },
};
const query = vi.fn(async (statement: string | { text: string }) => {
  const sql = typeof statement === 'string' ? statement : statement.text;
  if (sql.includes('role_module_access')) return { rows: [] };
  if (sql.includes('FROM design_books')) return { rows: [frozenBook] };
  throw new Error(`Unexpected mutable query: ${sql}`);
});

// The control route queries through pool.query({ text, values, query_timeout }).
vi.mock('../db', () => ({ default: { connect: vi.fn(), query }, query }));
vi.mock('./designBooks', () => ({ loadReleaseContext: vi.fn() }));

function get(app: express.Express, path = '/api/v1/systems/system-1/control/io-schedule.pdf?design_book_id=book-1') {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const token = jwt.sign({ id: 'user-1', role: 'engineer', email: 'io@example.test' }, secret);
      const request = http.request({
        host: '127.0.0.1', port: (server.address() as any).port,
        path,
        headers: { Authorization: `Bearer ${token}` },
      }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => server.close(error => error ? reject(error) : resolve({
          status: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks),
        })));
      });
      request.on('error', reject);
      request.end();
    });
  });
}

async function extractPdfText(pdf: Buffer) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lss-io-schedule-'));
  const pdfPath = path.join(directory, 'schedule.pdf');
  try {
    await writeFile(pdfPath, pdf);
    const { stdout } = await execFileAsync('pdftotext', [pdfPath, '-']);
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('LSS I/O schedule', () => {
  it('projects every saved instance in deterministic schedule order', () => {
    const rows = projectLssIoSchedule(
      [{ id: 'a', system_code: 'LSS-01' }, { id: 'b', system_code: 'LSS-02' }],
      [{
        system_id: 'b', control: { panel_type: 'GPO' },
        instruments: [{ tag: 'LSS-02-Z-01', sequence_number: 1, control_logic: 'Z', definition_snapshot: { name: 'Zeta', tag_code: 'Z', sort_order: 2 } }],
      }, {
        system_id: 'a', control: { panel_type: 'PLC' },
        instruments: [
          { tag: 'LSS-01-B-02', sequence_number: 2, control_logic: 'Second', definition_snapshot: { name: 'Beta', tag_code: 'B', sort_order: 1, signal_direction: 'output' } },
          { tag: 'LSS-01-B-01', sequence_number: 1, control_logic: 'First', product_snapshot: { product_code: 'P-1', product_name: 'Product 1' }, definition_snapshot: { name: 'Beta', tag_code: 'B', sort_order: 9, signal_type: 'digital', signal_direction: 'input' } },
        ],
      }],
    );
    expect(rows.map(row => row.tag)).toEqual(['LSS-01-B-01', 'LSS-01-B-02', 'LSS-02-Z-01']);
    expect(rows.map(row => row.direction)).toEqual(['input', 'output', null]);
    expect(rows[0]).toMatchObject({
      panel: 'PLC', instrument: 'Beta', signal_type: 'digital', direction: 'input',
      assigned_product: 'P-1 — Product 1', control_logic: 'First',
    });
  });

  it('renders grouped Unicode schedule evidence to a PDF', async () => {
    const rows = projectLssIoSchedule([{ id: 'a', system_code: 'LSS-01' }], [{
      system_id: 'a', control: { panel_type: 'PLC' }, instruments: [{
        id: 'unicode', tag: 'LSS-01-PT-01', control_logic: 'Arrêt à pressão alta',
        definition_snapshot: { name: 'Датчик pressão', signal_type: 'analog', signal_direction: 'input' },
        product_snapshot: { product_code: 'P-1', product_name: 'Válvula Δ' },
      }],
    }]);
    const pdf = await renderLssIoSchedulePdf(
      { book_code: 'DB-1', book_title: 'Aquário Δ', status: 'For Review' },
      rows,
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('exports frozen evidence as a downloadable PDF without mutable product queries', async () => {
    process.env.JWT_SECRET = secret;
    const { default: routes } = await import('./lssControls');
    const app = express();
    app.use('/api/v1', routes);
    const response = await get(app);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('attachment; filename="BOOK-01-lss-io-schedule.pdf"');
    expect(response.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(response.body.length).toBeGreaterThan(1000);
    expect(query.mock.calls.map(([sql]) => sql)).not.toContain(expect.stringContaining('product_masters'));
    expect(query.mock.calls.map(([sql]) => sql)).not.toContain(expect.stringContaining('FROM systems'));
  });

  it.skipIf(!pdftotextAvailable)('prints the frozen tag, instrument, product and logic in the exported PDF', async () => {
    process.env.JWT_SECRET = secret;
    const { default: routes } = await import('./lssControls');
    const app = express();
    app.use('/api/v1', routes);
    const response = await get(app);
    const pdfText = await extractPdfText(response.body);
    expect(pdfText).toContain(frozenTag);
    expect(pdfText).toContain(frozenInstrument);
    expect(pdfText).toContain(frozenProduct);
    expect(pdfText).toContain(frozenLogic);
  });

  it('serves frozen control evidence without resolving the live system', async () => {
    process.env.JWT_SECRET = secret;
    const { default: routes } = await import('./lssControls');
    const app = express();
    app.use('/api/v1', routes);
    const response = await get(app, '/api/v1/systems/system-1/control?design_book_id=book-1');
    const payload = JSON.parse(response.body.toString());

    expect(response.status).toBe(200);
    expect(payload.frozen).toBe(true);
    expect(payload.instruments[0]).toMatchObject({
      tag: frozenTag,
      control_logic: frozenLogic,
      product_snapshot: { product_name: 'Frozen assigned product' },
    });
    expect(query.mock.calls.map(([sql]) => sql)).not.toContain(expect.stringContaining('FROM systems'));
    expect(query.mock.calls.map(([sql]) => sql)).not.toContain(expect.stringContaining('product_masters'));
  });

  it('fails closed when an issued book has no frozen evidence package', async () => {
    process.env.JWT_SECRET = secret;
    const snapshot = frozenBook.release_snapshot;
    (frozenBook as any).release_snapshot = null;
    try {
      const { default: routes } = await import('./lssControls');
      const app = express();
      app.use('/api/v1', routes);
      const [pdfResponse, controlResponse] = await Promise.all([
        get(app),
        get(app, '/api/v1/systems/system-1/control?design_book_id=book-1'),
      ]);
      expect(pdfResponse.status).toBe(409);
      expect(pdfResponse.body.toString()).toContain('DESIGN_BOOK_SNAPSHOT_MISSING');
      expect(controlResponse.status).toBe(409);
      expect(controlResponse.body.toString()).toContain('DESIGN_BOOK_SNAPSHOT_MISSING');
    } finally {
      (frozenBook as any).release_snapshot = snapshot;
    }
  });
});