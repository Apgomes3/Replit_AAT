"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const pg_1 = require("pg");
const vitest_1 = require("vitest");
const port = 31000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}/api/v1`;
const db = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
let server;
async function waitForServer() {
    for (let attempt = 0; attempt < 50; attempt++) {
        try {
            await fetch(`${baseUrl}/health`);
            return;
        }
        catch {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    throw new Error('Compiled API did not start');
}
(0, vitest_1.beforeAll)(async () => {
    const compiledSeed = require(`${process.cwd()}/apps/api/dist/db/speciesCatalogSeed.js`);
    const client = await db.connect();
    try {
        await compiledSeed.seedSpeciesCatalog(client, null);
    }
    finally {
        client.release();
    }
    server = (0, child_process_1.spawn)(process.execPath, ['apps/api/dist/index.js'], {
        env: { ...process.env, PORT: String(port) },
        stdio: 'ignore',
    });
    await waitForServer();
}, 15000);
(0, vitest_1.afterAll)(async () => {
    server?.kill('SIGTERM');
    await db.end();
});
(0, vitest_1.describe)('compiled species catalog runtime', () => {
    (0, vitest_1.it)('serves active reviewed expansions through search and family and water-type facets', async () => {
        const admin = (await db.query(`SELECT id,email,role FROM users WHERE email='admin@edp.com'`)).rows[0];
        const auth = (user) => ({
            authorization: `Bearer ${jsonwebtoken_1.default.sign(user, process.env.JWT_SECRET || 'edp-secret-change-in-production')}`,
            'content-type': 'application/json',
        });
        const inactiveName = `Hiddenus ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await db.query(`INSERT INTO aquarium_species_catalog
         (scientific_name, common_name, family, water_type, average_size_cm,
          reference_average_mass_kg, source, active, created_by, updated_by)
       VALUES ($1,'Hidden test fish','Testidae','Marine',20,.4,'Runtime active-filter test',false,$2,$2)`, [inactiveName, admin.id]);
        try {
            const commonSearch = await fetch(`${baseUrl}/species-catalog?q=yellowfin&limit=12`, {
                headers: auth(admin),
            });
            const commonPayload = await commonSearch.json();
            (0, vitest_1.expect)(commonSearch.status).toBe(200);
            (0, vitest_1.expect)(commonPayload.items).toEqual(vitest_1.expect.arrayContaining([
                vitest_1.expect.objectContaining({
                    scientific_name: 'Thunnus albacares',
                    common_name: 'Yellowfin tuna',
                    family: 'Scombridae',
                    active: true,
                }),
            ]));
            const scientificSearch = await fetch(`${baseUrl}/species-catalog?q=Rhincodon%20typus&limit=12`, {
                headers: auth(admin),
            });
            const scientificPayload = await scientificSearch.json();
            (0, vitest_1.expect)(scientificSearch.status).toBe(200);
            (0, vitest_1.expect)(scientificPayload.items).toEqual(vitest_1.expect.arrayContaining([
                vitest_1.expect.objectContaining({
                    scientific_name: 'Rhincodon typus',
                    family: 'Rhincodontidae',
                    active: true,
                }),
            ]));
            const koiSearch = await fetch(`${baseUrl}/species-catalog?q=Koi&limit=12`, {
                headers: auth(admin),
            });
            const koiPayload = await koiSearch.json();
            (0, vitest_1.expect)(koiSearch.status).toBe(200);
            (0, vitest_1.expect)(koiPayload.items).toEqual(vitest_1.expect.arrayContaining([
                vitest_1.expect.objectContaining({
                    scientific_name: 'Cyprinus carpio',
                    common_name: 'Koi Fish',
                    family: 'Cyprinidae',
                    water_type: 'Freshwater',
                    active: true,
                }),
            ]));
            const inactiveSearch = await fetch(`${baseUrl}/species-catalog?q=${encodeURIComponent(inactiveName)}&limit=12`, { headers: auth(admin) });
            (0, vitest_1.expect)((await inactiveSearch.json()).items).toHaveLength(0);
            const inactiveIncluded = await fetch(`${baseUrl}/species-catalog?q=${encodeURIComponent(inactiveName)}&include_inactive=true&limit=12`, { headers: auth(admin) });
            (0, vitest_1.expect)((await inactiveIncluded.json()).items).toEqual([
                vitest_1.expect.objectContaining({ scientific_name: inactiveName, active: false }),
            ]);
            const facets = await fetch(`${baseUrl}/species-catalog/facets`, { headers: auth(admin) });
            const facetsPayload = await facets.json();
            (0, vitest_1.expect)(facets.status).toBe(200);
            (0, vitest_1.expect)(facetsPayload.families).toEqual(vitest_1.expect.arrayContaining([
                vitest_1.expect.objectContaining({ family: 'Carangidae' }),
                vitest_1.expect.objectContaining({ family: 'Scombridae' }),
                vitest_1.expect.objectContaining({ family: 'Rhincodontidae' }),
                vitest_1.expect.objectContaining({ family: 'Cyprinidae' }),
                vitest_1.expect.objectContaining({ family: 'Centrarchidae' }),
                vitest_1.expect.objectContaining({ family: 'Percidae' }),
                vitest_1.expect.objectContaining({ family: 'Salmonidae' }),
            ]));
            (0, vitest_1.expect)(facetsPayload.water_types).toEqual(vitest_1.expect.arrayContaining([
                vitest_1.expect.objectContaining({ water_type: 'Marine' }),
                vitest_1.expect.objectContaining({ water_type: 'Freshwater' }),
            ]));
        }
        finally {
            await db.query('DELETE FROM aquarium_species_catalog WHERE scientific_name=$1', [inactiveName]);
        }
    });
    (0, vitest_1.it)('preserves snapshots and denies view-only writes', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const admin = (await db.query(`SELECT id,email,role FROM users WHERE email='admin@edp.com'`)).rows[0];
        const engineer = (await db.query(`SELECT id,email,role FROM users WHERE email='engineer@edp.com'`)).rows[0];
        const auth = (user) => ({
            authorization: `Bearer ${jsonwebtoken_1.default.sign(user, process.env.JWT_SECRET || 'edp-secret-change-in-production')}`,
            'content-type': 'application/json',
        });
        const engineerRole = (await db.query(`SELECT id FROM roles WHERE name='engineer'`)).rows[0];
        const priorAccess = (await db.query(`SELECT access_level FROM role_module_access WHERE role_id=$1 AND module_key='design_books'`, [engineerRole.id])).rows[0]?.access_level;
        const ids = {};
        try {
            ids.project = (await db.query(`INSERT INTO projects(project_code,project_name,created_by) VALUES($1,'Runtime parity',$2) RETURNING id`, [`PAR-${suffix}`, admin.id])).rows[0].id;
            ids.exhibit = (await db.query(`INSERT INTO exhibits(project_id,exhibit_code,exhibit_name) VALUES($1,'PAR-E','Parity exhibit') RETURNING id`, [ids.project])).rows[0].id;
            ids.book = (await db.query(`INSERT INTO design_books(book_code,book_title,project_id,created_by) VALUES($1,'Parity book',$2,$3) RETURNING id`, [`PAR-B-${suffix}`, ids.project, admin.id])).rows[0].id;
            ids.catalog = (await db.query(`INSERT INTO aquarium_species_catalog
           (scientific_name,family,water_type,average_size_cm,reference_average_mass_kg,source,created_by,updated_by)
         VALUES($1,'Parityidae','Marine',20,.4,'Runtime parity',$2,$2) RETURNING id`, [`Parityus ${suffix}`, admin.id])).rows[0].id;
            const create = await fetch(`${baseUrl}/design-books/${ids.book}/species`, {
                method: 'POST', headers: auth(admin),
                body: JSON.stringify({ exhibit_id: ids.exhibit, catalog_species_id: ids.catalog, quantity: 10 }),
            });
            (0, vitest_1.expect)(create.status).toBe(201);
            ids.allocation = (await create.json()).id;
            await db.query(`UPDATE aquarium_species_catalog SET average_size_cm=24,reference_average_mass_kg=.6 WHERE id=$1`, [ids.catalog]);
            const update = await fetch(`${baseUrl}/design-books/${ids.book}/species/${ids.allocation}`, {
                method: 'PUT', headers: auth(admin),
                body: JSON.stringify({
                    catalog_species_id: ids.catalog, quantity: 10, notes: 'Notes-only edit',
                    avg_size_override_cm: null, reference_mass_override_kg: null, biomass_override_kg: null,
                }),
            });
            const updated = (await update.json());
            (0, vitest_1.expect)(update.status).toBe(200);
            (0, vitest_1.expect)(Number(updated.reference_average_mass_kg)).toBe(0.4);
            (0, vitest_1.expect)(Number(updated.biomass_kg)).toBe(4);
            await db.query(`INSERT INTO role_module_access(role_id,module_key,access_level)
         VALUES($1,'design_books','view')
         ON CONFLICT(role_id,module_key) DO UPDATE SET access_level='view'`, [engineerRole.id]);
            const catalogDenied = await fetch(`${baseUrl}/species-catalog`, {
                method: 'POST', headers: auth(engineer),
                body: JSON.stringify({ scientific_name: `Deniedus ${suffix}`, family: 'Denied', water_type: 'Marine', source: 'Test' }),
            });
            const allocationDenied = await fetch(`${baseUrl}/design-books/${ids.book}/species`, {
                method: 'POST', headers: auth(engineer),
                body: JSON.stringify({ exhibit_id: ids.exhibit, catalog_species_id: ids.catalog, quantity: 1 }),
            });
            (0, vitest_1.expect)(catalogDenied.status).toBe(403);
            (0, vitest_1.expect)(allocationDenied.status).toBe(403);
        }
        finally {
            if (priorAccess) {
                await db.query(`UPDATE role_module_access SET access_level=$1 WHERE role_id=$2 AND module_key='design_books'`, [priorAccess, engineerRole.id]);
            }
            else {
                await db.query(`DELETE FROM role_module_access WHERE role_id=$1 AND module_key='design_books'`, [engineerRole.id]);
            }
            if (ids.book)
                await db.query('DELETE FROM design_books WHERE id=$1', [ids.book]);
            if (ids.catalog)
                await db.query('DELETE FROM aquarium_species_catalog WHERE id=$1', [ids.catalog]);
            if (ids.project)
                await db.query('DELETE FROM projects WHERE id=$1', [ids.project]);
        }
    });
});
