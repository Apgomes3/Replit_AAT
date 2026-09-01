// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'lss-lifecycle-test-secret';
const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: any[] }>,
  moduleAccess: 'manage',
  sourceStatus: 'Design',
  sourceProject: 'project-1',
  replacementProject: 'project-1',
  replacementStatus: 'Design',
  supersededBy: null as string | null,
}));

vi.mock('../db', () => {
  const clientQuery = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT * FROM systems WHERE id=$1 FOR UPDATE')) {
      return { rows: [{
        id: 'system-1',
        system_code: 'LSS-OLD',
        system_name: 'Old LSS',
        system_type: 'Life Support',
        project_id: state.sourceProject,
        status: state.sourceStatus,
        superseded_by_system_id: state.supersededBy,
      }] };
    }
    if (sql.includes('SELECT * FROM systems WHERE id = ANY')) {
      return { rows: [
        {
          id: 'system-1',
          system_code: 'LSS-OLD',
          system_name: 'Old LSS',
          system_type: 'Life Support',
          project_id: state.sourceProject,
          status: state.sourceStatus,
          superseded_by_system_id: state.supersededBy,
        },
        {
          id: 'system-2',
          system_code: 'LSS-NEW',
          system_name: 'New LSS',
          system_type: 'Life Support',
          project_id: state.replacementProject,
          status: state.replacementStatus,
          supersedes_system_id: null,
        },
      ] };
    }
    if (sql.includes("SET status='Decommissioned'")) {
      state.sourceStatus = 'Decommissioned';
      return { rows: [{ id: 'system-1', status: state.sourceStatus, lifecycle_reason: params[1] }] };
    }
    if (sql.includes("SET status='Superseded'")) {
      state.sourceStatus = 'Superseded';
      state.supersededBy = String(params[1]);
      return { rows: [{ id: 'system-1', status: state.sourceStatus, superseded_by_system_id: state.supersededBy }] };
    }
    return { rows: [] };
  });
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT rma.access_level')) return { rows: [{ access_level: state.moduleAccess }] };
    return { rows: [] };
  });
  return {
    default: {
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
    },
    query,
  };
});

vi.mock('../db/audit', () => ({ logAudit: vi.fn(async () => undefined) }));

function request(app: Express, path: string, body: any, role = 'engineer') {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No test server address'));
      const token = jwt.sign({ id: 'user-1', email: 'user@example.com', role }, testSecret);
      const payload = JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        method: 'POST',
        path,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, response => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => server.close(error => {
          if (error) return reject(error);
          resolve({ status: response.statusCode || 0, body: data ? JSON.parse(data) : {} });
        }));
      });
      req.on('error', reject);
      req.end(payload);
    });
  });
}

describe('governed LSS lifecycle', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: projectRoutes } = await import('./projects');
    app = express();
    app.use(express.json());
    app.use('/api/v1', projectRoutes);
    app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: { code: 'SERVER_ERROR' } });
    });
  });

  beforeEach(() => {
    state.calls.length = 0;
    state.moduleAccess = 'manage';
    state.sourceStatus = 'Design';
    state.sourceProject = 'project-1';
    state.replacementProject = 'project-1';
    state.replacementStatus = 'Design';
    state.supersededBy = null;
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('requires an accountable archive reason', async () => {
    const response = await request(app, '/api/v1/systems/system-1/archive', { reason: '   ' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('REASON_REQUIRED');
    expect(state.calls.some(call => call.sql === 'BEGIN')).toBe(false);
  });

  it('archives atomically and writes transition evidence', async () => {
    const response = await request(app, '/api/v1/systems/system-1/archive', { reason: 'Plant retired' });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('Decommissioned');
    const audit = state.calls.find(call => call.sql.includes("VALUES ('system',$1,'ARCHIVE'"));
    expect(audit?.params[2]).toMatchObject({
      reason: 'Plant retired',
      previous_status: 'Design',
      new_status: 'Decommissioned',
    });
    expect(state.calls.some(call => call.sql === 'COMMIT')).toBe(true);
  });

  it('preserves bidirectional supersession and is safe to repeat', async () => {
    const first = await request(app, '/api/v1/systems/system-1/supersede', {
      reason: 'Capacity replacement',
      replacement_system_id: 'system-2',
    });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'Superseded', superseded_by_system_id: 'system-2' });
    expect(state.calls.some(call =>
      call.sql.includes('UPDATE systems SET supersedes_system_id=$1')
      && call.params[0] === 'system-1'
      && call.params[1] === 'system-2')).toBe(true);

    state.calls.length = 0;
    const repeated = await request(app, '/api/v1/systems/system-1/supersede', {
      reason: 'Capacity replacement',
      replacement_system_id: 'system-2',
    });
    expect(repeated.status).toBe(200);
    expect(state.calls.some(call => call.sql.includes("SET status='Superseded'"))).toBe(false);
    expect(state.calls.some(call => call.sql.includes("VALUES ('system',$1,'SUPERSEDE'"))).toBe(false);
  });

  it('rejects a replacement from another project and read-only users', async () => {
    state.replacementProject = 'project-2';
    const mismatch = await request(app, '/api/v1/systems/system-1/supersede', {
      reason: 'Replacement',
      replacement_system_id: 'system-2',
    });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('REPLACEMENT_PROJECT_MISMATCH');

    const forbidden = await request(app, '/api/v1/systems/system-1/archive', {
      reason: 'Replacement',
    }, 'viewer');
    expect(forbidden.status).toBe(403);
  });
});