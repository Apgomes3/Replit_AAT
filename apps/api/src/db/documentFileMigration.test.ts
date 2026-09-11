// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrateLegacyDocumentFiles } from './documentFileMigration';

const tempDirs: string[] = [];

function tempUploadDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'document-migration-'));
  tempDirs.push(root);
  const publicUploadsDir = path.join(root, 'uploads');
  const privateUploadsDir = path.join(root, 'private');
  fs.mkdirSync(publicUploadsDir);
  fs.mkdirSync(privateUploadsDir);
  return { publicUploadsDir, privateUploadsDir };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('legacy document file migration', () => {
  it('reconciles a database row when the file is already at its private destination', async () => {
    const paths = tempUploadDirs();
    fs.writeFileSync(path.join(paths.privateUploadsDir, 'evidence.pdf'), 'evidence');
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'revision-1', file_path: '/uploads/evidence.pdf' }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(migrateLegacyDocumentFiles({ query }, paths)).resolves.toBe(1);
    expect(query).toHaveBeenLastCalledWith(
      'UPDATE document_revisions SET file_path=$1 WHERE id=$2',
      ['private-uploads/documents/evidence.pdf', 'revision-1'],
    );
    expect(fs.existsSync(path.join(paths.privateUploadsDir, 'evidence.pdf'))).toBe(true);
  });

  it('moves a public file and updates its database path', async () => {
    const paths = tempUploadDirs();
    fs.writeFileSync(path.join(paths.publicUploadsDir, 'evidence.pdf'), 'evidence');
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'revision-1', file_path: '/uploads/evidence.pdf' }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(migrateLegacyDocumentFiles({ query }, paths)).resolves.toBe(1);
    expect(fs.existsSync(path.join(paths.publicUploadsDir, 'evidence.pdf'))).toBe(false);
    expect(fs.readFileSync(path.join(paths.privateUploadsDir, 'evidence.pdf'), 'utf8')).toBe('evidence');
  });
});