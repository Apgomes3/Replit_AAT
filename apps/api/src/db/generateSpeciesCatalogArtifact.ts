import fs from 'fs/promises';
import path from 'path';
import {
  fetchSpeciesCatalogStageOne,
  SPECIES_CATALOG_GBIF_STAGE_ONE_SIZE,
} from './speciesCatalogSeed';

type Artifact = {
  version: number;
  status: 'candidate';
  generated_at: string;
  source: string;
  records: Awaited<ReturnType<typeof fetchSpeciesCatalogStageOne>>;
};

function option(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

export function assertCandidateOutputPath(output: string) {
  if (/^speciesCatalogArtifact\.v\d+\.json$/i.test(path.basename(output))) {
    throw new Error('Candidate output cannot target a reviewed speciesCatalogArtifact file.');
  }
}

export async function generate() {
  const version = Number(option('--version', '2'));
  if (!Number.isInteger(version) || version < 2) {
    throw new Error('Artifact version must be an integer greater than or equal to 2.');
  }

  const records = await fetchSpeciesCatalogStageOne();
  if (records.length !== SPECIES_CATALOG_GBIF_STAGE_ONE_SIZE) {
    throw new Error(`Expected ${SPECIES_CATALOG_GBIF_STAGE_ONE_SIZE} staged records, received ${records.length}.`);
  }

  const artifact: Artifact = {
    version,
    status: 'candidate',
    generated_at: new Date().toISOString().slice(0, 10),
    source: 'GBIF Backbone Taxonomy species search; review taxonomy and planning assumptions before accepting this candidate.',
    records,
  };
  const output = option(
    '--out',
    path.join(__dirname, `speciesCatalogCandidate.v${version}.json`),
  );
  assertCandidateOutputPath(output);
  await fs.writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${records.length} records to ${output}. Review the candidate before using it.`);
}

if (require.main === module) {
  generate().catch(error => {
    console.error(`Species catalog artifact generation failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}