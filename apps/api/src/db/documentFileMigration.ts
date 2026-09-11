import fs from 'node:fs';
import path from 'node:path';

type QueryClient = {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
};

type MigrationPaths = {
  publicUploadsDir?: string;
  privateUploadsDir?: string;
};

export async function migrateLegacyDocumentFiles(client: QueryClient, paths: MigrationPaths = {}) {
  const publicUploadsDir = paths.publicUploadsDir || path.join(__dirname, '../../uploads');
  const privateUploadsDir = paths.privateUploadsDir || path.join(__dirname, '../../private-uploads/documents');
  fs.mkdirSync(privateUploadsDir, { recursive: true });
  const revisions = await client.query(
    `SELECT id, file_path
     FROM document_revisions
     WHERE file_path LIKE '/uploads/%'`,
  );

  let reconciled = 0;
  for (const revision of revisions.rows) {
    const fileName = path.basename(revision.file_path);
    const source = path.join(publicUploadsDir, fileName);
    const destination = path.join(privateUploadsDir, fileName);
    let movedSource = false;

    if (fs.existsSync(source) && !fs.existsSync(destination)) {
      try {
        fs.renameSync(source, destination);
      } catch (error: any) {
        if (error?.code !== 'EXDEV') throw error;
        fs.copyFileSync(source, destination);
        fs.unlinkSync(source);
      }
      movedSource = true;
    } else if (fs.existsSync(source) && fs.existsSync(destination)) {
      fs.unlinkSync(source);
    } else if (!fs.existsSync(destination)) {
      continue;
    }

    try {
      await client.query(
        'UPDATE document_revisions SET file_path=$1 WHERE id=$2',
        [`private-uploads/documents/${fileName}`, revision.id],
      );
      reconciled += 1;
    } catch (error) {
      if (movedSource && fs.existsSync(destination) && !fs.existsSync(source)) {
        try {
          fs.renameSync(destination, source);
        } catch {
          // Keep the original database error; a later run can reconcile the private copy.
        }
      }
      throw error;
    }
  }
  return reconciled;
}