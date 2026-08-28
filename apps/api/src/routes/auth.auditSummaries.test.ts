// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'auth-audit-summary-test-secret';
const actorId = 'user-1';

const state = vi.hoisted(() => ({
  auditRows: [] as Array<{
    entityType: string;
    entityId: string;
    action: string;
    details: Record<string, unknown> | null;
  }>,
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(async () => true),
    hash: vi.fn(async () => 'new-password-hash'),
  },
}));

vi.mock('../db', () => {
  const query = vi.fn(async (text: string, params: any[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();

    if (sql.startsWith('select password_hash, email from users')) {
      return { rows: [{ password_hash: 'old-password-hash', email: 'user@example.com' }] };
    }
    if (sql.startsWith('select prt.*, u.id as uid')) {
      return { rows: [{ id: 'reset-token-1', uid: actorId, email: 'user@example.com' }] };
    }
    if (sql.startsWith('insert into audit_logs')) {
      state.auditRows.push({
        entityType: String(params[0]),
        entityId: String(params[1]),
        action: String(params[2]),
        details: (params[4] as Record<string, unknown> | null) ?? null,
      });
    }

    return { rows: [] };
  });

  return { query, default: { query } };
});

function request(
  app: Express,
  method: string,
  path: string,
  token: string | undefined,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine test server port'));
        return;
      }

      const payload = JSON.stringify(body);
      const headers: Record<string, string | number> = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path,
        method,
        headers,
      }, res => {
        let response = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { response += chunk; });
        res.on('end', () => {
          server.close(error => {
            if (error) {
              reject(error);
              return;
            }
            try {
              resolve({ status: res.statusCode ?? 0, body: response ? JSON.parse(response) : {} });
            } catch (error) {
              reject(error);
            }
          });
        });
      });
      req.on('error', error => {
        server.close();
        reject(error);
      });
      req.write(payload);
      req.end();
    });
  });
}

describe('persisted audit summaries for password reset mutations', () => {
  let app: Express;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: authRoutes } = await import('./auth');
    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', authRoutes);
    token = jwt.sign({ id: actorId, email: 'user@example.com', role: 'admin' }, testSecret);
  });

  beforeEach(() => {
    state.auditRows.length = 0;
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('persists the self-service password reset summary', async () => {
    const response = await request(app, 'PATCH', '/api/v1/auth/change-password', token, {
      currentPassword: 'old-password',
      newPassword: 'new-password',
    });

    expect(response.status).toBe(204);
    expect(state.auditRows).toContainEqual(expect.objectContaining({
      entityType: 'user',
      entityId: actorId,
      action: 'RESET_PASSWORD',
      details: expect.objectContaining({
        summary: 'User password reset',
        self_service: true,
      }),
    }));
  });

  it('persists the reset-link password reset summary', async () => {
    const response = await request(app, 'POST', '/api/v1/auth/reset-password', undefined, {
      token: 'valid-reset-token',
      password: 'new-password',
    });

    expect(response.status).toBe(200);
    expect(state.auditRows).toContainEqual(expect.objectContaining({
      entityType: 'user',
      entityId: actorId,
      action: 'RESET_PASSWORD',
      details: expect.objectContaining({
        summary: 'User password reset through reset link',
        via_reset_link: true,
      }),
    }));
  });
});