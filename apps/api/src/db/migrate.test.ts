import { describe, expect, it } from 'vitest';
import { backfillClientContacts, backfillLegacyBusinessDevelopment, normalizeLegacyEnquiryDates } from './migrate';

describe('legacy enquiry date normalization', () => {
  it('preserves a past expected decision date without violating date ordering', () => {
    const normalized = normalizeLegacyEnquiryDates(
      '2025-06-15T12:00:00.000Z',
      '2024-02-29',
    );

    expect(normalized).toEqual({
      receivedDate: '2024-02-29',
      dueDate: '2024-02-29',
      originalDueDate: '2024-02-29',
    });
  });

  it('falls back to the legacy created date when no decision date exists', () => {
    expect(normalizeLegacyEnquiryDates('2025-06-15', null).receivedDate).toBe('2025-06-15');
  });

  it('imports a past decision date once and skips the rerun marker', async () => {
    let marked = false;
    let enquiryInserts = 0;
    const client = {
      query: async (sql: string, _params?: any[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
        if (sql.startsWith('SELECT 1 FROM platform_migration_markers')) return { rows: marked ? [{ '?column?': 1 }] : [] };
        if (sql.startsWith('SELECT * FROM business_books')) return {
          rows: [{
            id: 'book-1', client_name: 'Legacy Client', book_number: 'BB-1', title: 'Legacy request',
            created_at: '2025-06-15', client_details: {}, project_location: {},
          }],
        };
        if (sql.startsWith('SELECT md5')) return { rows: [{ hash: 'a'.repeat(32) }] };
        if (sql.startsWith('INSERT INTO clients')) return { rows: [] };
        if (sql.startsWith('SELECT id FROM clients')) return { rows: [{ id: 'client-1' }] };
        if (sql.startsWith('SELECT * FROM business_opportunities')) return { rows: [] };
        if (sql.startsWith('INSERT INTO enquiries')) {
          enquiryInserts += 1;
          return { rows: [{ id: 'enquiry-1' }] };
        }
        if (sql.startsWith('INSERT INTO enquiry_activities')) return { rows: [] };
        if (sql.startsWith('INSERT INTO platform_migration_markers')) {
          marked = true;
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    // Include an opportunity in the first pass by changing the legacy query
    // response only for this test's past-date assertion.
    const originalQuery = client.query;
    client.query = async (sql: string, params?: any[]) => {
      if (sql.startsWith('SELECT * FROM business_opportunities')) return {
        rows: [{
          id: 'opportunity-1', opportunity_number: 'OP-1', title: 'Past opportunity',
          expected_decision_date: '2024-02-29', created_at: '2025-06-15',
          status: 'draft', created_by: null,
        }],
      };
      return originalQuery(sql, params);
    };

    await backfillLegacyBusinessDevelopment(client);
    await backfillLegacyBusinessDevelopment(client);
    expect(enquiryInserts).toBe(1);
    // The helper used by the SQL path makes this past due date valid.
    expect(normalizeLegacyEnquiryDates('2025-06-15', '2024-02-29').receivedDate).toBe('2024-02-29');
  });
});

describe('client contact backfill', () => {
  it('uses legacy email fallback, preserves partial records, and claims under advisory lock', async () => {
    let marker = false;
    let lockCalls = 0;
    const inserts: any[][] = []; const insertedClients = new Set<string>();
    const client = {
      query: async (sql: string, params?: any[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.startsWith('SELECT pg_advisory_xact_lock')) { lockCalls++; return { rows: [] }; }
        if (sql.startsWith('SELECT 1 FROM platform_migration_markers')) return { rows: marker ? [{}] : [] };
        if (sql.startsWith('SELECT id,contact_name')) return { rows: [
          { id: 'complete', contact_name: 'Alex', contact_email: null, email: 'alex@example.com', contact_phone: null, phone: '1' },
          { id: 'partial', contact_name: 'Sam', contact_email: null, email: null, contact_phone: '2', phone: null },
        ] };
        if (sql.startsWith('INSERT INTO client_contacts')) {
          if (!insertedClients.has(String(params?.[0]))) { insertedClients.add(String(params?.[0])); inserts.push(params || []); }
          return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO platform_migration_markers')) { marker = true; return { rows: [] }; }
        throw new Error(`Unexpected query: ${sql}`);
      },
    };
    await backfillClientContacts(client);
    expect(lockCalls).toBe(1);
    expect(inserts[0][1]).toBe('Alex');
    expect(inserts[0][2]).toBe('alex@example.com');
    expect(marker).toBe(false);
    await backfillClientContacts(client);
    expect(lockCalls).toBe(2);
    expect(inserts).toHaveLength(1);
  });
});