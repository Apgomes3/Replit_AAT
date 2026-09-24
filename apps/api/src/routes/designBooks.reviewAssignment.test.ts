// @vitest-environment node

import http from 'node:http';
import express, { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testSecret = 'design-books-review-assignment-test-secret';
const bookId = '00000000-0000-4000-8000-000000000241';
const engineerId = '00000000-0000-4000-8000-000000000242';
const reviewerId = '00000000-0000-4000-8000-000000000243';

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: any[] }>,
  reviewerEligible: true,
  assignedReviewerId: null as string | null,
}));

vi.mock('../db', () => {
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.includes('SELECT rma.access_level')) return { rows: [{ access_level: 'manage' }] };
    if (sql.includes('SELECT u.id, u.first_name, u.last_name, u.email')) {
      return { rows: [{ id: reviewerId, first_name: 'Review', last_name: 'Manager', email: 'manager@example.com' }] };
    }
    if (sql.includes('SELECT db.*, p.project_scopes')) {
      return {
        rows: [{
          id: bookId,
          book_code: 'DB-REVIEW',
          book_title: 'Reviewer assignment regression',
          status: 'Draft',
          project_id: 'project-1',
          created_by: engineerId,
          review_reviewer_id: state.assignedReviewerId,
        }],
      };
    }
    if (sql.includes('SELECT u.id') && sql.includes('u.is_active=true')) {
      return { rows: state.reviewerEligible ? [{ id: reviewerId }] : [] };
    }
    if (sql.includes("SET status='For Review'")) {
      return { rows: [{ id: bookId, status: 'For Review', review_reviewer_id: params[1] }] };
    }
    if (sql.includes('INSERT INTO lifecycle_transitions')) return { rows: [{ id: 'transition-review-1' }] };
    if (sql.includes('INSERT INTO projects') || sql.includes('SELECT created_by FROM projects')) {
      return { rows: [{ created_by: engineerId }] };
    }
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  return {
    query,
    default: {
      query,
      connect: vi.fn(async () => client),
    },
  };
});

function request(app: Express, method: string, path: string, body?: any) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine test server port'));
        return;
      }
      const token = jwt.sign({ id: engineerId, email: 'engineer@example.com', role: 'engineer' }, testSecret);
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      }, res => {
        let response = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { response += chunk; });
        res.on('end', () => server.close(error => {
          if (error) return reject(error);
          resolve({ status: res.statusCode ?? 0, body: response ? JSON.parse(response) : null });
        }));
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe('Design Book submit-review reviewer assignment', () => {
  let app: Express;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    const { default: designBookRoutes } = await import('./designBooks');
    app = express();
    app.use(express.json());
    app.use('/api/v1', designBookRoutes);
  });

  beforeEach(() => {
    state.calls.length = 0;
    state.reviewerEligible = true;
    state.assignedReviewerId = null;
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it('lists active managers with manage-level Design Book access', async () => {
    const response = await request(app, 'GET', '/api/v1/design-books/review-reviewers');
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([{
      id: reviewerId,
      name: 'Review Manager',
      email: 'manager@example.com',
    }]);
    const listQuery = state.calls.find(call => call.sql.includes('SELECT u.id, u.first_name'));
    expect(listQuery?.sql).toContain("access.access_level='manage'");
    expect(listQuery?.sql).toContain('u.id<>$2');
  });

  it('does not submit when the creator/project owner is the only stakeholder and no manager is assigned', async () => {
    const response = await request(app, 'POST', `/api/v1/design-books/${bookId}/submit-review`, {});
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('REVIEWER_REQUIRED');
    expect(state.calls.some(call => call.sql.includes("SET status='For Review'"))).toBe(false);
    expect(state.calls.some(call => call.sql.includes('INSERT INTO notifications'))).toBe(false);
  });

  it('does not allow the submitting creator to be their own reviewer', async () => {
    const response = await request(app, 'POST', `/api/v1/design-books/${bookId}/submit-review`, {
      review_reviewer_id: engineerId,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('REVIEWER_INELIGIBLE');
    expect(state.calls.some(call => call.sql.includes("SET status='For Review'"))).toBe(false);
    expect(state.calls.some(call => call.sql.includes('INSERT INTO notifications'))).toBe(false);
  });

  it('persists the authorized reviewer and sends only that reviewer action-required work', async () => {
    const response = await request(app, 'POST', `/api/v1/design-books/${bookId}/submit-review`, {
      review_reviewer_id: reviewerId,
      comment: 'Please review the submitted basis.',
    });
    expect(response.status).toBe(200);

    const update = state.calls.find(call => call.sql.includes("SET status='For Review'"));
    expect(update?.sql).toContain('review_reviewer_id=$2');
    expect(update?.params[1]).toBe(reviewerId);

    const notification = state.calls.find(call => call.sql.includes('INSERT INTO notifications'));
    expect(notification?.params[0]).toBe(reviewerId);
    expect(notification?.sql).toContain('true');
    expect(notification?.sql).toContain('ON CONFLICT');
    expect(state.calls.some(call => call.sql.includes('INSERT INTO audit_logs'))).toBe(true);
  });

  it('reuses a previously assigned reviewer only while that manager remains eligible', async () => {
    state.assignedReviewerId = reviewerId;
    const response = await request(app, 'POST', `/api/v1/design-books/${bookId}/submit-review`, {});
    expect(response.status).toBe(200);
    const update = state.calls.find(call => call.sql.includes("SET status='For Review'"));
    expect(update?.params[1]).toBe(reviewerId);
    const notification = state.calls.find(call => call.sql.includes('INSERT INTO notifications'));
    expect(notification?.params[0]).toBe(reviewerId);
  });

  it('rejects a selected manager who is no longer eligible', async () => {
    state.reviewerEligible = false;
    const response = await request(app, 'POST', `/api/v1/design-books/${bookId}/submit-review`, {
      review_reviewer_id: reviewerId,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('REVIEWER_INELIGIBLE');
    expect(state.calls.some(call => call.sql.includes("SET status='For Review'"))).toBe(false);
  });
});