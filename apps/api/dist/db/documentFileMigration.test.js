"use strict";
// @vitest-environment node
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const vitest_1 = require("vitest");
const documentFileMigration_1 = require("./documentFileMigration");
const tempDirs = [];
function tempUploadDirs() {
    const root = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'document-migration-'));
    tempDirs.push(root);
    const publicUploadsDir = node_path_1.default.join(root, 'uploads');
    const privateUploadsDir = node_path_1.default.join(root, 'private');
    node_fs_1.default.mkdirSync(publicUploadsDir);
    node_fs_1.default.mkdirSync(privateUploadsDir);
    return { publicUploadsDir, privateUploadsDir };
}
(0, vitest_1.afterEach)(() => {
    for (const dir of tempDirs.splice(0))
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
});
(0, vitest_1.describe)('legacy document file migration', () => {
    (0, vitest_1.it)('reconciles a database row when the file is already at its private destination', async () => {
        const paths = tempUploadDirs();
        node_fs_1.default.writeFileSync(node_path_1.default.join(paths.privateUploadsDir, 'evidence.pdf'), 'evidence');
        const query = vitest_1.vi.fn()
            .mockResolvedValueOnce({ rows: [{ id: 'revision-1', file_path: '/uploads/evidence.pdf' }] })
            .mockResolvedValueOnce({ rows: [] });
        await (0, vitest_1.expect)((0, documentFileMigration_1.migrateLegacyDocumentFiles)({ query }, paths)).resolves.toBe(1);
        (0, vitest_1.expect)(query).toHaveBeenLastCalledWith('UPDATE document_revisions SET file_path=$1 WHERE id=$2', ['private-uploads/documents/evidence.pdf', 'revision-1']);
        (0, vitest_1.expect)(node_fs_1.default.existsSync(node_path_1.default.join(paths.privateUploadsDir, 'evidence.pdf'))).toBe(true);
    });
    (0, vitest_1.it)('moves a public file and updates its database path', async () => {
        const paths = tempUploadDirs();
        node_fs_1.default.writeFileSync(node_path_1.default.join(paths.publicUploadsDir, 'evidence.pdf'), 'evidence');
        const query = vitest_1.vi.fn()
            .mockResolvedValueOnce({ rows: [{ id: 'revision-1', file_path: '/uploads/evidence.pdf' }] })
            .mockResolvedValueOnce({ rows: [] });
        await (0, vitest_1.expect)((0, documentFileMigration_1.migrateLegacyDocumentFiles)({ query }, paths)).resolves.toBe(1);
        (0, vitest_1.expect)(node_fs_1.default.existsSync(node_path_1.default.join(paths.publicUploadsDir, 'evidence.pdf'))).toBe(false);
        (0, vitest_1.expect)(node_fs_1.default.readFileSync(node_path_1.default.join(paths.privateUploadsDir, 'evidence.pdf'), 'utf8')).toBe('evidence');
    });
});
