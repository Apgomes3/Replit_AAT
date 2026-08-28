import dotenv from 'dotenv';
import pool from './index';
import { seedSpeciesCatalog } from './speciesCatalogSeed';

dotenv.config();

async function main() {
  const client = await pool.connect();
  try {
    const reviewedRecords = await seedSpeciesCatalog(client, null);
    const coverage = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE active AND family = 'Carangidae')::int AS carangidae,
         COUNT(*) FILTER (WHERE active AND family = 'Scombridae')::int AS scombridae,
         COUNT(*) FILTER (
           WHERE active AND family = ANY($1::text[])
         )::int AS sharks
       FROM aquarium_species_catalog`,
      [[
        'Carcharhinidae', 'Ginglymostomatidae', 'Hemiscylliidae', 'Heterodontidae',
        'Orectolobidae', 'Stegostomatidae', 'Scyliorhinidae', 'Triakidae',
        'Rhincodontidae', 'Odontaspididae', 'Sphyrnidae', 'Hexanchidae',
      ]],
    );
    const counts = coverage.rows[0];
    console.log(
      `Species catalog synchronized from ${reviewedRecords} reviewed records ` +
      `(${counts.carangidae} Carangidae, ${counts.scombridae} Scombridae, ${counts.sharks} sharks active).`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error('Species catalog synchronization failed:', error);
  process.exit(1);
});