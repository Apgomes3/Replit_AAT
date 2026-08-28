"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const vitest_1 = require("vitest");
const generateSpeciesCatalogArtifact_1 = require("./generateSpeciesCatalogArtifact");
(0, vitest_1.describe)('species catalog candidate artifact output', () => {
    (0, vitest_1.it)('keeps candidate generation away from reviewed artifact filenames', () => {
        (0, vitest_1.expect)(() => (0, generateSpeciesCatalogArtifact_1.assertCandidateOutputPath)(path_1.default.join('/tmp', 'speciesCatalogArtifact.v2.json'))).toThrow(/cannot target a reviewed/i);
        (0, vitest_1.expect)(() => (0, generateSpeciesCatalogArtifact_1.assertCandidateOutputPath)(path_1.default.join('/tmp', 'speciesCatalogArtifact.v99.json'))).toThrow(/cannot target a reviewed/i);
    });
    (0, vitest_1.it)('allows explicitly named candidate files', () => {
        (0, vitest_1.expect)(() => (0, generateSpeciesCatalogArtifact_1.assertCandidateOutputPath)(path_1.default.join('/tmp', 'speciesCatalogCandidate.v3.json'))).not.toThrow();
    });
});
