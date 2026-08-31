"use strict";
// @vitest-environment node
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const vitest_1 = require("vitest");
(0, vitest_1.describe)('Biological Media evidence database boundary', () => {
    const migration = node_fs_1.default.readFileSync(node_path_1.default.join(process.cwd(), 'apps/api/src/db/migrate.ts'), 'utf8');
    (0, vitest_1.it)('keeps evidence records and observations separate from selectable profiles', () => {
        (0, vitest_1.expect)(migration).toContain('CREATE TABLE IF NOT EXISTS lss_biological_media_evidence_records');
        (0, vitest_1.expect)(migration).toContain('CREATE TABLE IF NOT EXISTS lss_biological_media_evidence_observations');
        (0, vitest_1.expect)(migration).toContain('CREATE TABLE IF NOT EXISTS lss_biological_media_evidence_links');
        (0, vitest_1.expect)(migration).toContain("review_status VARCHAR(40) NOT NULL DEFAULT 'Review Needed'");
        (0, vitest_1.expect)(migration).toContain('is_approved BOOLEAN NOT NULL DEFAULT false');
        (0, vitest_1.expect)(migration).toContain('promotable BOOLEAN NOT NULL DEFAULT false');
        (0, vitest_1.expect)(migration).not.toContain('media_profile_revision_id UUID REFERENCES lss_biological_media_evidence');
    });
});
