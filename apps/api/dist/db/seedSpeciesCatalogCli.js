"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const index_1 = __importDefault(require("./index"));
const speciesCatalogSeed_1 = require("./speciesCatalogSeed");
dotenv_1.default.config();
async function main() {
    const client = await index_1.default.connect();
    try {
        const reviewedRecords = await (0, speciesCatalogSeed_1.seedSpeciesCatalog)(client, null);
        const coverage = await client.query(`SELECT
         COUNT(*) FILTER (WHERE active AND family = 'Carangidae')::int AS carangidae,
         COUNT(*) FILTER (WHERE active AND family = 'Scombridae')::int AS scombridae,
         COUNT(*) FILTER (
           WHERE active AND family = ANY($1::text[])
         )::int AS sharks
       FROM aquarium_species_catalog`, [[
                'Carcharhinidae', 'Ginglymostomatidae', 'Hemiscylliidae', 'Heterodontidae',
                'Orectolobidae', 'Stegostomatidae', 'Scyliorhinidae', 'Triakidae',
                'Rhincodontidae', 'Odontaspididae', 'Sphyrnidae', 'Hexanchidae',
            ]]);
        const counts = coverage.rows[0];
        console.log(`Species catalog synchronized from ${reviewedRecords} reviewed records ` +
            `(${counts.carangidae} Carangidae, ${counts.scombridae} Scombridae, ${counts.sharks} sharks active).`);
    }
    finally {
        client.release();
        await index_1.default.end();
    }
}
main().catch(error => {
    console.error('Species catalog synchronization failed:', error);
    process.exit(1);
});
