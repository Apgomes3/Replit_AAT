import path from 'path';
import { describe, expect, it } from 'vitest';
import { assertCandidateOutputPath } from './generateSpeciesCatalogArtifact';

describe('species catalog candidate artifact output', () => {
  it('keeps candidate generation away from reviewed artifact filenames', () => {
    expect(() => assertCandidateOutputPath(
      path.join('/tmp', 'speciesCatalogArtifact.v2.json'),
    )).toThrow(/cannot target a reviewed/i);
    expect(() => assertCandidateOutputPath(
      path.join('/tmp', 'speciesCatalogArtifact.v99.json'),
    )).toThrow(/cannot target a reviewed/i);
  });

  it('allows explicitly named candidate files', () => {
    expect(() => assertCandidateOutputPath(
      path.join('/tmp', 'speciesCatalogCandidate.v3.json'),
    )).not.toThrow();
  });
});