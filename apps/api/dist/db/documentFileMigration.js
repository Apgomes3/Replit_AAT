"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateLegacyDocumentFiles = migrateLegacyDocumentFiles;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
async function migrateLegacyDocumentFiles(client, paths = {}) {
    const publicUploadsDir = paths.publicUploadsDir || node_path_1.default.join(__dirname, '../../uploads');
    const privateUploadsDir = paths.privateUploadsDir || node_path_1.default.join(__dirname, '../../private-uploads/documents');
    node_fs_1.default.mkdirSync(privateUploadsDir, { recursive: true });
    const revisions = await client.query(`SELECT id, file_path
     FROM document_revisions
     WHERE file_path LIKE '/uploads/%'`);
    let reconciled = 0;
    for (const revision of revisions.rows) {
        const fileName = node_path_1.default.basename(revision.file_path);
        const source = node_path_1.default.join(publicUploadsDir, fileName);
        const destination = node_path_1.default.join(privateUploadsDir, fileName);
        let movedSource = false;
        if (node_fs_1.default.existsSync(source) && !node_fs_1.default.existsSync(destination)) {
            try {
                node_fs_1.default.renameSync(source, destination);
            }
            catch (error) {
                if (error?.code !== 'EXDEV')
                    throw error;
                node_fs_1.default.copyFileSync(source, destination);
                node_fs_1.default.unlinkSync(source);
            }
            movedSource = true;
        }
        else if (node_fs_1.default.existsSync(source) && node_fs_1.default.existsSync(destination)) {
            node_fs_1.default.unlinkSync(source);
        }
        else if (!node_fs_1.default.existsSync(destination)) {
            continue;
        }
        try {
            await client.query('UPDATE document_revisions SET file_path=$1 WHERE id=$2', [`private-uploads/documents/${fileName}`, revision.id]);
            reconciled += 1;
        }
        catch (error) {
            if (movedSource && node_fs_1.default.existsSync(destination) && !node_fs_1.default.existsSync(source)) {
                try {
                    node_fs_1.default.renameSync(destination, source);
                }
                catch {
                    // Keep the original database error; a later run can reconcile the private copy.
                }
            }
            throw error;
        }
    }
    return reconciled;
}
