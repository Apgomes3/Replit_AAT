"use strict";
// @vitest-environment node
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const vitest_1 = require("vitest");
(0, vitest_1.describe)('Biological Media run database protections', () => {
    const migration = node_fs_1.default.readFileSync(node_path_1.default.join(process.cwd(), 'apps/api/src/db/migrate.ts'), 'utf8');
    (0, vitest_1.it)('stores calculation and profile evidence as immutable JSON snapshots', () => {
        (0, vitest_1.expect)(migration).toContain('CREATE TABLE IF NOT EXISTS lss_biological_media_runs');
        (0, vitest_1.expect)(migration).toContain('normalized_input_snapshot JSONB NOT NULL');
        (0, vitest_1.expect)(migration).toContain('linked_volume_context_snapshot JSONB NOT NULL');
        (0, vitest_1.expect)(migration).toContain('media_profile_snapshot JSONB NOT NULL');
        (0, vitest_1.expect)(migration).toContain('tan_profile_snapshot JSONB NOT NULL');
        (0, vitest_1.expect)(migration).toContain('result_snapshot JSONB NOT NULL');
        (0, vitest_1.expect)(migration).toContain('overrides_snapshot JSONB NOT NULL');
    });
    (0, vitest_1.it)('rejects evidence mutation, approved-run updates, deletes, and audit rewrites', () => {
        (0, vitest_1.expect)(migration).toContain('CREATE TRIGGER guard_biological_media_runs');
        (0, vitest_1.expect)(migration).toContain("IF TG_OP = 'DELETE'");
        (0, vitest_1.expect)(migration).toContain("IF OLD.status = 'Approved'");
        (0, vitest_1.expect)(migration).toContain('Biological Media calculation run evidence is immutable');
        (0, vitest_1.expect)(migration).toContain('CREATE TRIGGER guard_biological_media_run_audit');
        (0, vitest_1.expect)(migration).toContain('Biological Media run audit records are append-only');
    });
});
