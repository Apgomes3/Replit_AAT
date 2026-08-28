import { describe, expect, it, vi } from 'vitest';
import { versionSnapshotTestUtils } from './designBooks';
import pool from '../db';

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
    loop1_flow_pct: '55',
    loop1_bio_degas_pct: '30',
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
  species: [{
    id: 'species-1',
    exhibit_id: 'exhibit-1',
    catalog_species_id: 'catalog-1',
    species_name: 'Amphiprion ocellaris',
    common_name: 'Common clownfish',
    quantity: 10,
    avg_size_cm: '11',
    reference_average_mass_kg: '0.08',
    biomass_kg: '1.2',
    avg_size_override_cm: '11',
    reference_mass_override_kg: null,
    biomass_override_kg: '1.2',
    sort_order: 1,
  }],
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

describe('Design Book version snapshots', () => {
  it('uses inherited PIM tank dimensions and custom surface area in release calculations', async () => {
    const tankRow: Record<string, any> = {
      id: 'tank-1',
      project_id: 'project-1',
      exhibit_id: 'exhibit-1',
      product_master_id: 'pim-tank-1',
      eff_shape: 'Rectangular',
      eff_length_mm: '6000',
      eff_width_mm: '3500',
      eff_height_mm: '2800',
      eff_water_level_mm: '2500',
      design_volume_m3: '52.5',
      quantity: 1,
    };
    const hydraulicRows: Record<string, any>[] = [];
    const substrateRows: Record<string, any>[] = [];
    const runner = vi.fn(async (sql: string) => {
      if (sql.includes('FROM design_books db')) {
        return { rows: [{
          id: 'book-1',
          project_id: 'project-1',
          status: 'Draft',
          project_scopes: ['Tanks'],
          project_code: 'P-001',
          project_name: 'Ocean Centre',
        }] };
      }
      if (sql.includes('FROM exhibits')) {
        return { rows: [{ id: 'exhibit-1', project_id: 'project-1', exhibit_code: 'EX-1', exhibit_name: 'Reef' }] };
      }
      if (sql.includes('FROM tanks t')) {
        expect(sql).toContain('LEFT JOIN product_masters');
        expect(sql).toContain('COALESCE(t.length_mm, pm.length_mm) AS eff_length_mm');
        expect(sql).toContain('t.surface_area_m2');
        expect(sql).toContain('pm.surface_area_m2');
        expect(sql).toContain("COALESCE(t.shape_type, pm.shape_type) IS DISTINCT FROM 'Cylindrical'");
        return { rows: [{ ...tankRow }] };
      }
      if (sql.includes('FROM systems')) return { rows: [] };
      if (sql.includes('FROM design_book_exhibit_species')) return { rows: [] };
      if (sql.includes('FROM design_book_exhibit_hydraulics')) return { rows: hydraulicRows };
      if (sql.includes('FROM design_book_exhibit_substrate')) return { rows: substrateRows };
      if (sql.includes('FROM design_book_review_handovers')) return { rows: [] };
      return { rows: [] };
    });

    const context = await versionSnapshotTestUtils.loadReleaseContext('book-1', runner as any, false, true);

    expect(context.tanks[0]).toMatchObject({
      product_master_id: 'pim-tank-1',
      eff_length_mm: '6000',
    });
    expect(context.engineering_calculations.exhibits[0].results).toMatchObject({
      operating_volume_m3: 52.5,
    });

    Object.assign(tankRow, {
      eff_shape: 'Custom',
      eff_length_mm: null,
      eff_width_mm: null,
      eff_height_mm: null,
      eff_water_level_mm: null,
      design_volume_m3: '40',
      surface_area_m2: '20',
    });
    hydraulicRows.push({ exhibit_id: 'exhibit-1', target_turnover_rate: '4' });
    substrateRows.push({ exhibit_id: 'exhibit-1', substrate_height_mm: '100' });

    const customContext = await versionSnapshotTestUtils.loadReleaseContext('book-1', runner as any, false, true);
    const customCalculation = customContext.engineering_calculations.exhibits[0];
    expect(customContext.tanks[0].surface_area_m2).toBe('20');
    expect(customCalculation.status).toBe('valid');
    expect(customCalculation.inputs).toMatchObject({
      substrate_volume_m3: 2,
      substrate_source: 'footprint area × height',
    });
    expect(customCalculation.results.operating_volume_m3).toBe(38);
  });

  it('captures every supported hydraulic, theming, and exhibit-system link field with a valid checksum', () => {
    const snapshot = versionSnapshotTestUtils.makeVersionSnapshot(baseContext(), '2026-08-27T10:00:00.000Z');

    expect(snapshot.schema_version).toBe(2);
    expect(versionSnapshotTestUtils.snapshotIntegrityStatus(snapshot)).toBe('verified');
    expect(snapshot.frozen.hydraulics[0]).toMatchObject({
      weir_formula_method: 'francis_184',
      weir_downstream_head_mm: '22',
      calculation_version: 'aquarium-v1',
      calculation_inputs: { turnover_unit: 'cycles_per_hour' },
      override_reason: 'Approved engineering deviation',
    });
    expect(snapshot.frozen.substrate[0]).toMatchObject({
      substrate_height_mm: '80',
      theming_height_mm: '500',
      theming_volume_pct: '8.5',
    });
    expect(snapshot.frozen.species[0]).toMatchObject({
      catalog_species_id: 'catalog-1',
      species_name: 'Amphiprion ocellaris',
      avg_size_cm: '11',
      reference_average_mass_kg: '0.08',
      biomass_kg: '1.2',
      avg_size_override_cm: '11',
      biomass_override_kg: '1.2',
    });
    expect(snapshot.live_references.system_links[0]).toMatchObject({
      system_id: 'system-1',
      exhibit_id: 'exhibit-1',
      flow_allocation_m3h: '12.5',
      allocation_source: 'manual',
    });
    expect(snapshot.live_references.systems[0]).toMatchObject({
      id: 'system-1',
      loop1_flow_source: 'Calculated',
      loop1_flow_pct: '55',
      loop1_bio_degas_pct: '30',
      loop1_bio_degas_m3h: '12.5',
    });
  });

  it('detects tampering and reports changed, added, removed, and unresolved project references', () => {
    const snapshot = versionSnapshotTestUtils.makeVersionSnapshot(baseContext());
    expect(versionSnapshotTestUtils.snapshotIntegrityStatus(snapshot, null, true)).toBe('invalid');
    expect(versionSnapshotTestUtils.snapshotIntegrityStatus(snapshot, 'wrong-database-checksum')).toBe('invalid');
    snapshot.frozen.design_book.book_title = 'Tampered';
    expect(versionSnapshotTestUtils.snapshotIntegrityStatus(snapshot)).toBe('invalid');

    const current = baseContext();
    current.exhibits[0].exhibit_name = 'Updated Reef';
    current.tanks = [];
    current.systems.push({ id: 'system-2', project_id: 'project-1', system_code: 'LSS-2', system_name: 'New LSS' } as any);
    const drift = versionSnapshotTestUtils.calculateVersionDrift(snapshot, current);
    expect(drift.has_drift).toBe(true);
    expect(drift.collections.exhibits.changed).toEqual(['exhibit-1']);
    expect(drift.collections.tanks.removed).toEqual(['tank-1']);
    expect(drift.collections.systems.added).toEqual(['system-2']);
    expect(drift.unresolved_references).toContainEqual({ type: 'tank', id: 'tank-1' });
  });

  it('takes a transaction-scoped lock before allocating a concurrent version number', async () => {
    const calls: string[] = [];
    const runner = vi.fn(async (sql: string, params?: any[]) => {
      calls.push(sql);
      if (sql.includes('MAX(version_number)')) return { rows: [{ next: 8 }] };
      if (sql.includes('INSERT INTO design_book_versions')) {
        return { rows: [{ id: 'version-8', version_number: params?.[1], created_at: new Date().toISOString() }] };
      }
      return { rows: [] };
    });
    const snapshot = versionSnapshotTestUtils.makeVersionSnapshot(baseContext());

    const result = await versionSnapshotTestUtils.insertVersion(
      runner,
      'book-1',
      'Concurrent save',
      null,
      snapshot,
      'user-1',
    );

    expect(calls[0]).toContain('pg_advisory_xact_lock');
    expect(calls[1]).toContain('MAX(version_number)');
    expect(calls[2]).toContain('INSERT INTO design_book_versions');
    expect(result.version_number).toBe(8);
    const insertParams = runner.mock.calls[2][1] as any[];
    expect(insertParams[6]).toBe(2);
    expect(insertParams[7]).toBe(snapshot.integrity.digest);
  });

  it('preserves uncaptured handovers for legacy snapshots and invalidates stale restore previews', () => {
    const legacy = {
      book_title: 'Legacy',
      revision: 'A',
      status: 'Draft',
      species: [],
      hydraulics: [],
      substrate: [],
    };
    const frozen = versionSnapshotTestUtils.frozenFromSnapshot(legacy);
    expect(Object.prototype.hasOwnProperty.call(frozen, 'review_handovers')).toBe(false);

    const before = baseContext();
    const previewToken = versionSnapshotTestUtils.currentRestoreStateDigest(before);
    const edited = baseContext();
    (edited.species[0] as any).quantity = 12;
    expect(versionSnapshotTestUtils.currentRestoreStateDigest(edited)).not.toBe(previewToken);
  });

  it('creates under a real PostgreSQL parent lock and rolls back a failed checkpoint transaction', async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const user = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role)
       VALUES ($1,'test-hash','Version','Tester','engineer') RETURNING id`,
      [`version-test-${suffix}@example.test`],
    );
    const project = await pool.query(
      `INSERT INTO projects (project_code, project_name, created_by)
       VALUES ($1,$2,$3) RETURNING id`,
      [`VT-${suffix}`, 'Version transaction test', user.rows[0].id],
    );
    const book = await pool.query(
      `INSERT INTO design_books (book_code, book_title, project_id, status, created_by)
       VALUES ($1,'Version transaction test',$2,'Draft',$3) RETURNING id`,
      [`DB-VT-${suffix}`, project.rows[0].id, user.rows[0].id],
    );
    try {
      const createClient = await pool.connect();
      try {
        await createClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const context = await versionSnapshotTestUtils.loadReleaseContext(
          book.rows[0].id,
          createClient.query.bind(createClient) as any,
          true,
          true,
        );
        const snapshot = versionSnapshotTestUtils.makeVersionSnapshot(context);
        await versionSnapshotTestUtils.insertVersion(
          createClient.query.bind(createClient) as any,
          book.rows[0].id,
          'Database-backed version',
          null,
          snapshot,
          user.rows[0].id,
        );
        await createClient.query('COMMIT');
      } finally {
        createClient.release();
      }
      expect((await pool.query(
        'SELECT COUNT(*)::int AS count FROM design_book_versions WHERE design_book_id=$1',
        [book.rows[0].id],
      )).rows[0].count).toBe(1);

      const restoreClient = await pool.connect();
      try {
        await restoreClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const context = await versionSnapshotTestUtils.loadReleaseContext(
          book.rows[0].id,
          restoreClient.query.bind(restoreClient) as any,
          true,
          true,
        );
        await versionSnapshotTestUtils.insertVersion(
          restoreClient.query.bind(restoreClient) as any,
          book.rows[0].id,
          'Recovery before injected failure',
          null,
          versionSnapshotTestUtils.makeVersionSnapshot(context),
          user.rows[0].id,
          true,
        );
        throw new Error('injected restore failure');
      } catch (error: any) {
        await restoreClient.query('ROLLBACK');
        expect(error.message).toBe('injected restore failure');
      } finally {
        restoreClient.release();
      }
      expect((await pool.query(
        'SELECT COUNT(*)::int AS count FROM design_book_versions WHERE design_book_id=$1',
        [book.rows[0].id],
      )).rows[0].count).toBe(1);
    } finally {
      await pool.query('DELETE FROM design_books WHERE id=$1', [book.rows[0].id]);
      await pool.query('DELETE FROM projects WHERE id=$1', [project.rows[0].id]);
      await pool.query('DELETE FROM users WHERE id=$1', [user.rows[0].id]);
    }
  });
});