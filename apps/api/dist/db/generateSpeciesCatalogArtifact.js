"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertCandidateOutputPath = assertCandidateOutputPath;
exports.generate = generate;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const speciesCatalogSeed_1 = require("./speciesCatalogSeed");
function option(name, fallback) {
    const index = process.argv.indexOf(name);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
function assertCandidateOutputPath(output) {
    if (/^speciesCatalogArtifact\.v\d+\.json$/i.test(path_1.default.basename(output))) {
        throw new Error('Candidate output cannot target a reviewed speciesCatalogArtifact file.');
    }
}
async function generate() {
    const version = Number(option('--version', '2'));
    if (!Number.isInteger(version) || version < 2) {
        throw new Error('Artifact version must be an integer greater than or equal to 2.');
    }
    const records = await (0, speciesCatalogSeed_1.fetchSpeciesCatalogStageOne)();
    if (records.length !== speciesCatalogSeed_1.SPECIES_CATALOG_GBIF_STAGE_ONE_SIZE) {
        throw new Error(`Expected ${speciesCatalogSeed_1.SPECIES_CATALOG_GBIF_STAGE_ONE_SIZE} staged records, received ${records.length}.`);
    }
    const artifact = {
        version,
        status: 'candidate',
        generated_at: new Date().toISOString().slice(0, 10),
        source: 'GBIF Backbone Taxonomy species search; review taxonomy and planning assumptions before accepting this candidate.',
        records,
    };
    const output = option('--out', path_1.default.join(__dirname, `speciesCatalogCandidate.v${version}.json`));
    assertCandidateOutputPath(output);
    await promises_1.default.writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${records.length} records to ${output}. Review the candidate before using it.`);
}
if (require.main === module) {
    generate().catch(error => {
        console.error(`Species catalog artifact generation failed: ${error instanceof Error ? error.message : error}`);
        process.exitCode = 1;
    });
}
