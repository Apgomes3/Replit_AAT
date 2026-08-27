"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const designBooks_1 = require("./designBooks");
const db_1 = __importDefault(require("../db"));
const baseContext = () => ({
    id: 'book-1',
    book_code: 'DB-001',
    book_title: 'Aquarium Design',
    project_id: 'project-1',
    project_code: 'P-001',
    project_name: 'Ocean Centre',
    description: 'Design basis',
    revision: 'A',
    status: 'Draft',
    notes: 'Current notes',
    exhibits: [{ id: 'exhibit-1', project_id: 'project-1', exhibit_code: 'EX-1', exhibit_name: 'Reef' }],
    tanks: [{ id: 'tank-1', project_id: 'project-1', tank_code: 'TK-1', exhibit_id: 'exhibit-1', system_id: 'system-1' }],
    systems: [{
            id: 'system-1',
            project_id: 'project-1',
            system_code: 'LSS-1',
            system_name: 'Primary LSS',
            loop1_flow_source: 'Calculated',
            loop1_bio_degas_m3h: '12.5',
        }],
    system_links: [{
            id: 'link-1',
            system_id: 'system-1',
            exhibit_id: 'exhibit-1',
            link_type: 'Primary',
            flow_allocation_m3h: '12.5',
            allocation_source: 'manual',
        }],
    species: [{ id: 'species-1', exhibit_id: 'exhibit-1', species_name: 'Clownfish', sort_order: 1 }],
    hydraulics: [{
            id: 'hydraulic-1',
            exhibit_id: 'exhibit-1',
            target_turnover_rate: '4.5',
            weir_formula_method: 'francis_184',
            weir_downstream_head_mm: '22',
            calculation_version: 'aquarium-v1',
            calculation_inputs: { turnover_unit: 'cycles_per_hour' },
            override_reason: 'Approved engineering deviation',
        }],
    substrate: [{
            id: 'substrate-1',
            exhibit_id: 'exhibit-1',
            substrate_type: 'Sand',
            substrate_height_mm: '80',
            substrate_volume_m3: '1.2',
            theming_type: 'Artificial rock',
            theming_height_mm: '500',
            theming_volume_m3: '2.4',
            theming_volume_pct: '8.5',
        }],
    review_handovers: [],
});
(0, vitest_1.describe)('Design Book version snapshots', () => {
    (0, vitest_1.it)('captures every supported hydraulic, theming, and exhibit-system link field with a valid checksum', () => {
        const snapshot = designBooks_1.versionSnapshotTestUtils.makeVersionSnapshot(baseContext(), '2026-08-27T10:00:00.000Z');
        (0, vitest_1.expect)(snapshot.schema_version).toBe(2);
        (0, vitest_1.expect)(designBooks_1.versionSnapshotTestUtils.snapshotIntegrityStatus(snapshot)).toBe('verified');
        (0, vitest_1.expect)(snapshot.frozen.hydraulics[0]).toMatchObject({
            weir_formula_method: 'francis_184',
            weir_downstream_head_mm: '22',
            calculation_version: 'aquarium-v1',
            calculation_inputs: { turnover_unit: 'cycles_per_hour' },
            override_reason: 'Approved engineering deviation',
        });
        (0, vitest_1.expect)(snapshot.frozen.substrate[0]).toMatchObject({
            substrate_height_mm: '80',
            theming_height_mm: '500',
            theming_volume_pct: '8.5',
        });
        (0, vitest_1.expect)(snapshot.live_references.system_links[0]).toMatchObject({
            system_id: 'system-1',
            exhibit_id: 'exhibit-1',
            flow_allocation_m3h: '12.5',
            allocation_source: 'manual',
        });
    });
    (0, vitest_1.it)('detects tampering and reports changed, added, removed, and unresolved project references', () => {
        const snapshot = designBooks_1.versionSnapshotTestUtils.makeVersionSnapshot(baseContext());
        (0, vitest_1.expect)(designBooks_1.versionSnapshotTestUtils.snapshotIntegrityStatus(snapshot, null, true)).toBe('invalid');
        (0, vitest_1.expect)(designBooks_1.versionSnapshotTestUtils.snapshotIntegrityStatus(snapshot, 'wrong-database-checksum')).toBe('invalid');
        snapshot.frozen.design_book.book_title = 'Tampered';
        (0, vitest_1.expect)(designBooks_1.versionSnapshotTestUtils.snapshotIntegrityStatus(snapshot)).toBe('invalid');
        const current = baseContext();
        current.exhibits[0].exhibit_name = 'Updated Reef';
        current.tanks = [];
        current.systems.push({ id: 'system-2', project_id: 'project-1', system_code: 'LSS-2', system_name: 'New LSS' });
        const drift = designBooks_1.versionSnapshotTestUtils.calculateVersionDrift(snapshot, current);
        (0, vitest_1.expect)(drift.has_drift).toBe(true);
        (0, vitest_1.expect)(drift.collections.exhibits.changed).toEqual(['exhibit-1']);
        (0, vitest_1.expect)(drift.collections.tanks.removed).toEqual(['tank-1']);
        (0, vitest_1.expect)(drift.collections.systems.added).toEqual(['system-2']);
        (0, vitest_1.expect)(drift.unresolved_references).toContainEqual({ type: 'tank', id: 'tank-1' });
    });
    (0, vitest_1.it)('takes a transaction-scoped lock before allocating a concurrent version number', async () => {
        const calls = [];
        const runner = vitest_1.vi.fn(async (sql, params) => {
            calls.push(sql);
            if (sql.includes('MAX(version_number)'))
                return { rows: [{ next: 8 }] };
            if (sql.includes('INSERT INTO design_book_versions')) {
                return { rows: [{ id: 'version-8', version_number: params?.[1], created_at: new Date().toISOString() }] };
            }
            return { rows: [] };
        });
        const snapshot = designBooks_1.versionSnapshotTestUtils.makeVersionSnapshot(baseContext());
        const result = await designBooks_1.versionSnapshotTestUtils.insertVersion(runner, 'book-1', 'Concurrent save', null, snapshot, 'user-1');
        (0, vitest_1.expect)(calls[0]).toContain('pg_advisory_xact_lock');
        (0, vitest_1.expect)(calls[1]).toContain('MAX(version_number)');
        (0, vitest_1.expect)(calls[2]).toContain('INSERT INTO design_book_versions');
        (0, vitest_1.expect)(result.version_number).toBe(8);
        const insertParams = runner.mock.calls[2][1];
        (0, vitest_1.expect)(insertParams[6]).toBe(2);
        (0, vitest_1.expect)(insertParams[7]).toBe(snapshot.integrity.digest);
    });
    (0, vitest_1.it)('preserves uncaptured handovers for legacy snapshots and invalidates stale restore previews', () => {
        const legacy = {
            book_title: 'Legacy',
            revision: 'A',
            status: 'Draft',
            species: [],
            hydraulics: [],
            substrate: [],
        };
        const frozen = designBooks_1.versionSnapshotTestUtils.frozenFromSnapshot(legacy);
        (0, vitest_1.expect)(Object.prototype.hasOwnProperty.call(frozen, 'review_handovers')).toBe(false);
        const before = baseContext();
        const previewToken = designBooks_1.versionSnapshotTestUtils.currentRestoreStateDigest(before);
        const edited = baseContext();
        edited.species[0].quantity = 12;
        (0, vitest_1.expect)(designBooks_1.versionSnapshotTestUtils.currentRestoreStateDigest(edited)).not.toBe(previewToken);
    });
    (0, vitest_1.it)('creates under a real PostgreSQL parent lock and rolls back a failed checkpoint transaction', async () => {
        const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const user = await db_1.default.query(`INSERT INTO users (email, password_hash, first_name, last_name, role)
       VALUES ($1,'test-hash','Version','Tester','engineer') RETURNING id`, [`version-test-${suffix}@example.test`]);
        const project = await db_1.default.query(`INSERT INTO projects (project_code, project_name, created_by)
       VALUES ($1,$2,$3) RETURNING id`, [`VT-${suffix}`, 'Version transaction test', user.rows[0].id]);
        const book = await db_1.default.query(`INSERT INTO design_books (book_code, book_title, project_id, status, created_by)
       VALUES ($1,'Version transaction test',$2,'Draft',$3) RETURNING id`, [`DB-VT-${suffix}`, project.rows[0].id, user.rows[0].id]);
        try {
            const createClient = await db_1.default.connect();
            try {
                await createClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
                const context = await designBooks_1.versionSnapshotTestUtils.loadReleaseContext(book.rows[0].id, createClient.query.bind(createClient), true, true);
                const snapshot = designBooks_1.versionSnapshotTestUtils.makeVersionSnapshot(context);
                await designBooks_1.versionSnapshotTestUtils.insertVersion(createClient.query.bind(createClient), book.rows[0].id, 'Database-backed version', null, snapshot, user.rows[0].id);
                await createClient.query('COMMIT');
            }
            finally {
                createClient.release();
            }
            (0, vitest_1.expect)((await db_1.default.query('SELECT COUNT(*)::int AS count FROM design_book_versions WHERE design_book_id=$1', [book.rows[0].id])).rows[0].count).toBe(1);
            const restoreClient = await db_1.default.connect();
            try {
                await restoreClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
                const context = await designBooks_1.versionSnapshotTestUtils.loadReleaseContext(book.rows[0].id, restoreClient.query.bind(restoreClient), true, true);
                await designBooks_1.versionSnapshotTestUtils.insertVersion(restoreClient.query.bind(restoreClient), book.rows[0].id, 'Recovery before injected failure', null, designBooks_1.versionSnapshotTestUtils.makeVersionSnapshot(context), user.rows[0].id, true);
                throw new Error('injected restore failure');
            }
            catch (error) {
                await restoreClient.query('ROLLBACK');
                (0, vitest_1.expect)(error.message).toBe('injected restore failure');
            }
            finally {
                restoreClient.release();
            }
            (0, vitest_1.expect)((await db_1.default.query('SELECT COUNT(*)::int AS count FROM design_book_versions WHERE design_book_id=$1', [book.rows[0].id])).rows[0].count).toBe(1);
        }
        finally {
            await db_1.default.query('DELETE FROM design_books WHERE id=$1', [book.rows[0].id]);
            await db_1.default.query('DELETE FROM projects WHERE id=$1', [project.rows[0].id]);
            await db_1.default.query('DELETE FROM users WHERE id=$1', [user.rows[0].id]);
        }
    });
});
