"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const db_1 = __importDefault(require("../db"));
(0, vitest_1.describe)('Aquarium species catalog persistence', () => {
    (0, vitest_1.it)('supports corrections and deactivation without rewriting historical allocations', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const user = await db_1.default.query(`INSERT INTO users (email, password_hash, role)
       VALUES ($1,'test','admin') RETURNING id`, [`species-${suffix}@example.test`]);
        const project = await db_1.default.query(`INSERT INTO projects (project_code, project_name, created_by)
       VALUES ($1,'Species test',$2) RETURNING id`, [`SP-${suffix}`, user.rows[0].id]);
        const exhibit = await db_1.default.query(`INSERT INTO exhibits (project_id, exhibit_code, exhibit_name, water_type)
       VALUES ($1,'EX-1','Species test exhibit','Marine') RETURNING id`, [project.rows[0].id]);
        const book = await db_1.default.query(`INSERT INTO design_books (book_code, book_title, project_id, created_by)
       VALUES ($1,'Species test book',$2,$3) RETURNING id`, [`DB-SP-${suffix}`, project.rows[0].id, user.rows[0].id]);
        const scientificName = `Testus ${suffix}`.slice(0, 255);
        const catalog = await db_1.default.query(`INSERT INTO aquarium_species_catalog
         (scientific_name, common_name, family, water_type, average_size_cm,
          reference_average_mass_kg, source, created_by, updated_by)
       VALUES ($1,'Test fish','Testidae','Marine',20,0.4,'Verified test reference',$2,$2)
       RETURNING id`, [scientificName, user.rows[0].id]);
        try {
            const allocation = await db_1.default.query(`INSERT INTO design_book_exhibit_species
           (design_book_id, exhibit_id, catalog_species_id, species_name, common_name,
            quantity, avg_size_cm, reference_average_mass_kg, biomass_kg)
         VALUES ($1,$2,$3,$4,'Test fish',10,20,0.4,4)
         RETURNING id`, [book.rows[0].id, exhibit.rows[0].id, catalog.rows[0].id, scientificName]);
            await db_1.default.query(`UPDATE aquarium_species_catalog
         SET average_size_cm=24, reference_average_mass_kg=0.6, active=false
         WHERE id=$1`, [catalog.rows[0].id]);
            const historical = (await db_1.default.query(`SELECT avg_size_cm, reference_average_mass_kg, biomass_kg
         FROM design_book_exhibit_species WHERE id=$1`, [allocation.rows[0].id])).rows[0];
            (0, vitest_1.expect)(historical).toMatchObject({
                avg_size_cm: '20',
                reference_average_mass_kg: '0.4000',
                biomass_kg: '4',
            });
            await (0, vitest_1.expect)(db_1.default.query(`INSERT INTO aquarium_species_catalog
           (scientific_name, family, water_type, source)
         VALUES ($1,'Testidae','Marine','Duplicate test')`, [scientificName.toUpperCase()])).rejects.toMatchObject({ code: '23505' });
            await (0, vitest_1.expect)(db_1.default.query(`INSERT INTO aquarium_species_catalog
           (scientific_name, family, water_type, average_size_cm, source)
         VALUES ($1,'Testidae','Marine',-1,'Invalid measurement test')`, [`Invalidus ${suffix}`.slice(0, 255)])).rejects.toMatchObject({ code: '23514' });
        }
        finally {
            await db_1.default.query('DELETE FROM aquarium_species_catalog WHERE id=$1', [catalog.rows[0].id]);
            await db_1.default.query('DELETE FROM design_books WHERE id=$1', [book.rows[0].id]);
            await db_1.default.query('DELETE FROM projects WHERE id=$1', [project.rows[0].id]);
            await db_1.default.query('DELETE FROM users WHERE id=$1', [user.rows[0].id]);
        }
    });
});
