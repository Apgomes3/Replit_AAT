"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const vitest_1 = require("vitest");
(0, vitest_1.describe)('pump selection migration', () => {
    const migration = node_fs_1.default.readFileSync(node_path_1.default.join(process.cwd(), 'apps/api/src/db/migrate.ts'), 'utf8');
    (0, vitest_1.it)('removes legacy two-column uniqueness by discovered constraint or index name', () => {
        (0, vitest_1.expect)(migration).toContain("c.conrelid='system_pump_selections'::regclass");
        (0, vitest_1.expect)(migration).toContain("ARRAY['circuit_key','system_id']::name[]");
        (0, vitest_1.expect)(migration).toContain("DROP INDEX IF EXISTS %I");
    });
    (0, vitest_1.it)('rebuilds a repeatable role-aware uniqueness constraint', () => {
        (0, vitest_1.expect)(migration).toContain('DROP CONSTRAINT IF EXISTS uq_system_pump_selections_circuit_role');
        (0, vitest_1.expect)(migration).toContain('ADD CONSTRAINT uq_system_pump_selections_circuit_role UNIQUE (system_id, circuit_key, pump_role)');
    });
    (0, vitest_1.it)('preserves historical side-stream pump intent during upgrade', () => {
        (0, vitest_1.expect)(migration).toContain('SET has_dedicated_pump=true');
        (0, vitest_1.expect)(migration).toContain('ALTER COLUMN has_dedicated_pump SET NOT NULL');
    });
    (0, vitest_1.it)('adds a bounded pump quantity with a safe default', () => {
        (0, vitest_1.expect)(migration).toContain('ADD COLUMN IF NOT EXISTS pump_quantity INTEGER NOT NULL DEFAULT 1');
        (0, vitest_1.expect)(migration).toContain('CHECK (pump_quantity > 0 AND pump_quantity <= 99)');
    });
    (0, vitest_1.it)('creates and seeds the governed pump duty relationship table', () => {
        (0, vitest_1.expect)(migration).toContain('CREATE TABLE IF NOT EXISTS pump_duty_types');
        for (const tag of ['FFSP', 'FFVP', 'SFSP', 'CIRCP', 'VACP']) {
            (0, vitest_1.expect)(migration).toContain(`('${tag}'`);
        }
        (0, vitest_1.expect)(migration).toContain('pump_duty_snapshot JSONB');
    });
});
