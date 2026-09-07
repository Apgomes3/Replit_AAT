import { Router, Response } from 'express';
import { query } from '../db';
import pool from '../db';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { logAudit } from '../db/audit';
import { MODULE_ACCESS_KEYS, MODULE_ACCESS_LABELS, ModuleAccessKey } from '../lib/moduleAccess';
import { sendPasswordResetEmail, sendInviteEmail, isSmtpConfigured } from '../lib/email';
import multer from 'multer';
import csv from 'csv-parser';
import { Readable } from 'stream';

const router = Router();
const uploadUserCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

const MAX_BULK_INVITES = 500;

type UserCsvRow = Record<string, string>;

function parseUserCsv(buffer: Buffer): Promise<{ headers: string[]; rows: UserCsvRow[] }> {
  return new Promise((resolve, reject) => {
    const rows: UserCsvRow[] = [];
    let headers: string[] = [];
    const parser = csv({
      mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, '').toLowerCase(),
    });

    parser
      .on('headers', (parsedHeaders: string[]) => { headers = parsedHeaders; })
      .on('data', (row: UserCsvRow) => rows.push(row))
      .on('error', reject)
      .on('end', () => resolve({ headers, rows }));

    Readable.from([buffer]).pipe(parser);
  });
}

function csvValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validEmail(email: string): boolean {
  return email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.get('/email-status', authenticate, requireRole('admin'), (_req: AuthRequest, res: Response) => {
  res.json({ smtp_configured: isSmtpConfigured() });
});

router.get('/users', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const page_size = Math.min(1000, Math.max(1, parseInt(req.query.page_size as string) || 25));
  const offset = (page - 1) * page_size;
  const q = (req.query.q as string || '').trim();
  const role = (req.query.role as string || '').trim();
  const sort = (req.query.sort as string || 'created_asc');

  const conditions: string[] = [];
  const params: any[] = [];

  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(email ILIKE $${params.length} OR first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR (first_name || ' ' || last_name) ILIKE $${params.length})`);
  }
  if (role) {
    params.push(role);
    conditions.push(`role = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const orderMap: Record<string, string> = {
    name_asc: 'LOWER(first_name || last_name) ASC, email ASC',
    name_desc: 'LOWER(first_name || last_name) DESC, email DESC',
    email_asc: 'email ASC',
    email_desc: 'email DESC',
    role_asc: 'role ASC',
    role_desc: 'role DESC',
    status_asc: 'is_active ASC',
    status_desc: 'is_active DESC',
    created_asc: 'created_at ASC',
    created_desc: 'created_at DESC',
    last_login_asc: 'last_login_at ASC NULLS FIRST',
    last_login_desc: 'last_login_at DESC NULLS LAST',
  };
  const orderBy = orderMap[sort] || 'created_at ASC';

  const countParams = [...params];
  const dataParams = [...params, page_size, offset];

  const [countResult, dataResult] = await Promise.all([
    query(`SELECT COUNT(*) FROM users ${where}`, countParams),
    query(
      `SELECT id, email, first_name, last_name, role, is_active, can_see_all_pos, created_at, last_login_at
       FROM users ${where} ORDER BY ${orderBy} LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    ),
  ]);

  const total = parseInt(countResult.rows[0].count);
  res.json({
    items: dataResult.rows,
    pagination: { page, page_size, total, pages: Math.ceil(total / page_size) },
  });
});

router.patch('/users/:id/po-visibility', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { can_see_all_pos } = req.body;
  if (typeof can_see_all_pos !== 'boolean') {
    return res.status(400).json({ error: { code: 'INVALID', message: 'can_see_all_pos must be boolean' } });
  }
  const result = await query(
    'UPDATE users SET can_see_all_pos=$1, updated_at=NOW() WHERE id=$2 RETURNING id, email, can_see_all_pos',
    [can_see_all_pos, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  res.json(result.rows[0]);
});

router.post('/users', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { email, password, first_name, last_name, role } = req.body;
  if (!email || !password) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Email and password required' } });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await query('INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, first_name, last_name, role, created_at',
      [email, hash, first_name, last_name, role || 'viewer']);
    await logAudit(req.user!.id, 'user', result.rows[0].id, 'CREATE', {
      summary: `User account created for ${email}`,
      target_email: email,
      role: role || 'viewer',
    });
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'A user with that email already exists' } });
    throw err;
  }
});

router.post('/users/invite', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { email, first_name, last_name, role } = req.body;
  if (!email) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Email is required' } });

  // Create user with a random unusable password
  const randomPassword = crypto.randomBytes(32).toString('hex');
  const hash = await bcrypt.hash(randomPassword, 10);

  let userId: string;
  let userEmail: string;
  try {
    const result = await query(
      'INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, email',
      [email.toLowerCase().trim(), hash, first_name || null, last_name || null, role || 'viewer']
    );
    userId = result.rows[0].id;
    userEmail = result.rows[0].email;
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'A user with that email already exists' } });
    throw err;
  }

  // Generate a 24-hour setup token (reuses password_reset_tokens table)
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await query(
    'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );

  const appUrl = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || 'localhost:5173'}`;
  const setupUrl = `${appUrl}/reset-password?token=${token}`;

  try {
    await sendInviteEmail(userEmail, first_name || '', setupUrl);
  } catch (emailErr: any) {
    // Email failed — clean up the created user and token so the admin gets an honest error
    console.error('[INVITE] Failed to send invite email:', emailErr?.message);
    await query('DELETE FROM password_reset_tokens WHERE token=$1', [token]);
    await query('DELETE FROM users WHERE id=$1', [userId]);
    return res.status(500).json({
      error: {
        code: 'EMAIL_FAILED',
        message: 'User was not created because the invite email could not be sent. Check your SMTP configuration.',
      },
    });
  }

  await logAudit(req.user!.id, 'user', userId, 'INVITE', {
    summary: `Invitation sent to ${userEmail}`,
    target_email: userEmail,
    role: role || 'viewer',
  });
  res.status(201).json({ ok: true, user_id: userId, email: userEmail });
});

router.post('/users/import', authenticate, requireRole('admin'), uploadUserCsv.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'CSV file required' } });
  }

  let parsed: { headers: string[]; rows: UserCsvRow[] };
  try {
    parsed = await parseUserCsv(req.file.buffer);
  } catch {
    return res.status(400).json({ error: { code: 'INVALID_CSV', message: 'Could not parse the CSV file' } });
  }

  if (!parsed.headers.includes('email')) {
    return res.status(400).json({ error: { code: 'INVALID_CSV', message: 'CSV must include an email column' } });
  }
  if (parsed.rows.length > MAX_BULK_INVITES) {
    return res.status(400).json({
      error: { code: 'INVALID_CSV', message: `CSV cannot contain more than ${MAX_BULK_INVITES} rows` },
    });
  }
  if (!parsed.rows.length) {
    return res.status(400).json({ error: { code: 'INVALID_CSV', message: 'CSV does not contain any data rows' } });
  }

  const rolesResult = await query('SELECT name FROM roles');
  const validRoles = new Set(rolesResult.rows.map(row => String(row.name).toLowerCase()));
  if (!validRoles.has('viewer')) validRoles.add('viewer');

  const result = {
    total: parsed.rows.length,
    invited: 0,
    skipped: 0,
    errors: [] as Array<{ row: number; email?: string; message: string }>,
  };
  const emailsInFile = new Set<string>();

  for (const [index, row] of parsed.rows.entries()) {
    const rowNumber = index + 2;
    const email = csvValue(row.email).toLowerCase();
    const firstName = csvValue(row.first_name);
    const lastName = csvValue(row.last_name);
    const role = csvValue(row.role).toLowerCase() || 'viewer';

    let validationMessage: string | undefined;
    if (!email) validationMessage = 'Email is required';
    else if (!validEmail(email)) validationMessage = 'Email address is invalid';
    else if (firstName.length > 100) validationMessage = 'First name must be 100 characters or fewer';
    else if (lastName.length > 100) validationMessage = 'Last name must be 100 characters or fewer';
    else if (!validRoles.has(role)) validationMessage = `Role "${role}" does not exist`;

    if (validationMessage) {
      result.errors.push({ row: rowNumber, email: email || undefined, message: validationMessage });
      continue;
    }

    if (emailsInFile.has(email)) {
      result.skipped++;
      continue;
    }
    emailsInFile.add(email);

    const existing = await query('SELECT id FROM users WHERE LOWER(email)=$1 LIMIT 1', [email]);
    if (existing.rows[0]) {
      result.skipped++;
      continue;
    }

    let userId: string | undefined;
    let token: string | undefined;
    try {
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const hash = await bcrypt.hash(randomPassword, 10);
      const inserted = await query(
        'INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, email',
        [email, hash, firstName || null, lastName || null, role]
      );
      userId = inserted.rows[0].id;

      token = crypto.randomBytes(48).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await query(
        'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [userId, token, expiresAt]
      );

      const appUrl = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || 'localhost:5173'}`;
      await sendInviteEmail(email, firstName, `${appUrl}/reset-password?token=${token}`);
    } catch (err: any) {
      if (err?.code === '23505' && !userId) {
        result.skipped++;
        continue;
      }

      if (token) await query('DELETE FROM password_reset_tokens WHERE token=$1', [token]);
      if (userId) await query('DELETE FROM users WHERE id=$1', [userId]);
      console.error(`[BULK INVITE] Failed for row ${rowNumber}:`, err?.message);
      result.errors.push({
        row: rowNumber,
        email,
        message: 'Invite could not be sent',
      });
      continue;
    }

    await logAudit(req.user!.id, 'user', userId!, 'INVITE', {
      summary: `Invitation sent to ${email}`,
      target_email: email,
      role,
    });
    result.invited++;
  }

  res.json(result);
});

router.put('/users/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { first_name, last_name, role, is_active } = req.body;
  if (req.user!.id === req.params.id && is_active !== true) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot block your own account' } });
  }
  const existing = await query('SELECT is_active, role FROM users WHERE id=$1', [req.params.id]);
  const result = await query('UPDATE users SET first_name=$1, last_name=$2, role=$3, is_active=$4, updated_at=NOW() WHERE id=$5 RETURNING id, email, first_name, last_name, role, is_active',
    [first_name, last_name, role, is_active, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  const updated = result.rows[0];
  let action = 'UPDATE';
  if (existing.rows[0] && is_active !== undefined) {
    if (!existing.rows[0].is_active && is_active === true) action = 'UNBLOCK';
    else if (existing.rows[0].is_active && is_active === false) action = 'BLOCK';
  }
  const summary = action === 'BLOCK'
    ? 'User account blocked'
    : action === 'UNBLOCK'
      ? 'User account unblocked'
      : existing.rows[0]?.role !== updated.role
        ? `Role changed from ${existing.rows[0]?.role || 'unknown'} → ${updated.role}`
        : 'User details updated';
  await logAudit(req.user!.id, 'user', updated.id, action, {
    summary,
    target_email: updated.email,
    first_name: updated.first_name,
    last_name: updated.last_name,
    role: updated.role,
    is_active: updated.is_active,
  });
  res.json(updated);
});

router.patch('/users/:id/password', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Password must be at least 8 characters' } });
  }
  if (req.user!.id === req.params.id) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Use the profile settings to change your own password' } });
  }
  const existing = await query('SELECT id, email FROM users WHERE id=$1', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  const hash = await bcrypt.hash(password, 10);
  await query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.params.id]);
  await query('DELETE FROM refresh_tokens WHERE user_id=$1', [req.params.id]);
  await logAudit(req.user!.id, 'user', String(req.params.id), 'RESET_PASSWORD', {
    summary: 'User password reset',
    target_email: existing.rows[0].email,
  });
  res.status(204).end();
});

router.post('/users/:id/send-reset-link', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const existing = await query('SELECT id, email FROM users WHERE id=$1 AND is_active=true', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });

  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await query(
    'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [existing.rows[0].id, token, expiresAt]
  );

  const appUrl = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || 'localhost:5173'}`;
  const resetUrl = `${appUrl}/reset-password?token=${token}`;

  try {
    await sendPasswordResetEmail(existing.rows[0].email, resetUrl);
  } catch (emailErr: any) {
    // Email failed — remove the unused token so a failed attempt cannot leave
    // an unexpected reset link active. The explicit response lets the admin
    // fix SMTP and retry from the user actions menu.
    console.error('[RESET LINK] Failed to send password reset email:', emailErr?.message);
    await query('DELETE FROM password_reset_tokens WHERE token=$1', [token]);
    return res.status(500).json({
      error: {
        code: 'EMAIL_FAILED',
        message: 'Password reset link was not sent. Check your SMTP configuration and try again.',
      },
    });
  }

  await logAudit(req.user!.id, 'user', existing.rows[0].id, 'SEND_RESET_LINK', {
    summary: `Password reset link sent to ${existing.rows[0].email}`,
    target_email: existing.rows[0].email,
  });
  res.json({ ok: true });
});

router.delete('/users/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const userId = req.params.id;
  if (req.user!.id === userId) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot delete your own account' } });
  }
  const existing = await query('SELECT id, email FROM users WHERE id=$1', [userId]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Null out all nullable FK references
    await client.query('UPDATE projects SET created_by=NULL WHERE created_by=$1', [userId]);
    await client.query('UPDATE components SET created_by=NULL WHERE created_by=$1', [userId]);
    await client.query('UPDATE documents SET created_by=NULL WHERE created_by=$1', [userId]);
    await client.query('UPDATE document_project_links SET linked_by=NULL WHERE linked_by=$1', [userId]);
    await client.query('UPDATE document_revisions SET issued_by=NULL WHERE issued_by=$1', [userId]);
    await client.query('UPDATE document_revisions SET created_by=NULL WHERE created_by=$1', [userId]);
    await client.query('UPDATE approvals SET approver_id=NULL WHERE approver_id=$1', [userId]);
    await client.query('UPDATE release_packages SET created_by=NULL WHERE created_by=$1', [userId]);
    await client.query('UPDATE lifecycle_transitions SET actor_id=NULL WHERE actor_id=$1', [userId]);
    await client.query('UPDATE change_requests SET requested_by=NULL WHERE requested_by=$1', [userId]);
    await client.query('UPDATE audit_logs SET actor_id=NULL WHERE actor_id=$1', [userId]);
    await client.query('UPDATE bom_releases SET created_by=NULL WHERE created_by=$1', [userId]);
    await client.query('UPDATE purchase_orders SET created_by=NULL WHERE created_by=$1', [userId]);
    await client.query('UPDATE purchase_orders SET approved_by=NULL WHERE approved_by=$1', [userId]);
    await client.query('UPDATE po_lifecycle_history SET changed_by=NULL WHERE changed_by=$1', [userId]);
    // Delete rows in junction tables
    await client.query('DELETE FROM po_designated_users WHERE user_id=$1', [userId]);
    await client.query('DELETE FROM todos WHERE user_id=$1', [userId]);
    await client.query('DELETE FROM refresh_tokens WHERE user_id=$1', [userId]);
    // Finally delete the user
    await client.query('DELETE FROM users WHERE id=$1', [userId]);
    await client.query('COMMIT');
    await logAudit(req.user!.id, 'user', String(userId), 'DELETE', {
      summary: `User account deleted for ${existing.rows[0].email}`,
      target_user_id: userId,
      target_email: existing.rows[0].email,
    });
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.get('/audit-logs', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  // Allow up to 10 000 rows for CSV export (page_size=10000 sent by the Export button)
  const page_size = Math.min(parseInt(req.query.page_size as string) || 50, 10000);
  const offset = (page - 1) * page_size;

  const conditions: string[] = [];
  const params: any[] = [];

  const entity_type = req.query.entity_type as string;
  const entity_id = req.query.entity_id as string;
  const action = req.query.action as string;
  const actor = req.query.actor as string;
  const from = req.query.from as string;
  const to = req.query.to as string;

  if (entity_type) { params.push(entity_type); conditions.push(`al.entity_type = $${params.length}`); }
  if (entity_id) { params.push(`%${entity_id}%`); conditions.push(`al.entity_id ILIKE $${params.length}`); }
  if (action) { params.push(action); conditions.push(`al.action = $${params.length}`); }
  if (actor) { params.push(`%${actor}%`); conditions.push(`((u.first_name || ' ' || u.last_name) ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
  if (from) { params.push(from); conditions.push(`al.created_at >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`al.created_at <= $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countParams = [...params];
  const dataParams = [...params, page_size, offset];

  const [result, countResult] = await Promise.all([
    query(
      `SELECT al.*, u.first_name || ' ' || u.last_name as actor_name, u.email as actor_email
       FROM audit_logs al LEFT JOIN users u ON al.actor_id=u.id
       ${where}
       ORDER BY al.created_at DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    ),
    query(
      `SELECT COUNT(*) FROM audit_logs al LEFT JOIN users u ON al.actor_id=u.id ${where}`,
      countParams
    ),
  ]);

  const total = parseInt(countResult.rows[0].count);
  res.json({ items: result.rows, pagination: { page, page_size, total, pages: Math.ceil(total / page_size) } });
});

router.get('/stats', authenticate, async (req: AuthRequest, res: Response) => {
  const [projs, products, docs, equip, mats, systems, comps, docByStatus, equipByStatus, recentDocs] = await Promise.all([
    query('SELECT COUNT(*) FROM projects'),
    query('SELECT COUNT(*) FROM product_masters'),
    query('SELECT COUNT(*) FROM documents'),
    query('SELECT COUNT(*) FROM equipment_instances'),
    query('SELECT COUNT(*) FROM materials'),
    query('SELECT COUNT(*) FROM systems'),
    query('SELECT COUNT(*) FROM components'),
    query('SELECT status, COUNT(*) as count FROM documents GROUP BY status ORDER BY status'),
    query('SELECT status, COUNT(*) as count FROM equipment_instances GROUP BY status ORDER BY status'),
    query(`SELECT d.id, d.document_code, d.document_title, d.document_type, d.status, d.created_at,
             u.first_name || ' ' || u.last_name as created_by_name
           FROM documents d LEFT JOIN users u ON d.created_by=u.id
           ORDER BY d.created_at DESC LIMIT 5`),
  ]);
  res.json({
    projects: parseInt(projs.rows[0].count),
    products: parseInt(products.rows[0].count),
    documents: parseInt(docs.rows[0].count),
    equipment: parseInt(equip.rows[0].count),
    materials: parseInt(mats.rows[0].count),
    systems: parseInt(systems.rows[0].count),
    components: parseInt(comps.rows[0].count),
    document_by_status: docByStatus.rows,
    equipment_by_status: equipByStatus.rows,
    recent_documents: recentDocs.rows,
  });
});

// PRODUCT CATEGORIES
router.get('/categories', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM product_categories ORDER BY sort_order, name');
  res.json({ items: result.rows });
});

router.post('/categories', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const { name, code, description, sort_order } = req.body;
  if (!name || !code) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'name and code required' } });
  try {
    const result = await query(
      'INSERT INTO product_categories (name, code, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, code.toUpperCase(), description || null, sort_order || 0]);
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'Category name or code already exists' } });
    throw err;
  }
});

router.put('/categories/:id', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const { name, code, description, sort_order } = req.body;
  const result = await query(
    'UPDATE product_categories SET name=$1, code=$2, description=$3, sort_order=$4, updated_at=NOW() WHERE id=$5 RETURNING *',
    [name, code?.toUpperCase(), description || null, sort_order ?? 0, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Category not found' } });
  res.json(result.rows[0]);
});

router.delete('/categories/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const existing = await query('SELECT is_system FROM product_categories WHERE id=$1', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Category not found' } });
  if (existing.rows[0].is_system) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot delete a built-in category' } });
  await query('DELETE FROM product_categories WHERE id=$1', [req.params.id]);
  res.status(204).end();
});

// ROLES
router.get('/roles', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT r.*,
            COALESCE(
              jsonb_object_agg(rma.module_key, rma.access_level)
                FILTER (WHERE rma.module_key IS NOT NULL),
              '{}'::jsonb
            ) AS module_access
     FROM roles r
     LEFT JOIN role_module_access rma ON rma.role_id=r.id
     GROUP BY r.id
     ORDER BY r.sort_order, r.name`,
  );
  res.json({ items: result.rows });
});

router.post('/roles', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, description, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'name is required' } });
  try {
    const result = await query(
      'INSERT INTO roles (name, description, sort_order) VALUES ($1,$2,$3) RETURNING *',
      [name.trim().toLowerCase(), description || null, sort_order || 0]);
    await query(
      `INSERT INTO role_module_access (role_id, module_key, access_level)
       SELECT $1, module_key, 'manage'
       FROM unnest($2::text[]) AS module_key
       ON CONFLICT (role_id, module_key) DO NOTHING`,
      [result.rows[0].id, MODULE_ACCESS_KEYS],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'Role name already exists' } });
    throw err;
  }
});

router.put('/roles/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { name, description, sort_order } = req.body;
  const existing = await query('SELECT is_system FROM roles WHERE id=$1', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
  if (existing.rows[0].is_system && name !== existing.rows[0].name) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot rename a built-in role' } });
  }
  try {
    const result = await query(
      'UPDATE roles SET name=$1, description=$2, sort_order=$3, updated_at=NOW() WHERE id=$4 RETURNING *',
      [name.trim().toLowerCase(), description || null, sort_order ?? 0, req.params.id]);
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'Role name already exists' } });
    throw err;
  }
});

router.delete('/roles/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const existing = await query('SELECT is_system FROM roles WHERE id=$1', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
  if (existing.rows[0].is_system) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot delete a built-in role' } });
  await query('DELETE FROM roles WHERE id=$1', [req.params.id]);
  res.status(204).end();
});

router.get('/roles/:id/modules', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const role = await query('SELECT id, name FROM roles WHERE id=$1', [req.params.id]);
  if (!role.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
  const result = await query(
    `SELECT module_key, access_level
     FROM role_module_access
     WHERE role_id=$1`,
    [req.params.id],
  );
  const access = new Map(result.rows.map(row => [row.module_key, row.access_level]));
  res.json({
    role: role.rows[0],
    items: MODULE_ACCESS_KEYS.map(key => ({
      key,
      label: MODULE_ACCESS_LABELS[key],
      access_level: access.get(key) || 'manage',
      visible: (access.get(key) || 'manage') !== 'hidden',
    })),
  });
});

router.put('/roles/:id/modules', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const modules = req.body?.modules;
  if (!modules || typeof modules !== 'object' || Array.isArray(modules)) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'modules must be an object of module visibility values' } });
  }
  const role = await query('SELECT id, name FROM roles WHERE id=$1', [req.params.id]);
  if (!role.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
  if (role.rows[0].name === 'admin' && MODULE_ACCESS_KEYS.some(key => modules[key] === false || modules[key] === 'hidden')) {
    return res.status(400).json({ error: { code: 'ADMIN_ACCESS_REQUIRED', message: 'The admin role must retain access to every module.' } });
  }
  for (const key of Object.keys(modules)) {
    if (!MODULE_ACCESS_KEYS.includes(key as ModuleAccessKey)) {
      return res.status(400).json({ error: { code: 'INVALID_MODULE', message: `Unknown module: ${key}` } });
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const key of MODULE_ACCESS_KEYS) {
      const requested = modules[key];
      const level = requested === false || requested === 'hidden' ? 'hidden' : 'manage';
      await client.query(
        `INSERT INTO role_module_access (role_id, module_key, access_level)
         VALUES ($1,$2,$3)
         ON CONFLICT (role_id, module_key)
         DO UPDATE SET access_level=EXCLUDED.access_level, updated_at=NOW()`,
        [req.params.id, key, level],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await logAudit(req.user!.id, 'role', String(req.params.id), 'MODULE_ACCESS_UPDATE', {
    summary: `Module visibility updated for role ${role.rows[0].name}`,
    modules,
  }, req.ip);
  res.json({ ok: true });
});

// PENDING APPROVALS (admin/engineer only)
router.get('/pending-approvals', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const [pendingProducts, pendingDocs] = await Promise.all([
    query(`SELECT id, product_code as code, product_name as name, status, 'Product' as type, updated_at
           FROM product_masters WHERE status IN ('Draft','Internal Review','Pending Approval')
           ORDER BY updated_at DESC LIMIT 10`),
    query(`SELECT id, document_code as code, document_title as name, status, 'Document' as type, updated_at
           FROM documents WHERE status IN ('Draft','Internal Review')
           ORDER BY updated_at DESC LIMIT 10`),
  ]);
  const items = [
    ...pendingProducts.rows,
    ...pendingDocs.rows,
  ].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 15);
  res.json({ items });
});

// TO-DOs (per-user)
router.get('/todos', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM todos WHERE user_id=$1 ORDER BY created_at ASC', [req.user!.id]);
  res.json({ items: result.rows });
});

router.post('/todos', authenticate, async (req: AuthRequest, res: Response) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'text required' } });
  const result = await query('INSERT INTO todos (user_id, text) VALUES ($1,$2) RETURNING *', [req.user!.id, text.trim()]);
  res.status(201).json(result.rows[0]);
});

router.patch('/todos/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { done } = req.body;
  const result = await query('UPDATE todos SET done=$1 WHERE id=$2 AND user_id=$3 RETURNING *', [done, req.params.id, req.user!.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Todo not found' } });
  res.json(result.rows[0]);
});

router.delete('/todos/:id', authenticate, async (req: AuthRequest, res: Response) => {
  await query('DELETE FROM todos WHERE id=$1 AND user_id=$2', [req.params.id, req.user!.id]);
  res.status(204).end();
});

// TANK FAMILIES (admin management)
router.get('/tank-families', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT tf.*, COUNT(pm.id)::int as product_count
     FROM tank_families tf
     LEFT JOIN product_masters pm ON pm.tank_family_id = tf.id
     GROUP BY tf.id ORDER BY tf.sort_order, tf.name`
  );
  res.json({ items: result.rows });
});

router.post('/tank-families', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const { code, name, description, sort_order } = req.body;
  if (!code || !name) return res.status(400).json({ error: { code: 'INVALID', message: 'code and name are required' } });
  try {
    const result = await query(
      'INSERT INTO tank_families (code, name, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
      [code.toUpperCase(), name, description || null, sort_order ?? 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') return res.status(400).json({ error: { code: 'DUPLICATE', message: 'A tank family with that code already exists' } });
    throw e;
  }
});

router.put('/tank-families/:id', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const { name, description, sort_order } = req.body;
  const result = await query(
    'UPDATE tank_families SET name=$1, description=$2, sort_order=$3, updated_at=NOW() WHERE id::text=$4 RETURNING *',
    [name, description || null, sort_order ?? 0, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank family not found' } });
  res.json(result.rows[0]);
});

router.delete('/tank-families/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const existing = await query('SELECT id FROM tank_families WHERE id::text=$1', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank family not found' } });
  await query('UPDATE product_masters SET tank_family_id=NULL WHERE tank_family_id::text=$1', [req.params.id]);
  await query('DELETE FROM tank_families WHERE id::text=$1', [req.params.id]);
  res.status(204).end();
});

router.get('/system-types', authenticate, async (_req: AuthRequest, res: Response) => {
  const result = await query(
    'SELECT * FROM system_types ORDER BY sort_order, name'
  );
  res.json({ items: result.rows });
});

// ── PO STAGE ROLES ──────────────────────────────────────────────────────────

router.get('/po-stage-roles', authenticate, async (_req: AuthRequest, res: Response) => {
  const r = await query(
    `SELECT psa.id, psa.stage, psa.user_id, psa.created_at,
            u.first_name, u.last_name, u.email, u.role
     FROM po_stage_assignees psa JOIN users u ON u.id = psa.user_id
     ORDER BY psa.stage, u.first_name`,
    []
  );
  const map: Record<string, any[]> = {};
  for (const row of r.rows) {
    if (!map[row.stage]) map[row.stage] = [];
    map[row.stage].push(row);
  }
  res.json(map);
});

router.post('/po-stage-roles', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { stage, user_id } = req.body;
  const VALID_STAGES = ['purchase_order', 'po_review', 'engineering_review'];
  if (!stage || !VALID_STAGES.includes(stage)) {
    return res.status(400).json({ error: { code: 'INVALID', message: 'Invalid stage' } });
  }
  if (!user_id) return res.status(400).json({ error: { code: 'INVALID', message: 'user_id required' } });
  try {
    const r = await query(
      `INSERT INTO po_stage_assignees (stage, user_id, created_by) VALUES ($1,$2,$3)
       RETURNING id, stage, user_id, created_at`,
      [stage, user_id, req.user!.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') return res.status(400).json({ error: { code: 'DUPLICATE', message: 'User already assigned to this stage' } });
    throw e;
  }
});

router.delete('/po-stage-roles/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const existing = await query('SELECT id FROM po_stage_assignees WHERE id=$1', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Assignee not found' } });
  await query('DELETE FROM po_stage_assignees WHERE id=$1', [req.params.id]);
  res.status(204).end();
});

// ── SYSTEM TYPES ─────────────────────────────────────────────────────────────

router.post('/system-types', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const { name, description, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { code: 'INVALID', message: 'name is required' } });
  try {
    const result = await query(
      'INSERT INTO system_types (name, description, sort_order) VALUES ($1,$2,$3) RETURNING *',
      [name.trim(), description?.trim() || null, sort_order ?? 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') return res.status(400).json({ error: { code: 'DUPLICATE', message: 'A system type with that name already exists' } });
    throw e;
  }
});

router.put('/system-types/:id', authenticate, requireRole('admin', 'engineer'), async (req: AuthRequest, res: Response) => {
  const { name, description, sort_order, is_active } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { code: 'INVALID', message: 'name is required' } });
  try {
    const result = await query(
      'UPDATE system_types SET name=$1, description=$2, sort_order=$3, is_active=$4, updated_at=NOW() WHERE id::text=$5 RETURNING *',
      [name.trim(), description?.trim() || null, sort_order ?? 0, is_active ?? true, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System type not found' } });
    res.json(result.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') return res.status(400).json({ error: { code: 'DUPLICATE', message: 'A system type with that name already exists' } });
    throw e;
  }
});

router.delete('/system-types/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const existing = await query('SELECT id FROM system_types WHERE id::text=$1', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System type not found' } });
  await query('DELETE FROM system_types WHERE id::text=$1', [req.params.id]);
  res.status(204).end();
});

// ── PUMP DUTY TYPES ──────────────────────────────────────────────────────────
router.get('/pump-duty-types', authenticate, async (_req: AuthRequest, res: Response) => {
  const result = await query('SELECT * FROM pump_duty_types ORDER BY sort_order, tag');
  res.json({ items: result.rows });
});

const pumpDutyInput = (body: any) => ({
  tag: String(body?.tag || '').trim().toUpperCase(),
  pump_name: String(body?.pump_name || '').trim(),
  flow_route_role: String(body?.flow_route_role || '').trim() || null,
  sort_order: Number.isInteger(Number(body?.sort_order)) ? Number(body.sort_order) : 0,
  is_active: body?.is_active !== false,
});

router.post('/pump-duty-types', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const input = pumpDutyInput(req.body);
  if (!/^[A-Z0-9]+$/.test(input.tag) || !input.pump_name) {
    return res.status(400).json({ error: { code: 'INVALID', message: 'Tag and pump name are required; tags may only contain letters and numbers.' } });
  }
  try {
    const result = await query(
      `INSERT INTO pump_duty_types (tag,pump_name,flow_route_role,sort_order,is_active)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.tag, input.pump_name, input.flow_route_role, input.sort_order, input.is_active],
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'That pump tag or Flow Route relationship is already assigned.' } });
    throw error;
  }
});

router.put('/pump-duty-types/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const input = pumpDutyInput(req.body);
  if (!/^[A-Z0-9]+$/.test(input.tag) || !input.pump_name) {
    return res.status(400).json({ error: { code: 'INVALID', message: 'Tag and pump name are required; tags may only contain letters and numbers.' } });
  }
  try {
    const result = await query(
      `UPDATE pump_duty_types SET tag=$1,pump_name=$2,flow_route_role=$3,sort_order=$4,is_active=$5,updated_at=NOW()
       WHERE id::text=$6 RETURNING *`,
      [input.tag, input.pump_name, input.flow_route_role, input.sort_order, input.is_active, req.params.id],
    );
    if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pump duty type not found.' } });
    res.json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'That pump tag or Flow Route relationship is already assigned.' } });
    throw error;
  }
});

router.delete('/pump-duty-types/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const used = await query('SELECT 1 FROM system_pump_selections WHERE pump_duty_type_id::text=$1 LIMIT 1', [req.params.id]);
  if (used.rows[0]) {
    return res.status(409).json({ error: { code: 'IN_USE', message: 'This pump duty is referenced by a pump selection. Deactivate it instead.' } });
  }
  const result = await query('DELETE FROM pump_duty_types WHERE id::text=$1 RETURNING id', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pump duty type not found.' } });
  res.status(204).end();
});

// ── FIELD INSTRUMENT CATALOG ─────────────────────────────────────────────────
const fieldInstrumentInput = (body: any) => ({
  name: String(body?.name || '').trim(),
  description: String(body?.description || '').trim() || null,
  tag_code: String(body?.tag_code || '').trim(),
  numbering_rule: String(body?.numbering_rule || 'system-type-sequence').trim(),
  signal_type: String(body?.signal_type || '').trim().toLowerCase(),
  signal_direction: String(body?.signal_direction || '').trim().toLowerCase(),
  requirement_rule: String(body?.requirement_rule || 'optional').trim().toLowerCase(),
  default_control_logic: String(body?.default_control_logic || '').trim() || null,
  default_range_min: body?.default_range_min === '' || body?.default_range_min == null ? null : Number(body.default_range_min),
  default_range_max: body?.default_range_max === '' || body?.default_range_max == null ? null : Number(body.default_range_max),
  default_unit: String(body?.default_unit || '').trim() || null,
  allow_range_override: body?.allow_range_override !== false,
  default_calibration_required: body?.default_calibration_required === true,
  default_calibration_interval_days: body?.default_calibration_interval_days === '' || body?.default_calibration_interval_days == null ? null : Number(body.default_calibration_interval_days),
  default_calibration_procedure: String(body?.default_calibration_procedure || '').trim() || null,
  default_datasheet_reference: String(body?.default_datasheet_reference || '').trim() || null,
  allow_calibration_override: body?.allow_calibration_override !== false,
  default_product_master_id: body?.default_product_master_id || null,
  sort_order: Number.isInteger(Number(body?.sort_order)) ? Number(body.sort_order) : 0,
  is_active: body?.is_active !== false,
});
async function validateFieldInstrument(input: ReturnType<typeof fieldInstrumentInput>) {
  if (!input.name || !/^[A-Za-z0-9-]+$/.test(input.tag_code) ||
      !['analog', 'digital'].includes(input.signal_type) ||
      !['input', 'output'].includes(input.signal_direction) ||
      !['optional', 'mandatory', 'pump_linked'].includes(input.requirement_rule)) {
    return 'Name, tag code, signal type/direction, and requirement rule are required.';
  }
  if (input.default_product_master_id) {
    const product = await query('SELECT id FROM product_masters WHERE id=$1 AND status=\'Active\'', [input.default_product_master_id]);
    if (!product.rows[0]) return 'Default PIM product must be an active product.';
  }
  if ((input.default_range_min != null && !Number.isFinite(input.default_range_min)) ||
      (input.default_range_max != null && !Number.isFinite(input.default_range_max)) ||
      (input.default_range_min != null && input.default_range_max != null && input.default_range_min > input.default_range_max)) {
    return 'Measurement range must contain valid numbers and minimum cannot exceed maximum.';
  }
  if (input.default_calibration_interval_days != null &&
      (!Number.isInteger(input.default_calibration_interval_days) || input.default_calibration_interval_days < 1)) {
    return 'Calibration interval must be a positive whole number of days.';
  }
  return null;
}
router.get('/field-instruments', authenticate, async (req: AuthRequest, res: Response) => {
  const includeInactive = req.query.include_inactive === 'true';
  try {
    const timedQuery = (text: string, values?: any[]) => pool.query({
      text, values, query_timeout: 10_000,
    } as any);
    const [result, products] = await Promise.all([
      timedQuery(
        `SELECT d.*, pm.product_code AS default_product_code, pm.product_name AS default_product_name,
                pm.status AS default_product_status
         FROM field_instrument_definitions d
         LEFT JOIN product_masters pm ON pm.id=d.default_product_master_id
         ${includeInactive ? '' : 'WHERE d.is_active=true'}
         ORDER BY d.sort_order, d.tag_code`,
      ),
      timedQuery(
        `SELECT id,product_code,product_name,status
         FROM product_masters WHERE status='Active' ORDER BY product_code`,
      ),
    ]);
    res.json({ items: result.rows, products: products.rows });
  } catch (error: any) {
    const timedOut = error?.code === '57014' || /timeout|timed out/i.test(String(error?.message || ''));
    if (timedOut) {
      console.error('[field-instruments] catalogue load timed out', { code: error?.code });
      return res.status(503).json({
        error: {
          code: 'FIELD_INSTRUMENT_LOAD_TIMEOUT',
          message: 'Field Instruments are temporarily unavailable. Please retry.',
        },
      });
    }
    throw error;
  }
});
router.post('/field-instruments', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const input = fieldInstrumentInput(req.body);
  const error = await validateFieldInstrument(input);
  if (error) return res.status(400).json({ error: { code: 'INVALID', message: error } });
  try {
    const result = await query(
      `INSERT INTO field_instrument_definitions
        (name,description,tag_code,numbering_rule,signal_type,signal_direction,requirement_rule,default_control_logic,
         default_range_min,default_range_max,default_unit,allow_range_override,default_calibration_required,
         default_calibration_interval_days,default_calibration_procedure,default_datasheet_reference,allow_calibration_override,
         default_product_master_id,sort_order,is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [input.name, input.description, input.tag_code, input.numbering_rule, input.signal_type,
         input.signal_direction, input.requirement_rule, input.default_control_logic, input.default_range_min,
         input.default_range_max, input.default_unit, input.allow_range_override, input.default_calibration_required,
         input.default_calibration_interval_days, input.default_calibration_procedure, input.default_datasheet_reference,
         input.allow_calibration_override, input.default_product_master_id, input.sort_order, input.is_active],
    );
    await logAudit(req.user!.id, 'field_instrument_definition', result.rows[0].id, 'CREATE', { definition: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'That instrument tag code already exists.' } });
    throw error;
  }
});
router.put('/field-instruments/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const input = fieldInstrumentInput(req.body);
  const error = await validateFieldInstrument(input);
  if (error) return res.status(400).json({ error: { code: 'INVALID', message: error } });
  try {
    const result = await query(
      `UPDATE field_instrument_definitions SET
       name=$1,description=$2,tag_code=$3,numbering_rule=$4,signal_type=$5,signal_direction=$6,
         requirement_rule=$7,default_control_logic=$8,default_range_min=$9,default_range_max=$10,default_unit=$11,
         allow_range_override=$12,default_calibration_required=$13,default_calibration_interval_days=$14,
         default_calibration_procedure=$15,default_datasheet_reference=$16,allow_calibration_override=$17,
         default_product_master_id=$18,sort_order=$19,is_active=$20,updated_at=NOW()
         WHERE id=$21 RETURNING *`,
      [input.name, input.description, input.tag_code, input.numbering_rule, input.signal_type,
         input.signal_direction, input.requirement_rule, input.default_control_logic, input.default_range_min,
         input.default_range_max, input.default_unit, input.allow_range_override, input.default_calibration_required,
         input.default_calibration_interval_days, input.default_calibration_procedure, input.default_datasheet_reference,
         input.allow_calibration_override, input.default_product_master_id, input.sort_order, input.is_active, req.params.id],
    );
    if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Field instrument not found.' } });
    await logAudit(req.user!.id, 'field_instrument_definition', result.rows[0].id, 'UPDATE', { definition: result.rows[0] });
    res.json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'That instrument tag code already exists.' } });
    throw error;
  }
});

// ── Tank Cost Rates ──────────────────────────────────────────────────────────
// Pipe sizing standards are platform-governed inputs. DN and internal diameter
// are deliberately stored together; calculations never infer one from the other.
router.get('/pipe-sizing-standards', authenticate, async (_req, res: Response) => {
  const result = await query('SELECT * FROM pipe_sizing_standards ORDER BY dn');
  res.json({ items: result.rows });
});
router.post('/pipe-sizing-standards', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const body = req.body || {};
  const fields = ['dn', 'internal_diameter_mm', 'pressure_velocity_min_m_s', 'pressure_velocity_max_m_s', 'gravity_velocity_min_m_s', 'gravity_velocity_max_m_s'];
  if (fields.some(field => !Number.isFinite(Number(body[field]))) ||
      Number(body.dn) <= 0 || !Number.isInteger(Number(body.dn)) || Number(body.internal_diameter_mm) <= 0 ||
      Number(body.pressure_velocity_min_m_s) < 0 || Number(body.gravity_velocity_min_m_s) < 0 ||
      Number(body.pressure_velocity_min_m_s) > Number(body.pressure_velocity_max_m_s) ||
      Number(body.gravity_velocity_min_m_s) > Number(body.gravity_velocity_max_m_s)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Enter a positive DN/diameter and valid minimum/maximum velocity bands.' } });
  }
  try {
    const result = await query(
      `INSERT INTO pipe_sizing_standards
       (dn, internal_diameter_mm, pressure_velocity_min_m_s, pressure_velocity_max_m_s, gravity_velocity_min_m_s, gravity_velocity_max_m_s, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [...fields.map(field => Number(body[field])), body.is_active !== false],
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'That DN already exists.' } });
    throw error;
  }
});
router.put('/pipe-sizing-standards/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const body = req.body || {};
  const fields = ['dn', 'internal_diameter_mm', 'pressure_velocity_min_m_s', 'pressure_velocity_max_m_s', 'gravity_velocity_min_m_s', 'gravity_velocity_max_m_s'];
  if (fields.some(field => !Number.isFinite(Number(body[field]))) || Number(body.dn) <= 0 || !Number.isInteger(Number(body.dn)) ||
      Number(body.internal_diameter_mm) <= 0 || Number(body.pressure_velocity_min_m_s) < 0 || Number(body.gravity_velocity_min_m_s) < 0 ||
      Number(body.pressure_velocity_min_m_s) > Number(body.pressure_velocity_max_m_s) || Number(body.gravity_velocity_min_m_s) > Number(body.gravity_velocity_max_m_s)) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Enter a positive DN/diameter and valid minimum/maximum velocity bands.' } });
  }
  const existing = await query('SELECT dn FROM pipe_sizing_standards WHERE id=$1', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pipe sizing standard not found.' } });
  if (Number(existing.rows[0].dn) !== Number(body.dn)) {
    const inUse = await query('SELECT 1 FROM design_book_exhibit_hydraulics WHERE inlet_pipe_dn=$1 OR discharge_pipe_dn=$1 OR bottom_drain_pipe_dn=$1 LIMIT 1', [existing.rows[0].dn]);
    if (inUse.rows[0]) return res.status(409).json({ error: { code: 'IN_USE', message: 'Cannot change DN while saved exhibit choices use this standard.' } });
  }
  try {
    const result = await query(
      `UPDATE pipe_sizing_standards SET dn=$1, internal_diameter_mm=$2, pressure_velocity_min_m_s=$3,
         pressure_velocity_max_m_s=$4, gravity_velocity_min_m_s=$5, gravity_velocity_max_m_s=$6,
         is_active=$7, updated_at=NOW() WHERE id=$8 RETURNING *`,
      [...fields.map(field => Number(body[field])), body.is_active !== false, req.params.id],
    );
    res.json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23503') {
      return res.status(409).json({ error: {
        code: 'IN_USE',
        message: 'This DN is used by a saved exhibit and cannot be renamed. Its diameter and velocity bands can still be updated.',
      } });
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'That DN already exists.' } });
    }
    throw error;
  }
});
router.delete('/pipe-sizing-standards/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const inUse = await query('SELECT 1 FROM design_book_exhibit_hydraulics WHERE inlet_pipe_dn=(SELECT dn FROM pipe_sizing_standards WHERE id=$1) OR discharge_pipe_dn=(SELECT dn FROM pipe_sizing_standards WHERE id=$1) OR bottom_drain_pipe_dn=(SELECT dn FROM pipe_sizing_standards WHERE id=$1) LIMIT 1', [req.params.id]);
  if (inUse.rows[0]) return res.status(409).json({ error: { code: 'IN_USE', message: 'A saved exhibit choice uses this DN; deactivate it instead.' } });
  try {
    const result = await query('DELETE FROM pipe_sizing_standards WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pipe sizing standard not found.' } });
    res.status(204).end();
  } catch (error: any) {
    if (error.code === '23503') {
      return res.status(409).json({ error: { code: 'IN_USE', message: 'A saved exhibit choice uses this DN; deactivate it instead.' } });
    }
    throw error;
  }
});

const WATER_TYPES = ['Freshwater', 'Brackish', 'Seawater'] as const;

function validateWaterDensityParameter(body: any) {
  const waterType = typeof body.water_type === 'string' ? body.water_type.trim() : '';
  const density = Number(body.density_kg_m3);
  const conditions = typeof body.conditions === 'string' ? body.conditions.trim() : '';
  const unit = typeof body.unit === 'string' ? body.unit.trim() : '';
  const source = typeof body.source === 'string' ? body.source.trim() : '';
  if (!WATER_TYPES.includes(waterType as typeof WATER_TYPES[number])) {
    return { error: 'Water type must be Freshwater, Brackish, or Seawater.' };
  }
  if (!Number.isFinite(density) || density <= 0 || density > 2000) {
    return { error: 'Density must be a positive number no greater than 2000 kg/m3.' };
  }
  if (!conditions || conditions.length > 2000) return { error: 'Conditions are required and must be 2000 characters or fewer.' };
  if (unit !== 'kg/m3') return { error: 'Unit must be kg/m3.' };
  if (!source || source.length > 2000) return { error: 'Source is required and must be 2000 characters or fewer.' };
  if (body.is_active !== undefined && typeof body.is_active !== 'boolean') return { error: 'is_active must be boolean.' };
  return { value: { waterType, density, conditions, unit, source, isActive: body.is_active !== false } };
}

router.get('/chemical-parameters/water-density', authenticate, requireRole('admin'), async (_req: AuthRequest, res: Response) => {
  const result = await query(
    `SELECT wdp.*, creator.email AS created_by_email, updater.email AS updated_by_email
     FROM water_density_parameters wdp
     LEFT JOIN users creator ON creator.id=wdp.created_by
     LEFT JOIN users updater ON updater.id=wdp.updated_by
     ORDER BY CASE wdp.water_type WHEN 'Freshwater' THEN 1 WHEN 'Brackish' THEN 2 ELSE 3 END`,
  );
  res.json({ items: result.rows });
});

router.post('/chemical-parameters/water-density', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const parsed = validateWaterDensityParameter(req.body);
  if (parsed.error) return res.status(400).json({ error: { code: 'VALIDATION', message: parsed.error } });
  const value = parsed.value!;
  try {
    const result = await query(
      `INSERT INTO water_density_parameters
       (water_type, density_kg_m3, conditions, unit, source, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,
      [value.waterType, value.density, value.conditions, value.unit, value.source, value.isActive, req.user!.id],
    );
    await logAudit(req.user!.id, 'water_density_parameter', result.rows[0].id, 'CREATE', { summary: `Water density parameter created for ${value.waterType}`, after: result.rows[0] });
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: `A parameter for ${value.waterType} already exists.` } });
    throw error;
  }
});

router.put('/chemical-parameters/water-density/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const parsed = validateWaterDensityParameter(req.body);
  if (parsed.error) return res.status(400).json({ error: { code: 'VALIDATION', message: parsed.error } });
  const value = parsed.value!;
  const existing = await query('SELECT * FROM water_density_parameters WHERE id=$1', [req.params.id]);
  if (!existing.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Water density parameter not found.' } });
  try {
    const result = await query(
      `UPDATE water_density_parameters SET water_type=$1, density_kg_m3=$2, conditions=$3, unit=$4, source=$5,
       is_active=$6, updated_at=NOW(), updated_by=$7 WHERE id=$8 RETURNING *`,
      [value.waterType, value.density, value.conditions, value.unit, value.source, value.isActive, req.user!.id, req.params.id],
    );
    await logAudit(req.user!.id, 'water_density_parameter', result.rows[0].id, 'UPDATE', { summary: `Water density parameter updated for ${value.waterType}`, before: existing.rows[0], after: result.rows[0] });
    res.json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: `A parameter for ${value.waterType} already exists.` } });
    throw error;
  }
});

router.delete('/chemical-parameters/water-density/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const result = await query('DELETE FROM water_density_parameters WHERE id=$1 RETURNING *', [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Water density parameter not found.' } });
  await logAudit(req.user!.id, 'water_density_parameter', result.rows[0].id, 'DELETE', { summary: `Water density parameter deleted for ${result.rows[0].water_type}`, before: result.rows[0] });
  res.status(204).end();
});

router.get('/tank-cost-rates', authenticate, async (_req, res: Response) => {
  const result = await query('SELECT * FROM tank_cost_rates ORDER BY material_code NULLS LAST, label');
  res.json({ items: result.rows });
});

router.post('/tank-cost-rates', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { material_code, label, cost_per_sqm_usd, currency, notes } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: { code: 'INVALID', message: 'Label is required' } });
  const result = await query(
    'INSERT INTO tank_cost_rates (material_code, label, cost_per_sqm_usd, currency, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [material_code?.trim() || null, label.trim(), parseFloat(cost_per_sqm_usd) || 0, currency || 'USD', notes?.trim() || null]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/tank-cost-rates/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  const { material_code, label, cost_per_sqm_usd, currency, notes } = req.body;
  const result = await query(
    'UPDATE tank_cost_rates SET material_code=$1, label=$2, cost_per_sqm_usd=$3, currency=$4, notes=$5, updated_at=NOW() WHERE id::text=$6 RETURNING *',
    [material_code?.trim() || null, label?.trim(), parseFloat(cost_per_sqm_usd) || 0, currency || 'USD', notes?.trim() || null, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rate not found' } });
  res.json(result.rows[0]);
});

router.delete('/tank-cost-rates/:id', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  await query('DELETE FROM tank_cost_rates WHERE id::text=$1', [req.params.id]);
  res.status(204).end();
});

export default router;
