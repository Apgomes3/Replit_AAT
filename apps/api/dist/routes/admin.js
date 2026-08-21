"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const db_2 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const audit_1 = require("../db/audit");
const email_1 = require("../lib/email");
const router = (0, express_1.Router)();
router.get('/email-status', auth_1.authenticate, (0, auth_1.requireRole)('admin'), (_req, res) => {
    res.json({ smtp_configured: (0, email_1.isSmtpConfigured)() });
});
router.get('/users', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const page_size = Math.min(1000, Math.max(1, parseInt(req.query.page_size) || 25));
    const offset = (page - 1) * page_size;
    const q = (req.query.q || '').trim();
    const role = (req.query.role || '').trim();
    const sort = (req.query.sort || 'created_asc');
    const conditions = [];
    const params = [];
    if (q) {
        params.push(`%${q}%`);
        conditions.push(`(email ILIKE $${params.length} OR first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR (first_name || ' ' || last_name) ILIKE $${params.length})`);
    }
    if (role) {
        params.push(role);
        conditions.push(`role = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderMap = {
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
        (0, db_1.query)(`SELECT COUNT(*) FROM users ${where}`, countParams),
        (0, db_1.query)(`SELECT id, email, first_name, last_name, role, is_active, can_see_all_pos, created_at, last_login_at
       FROM users ${where} ORDER BY ${orderBy} LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`, dataParams),
    ]);
    const total = parseInt(countResult.rows[0].count);
    res.json({
        items: dataResult.rows,
        pagination: { page, page_size, total, pages: Math.ceil(total / page_size) },
    });
});
router.patch('/users/:id/po-visibility', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const { can_see_all_pos } = req.body;
    if (typeof can_see_all_pos !== 'boolean') {
        return res.status(400).json({ error: { code: 'INVALID', message: 'can_see_all_pos must be boolean' } });
    }
    const result = await (0, db_1.query)('UPDATE users SET can_see_all_pos=$1, updated_at=NOW() WHERE id=$2 RETURNING id, email, can_see_all_pos', [can_see_all_pos, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    res.json(result.rows[0]);
});
router.post('/users', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const { email, password, first_name, last_name, role } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Email and password required' } });
    try {
        const hash = await bcryptjs_1.default.hash(password, 10);
        const result = await (0, db_1.query)('INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, first_name, last_name, role, created_at', [email, hash, first_name, last_name, role || 'viewer']);
        await (0, audit_1.logAudit)(req.user.id, 'user', result.rows[0].id, 'CREATE', { target_email: email, role: role || 'viewer' });
        res.status(201).json(result.rows[0]);
    }
    catch (err) {
        if (err.code === '23505')
            return res.status(409).json({ error: { code: 'CONFLICT', message: 'A user with that email already exists' } });
        throw err;
    }
});
router.post('/users/invite', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const { email, first_name, last_name, role } = req.body;
    if (!email)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Email is required' } });
    // Create user with a random unusable password
    const randomPassword = crypto_1.default.randomBytes(32).toString('hex');
    const hash = await bcryptjs_1.default.hash(randomPassword, 10);
    let userId;
    let userEmail;
    try {
        const result = await (0, db_1.query)('INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, email', [email.toLowerCase().trim(), hash, first_name || null, last_name || null, role || 'viewer']);
        userId = result.rows[0].id;
        userEmail = result.rows[0].email;
    }
    catch (err) {
        if (err.code === '23505')
            return res.status(409).json({ error: { code: 'CONFLICT', message: 'A user with that email already exists' } });
        throw err;
    }
    // Generate a 24-hour setup token (reuses password_reset_tokens table)
    const token = crypto_1.default.randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await (0, db_1.query)('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [userId, token, expiresAt]);
    const appUrl = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || 'localhost:5173'}`;
    const setupUrl = `${appUrl}/reset-password?token=${token}`;
    try {
        await (0, email_1.sendInviteEmail)(userEmail, first_name || '', setupUrl);
    }
    catch (emailErr) {
        // Email failed — clean up the created user and token so the admin gets an honest error
        console.error('[INVITE] Failed to send invite email:', emailErr?.message);
        await (0, db_1.query)('DELETE FROM password_reset_tokens WHERE token=$1', [token]);
        await (0, db_1.query)('DELETE FROM users WHERE id=$1', [userId]);
        return res.status(502).json({
            error: {
                code: 'EMAIL_FAILED',
                message: 'User was not created because the invite email could not be sent. Check your SMTP configuration.',
            },
        });
    }
    await (0, audit_1.logAudit)(req.user.id, 'user', userId, 'INVITE', { target_email: userEmail, role: role || 'viewer' });
    res.status(201).json({ ok: true, user_id: userId, email: userEmail });
});
router.put('/users/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const { first_name, last_name, role, is_active } = req.body;
    if (req.user.id === req.params.id && is_active !== true) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot block your own account' } });
    }
    const existing = await (0, db_1.query)('SELECT is_active FROM users WHERE id=$1', [req.params.id]);
    const result = await (0, db_1.query)('UPDATE users SET first_name=$1, last_name=$2, role=$3, is_active=$4, updated_at=NOW() WHERE id=$5 RETURNING id, email, first_name, last_name, role, is_active', [first_name, last_name, role, is_active, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    const updated = result.rows[0];
    let action = 'UPDATE';
    if (existing.rows[0] && is_active !== undefined) {
        if (!existing.rows[0].is_active && is_active === true)
            action = 'UNBLOCK';
        else if (existing.rows[0].is_active && is_active === false)
            action = 'BLOCK';
    }
    await (0, audit_1.logAudit)(req.user.id, 'user', updated.id, action, {
        target_email: updated.email,
        first_name: updated.first_name,
        last_name: updated.last_name,
        role: updated.role,
        is_active: updated.is_active,
    });
    res.json(updated);
});
router.patch('/users/:id/password', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 8) {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Password must be at least 8 characters' } });
    }
    if (req.user.id === req.params.id) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Use the profile settings to change your own password' } });
    }
    const existing = await (0, db_1.query)('SELECT id, email FROM users WHERE id=$1', [req.params.id]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    const hash = await bcryptjs_1.default.hash(password, 10);
    await (0, db_1.query)('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.params.id]);
    await (0, db_1.query)('DELETE FROM refresh_tokens WHERE user_id=$1', [req.params.id]);
    await (0, audit_1.logAudit)(req.user.id, 'user', req.params.id, 'RESET_PASSWORD', { target_email: existing.rows[0].email });
    res.status(204).end();
});
router.post('/users/:id/send-reset-link', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const existing = await (0, db_1.query)('SELECT id, email FROM users WHERE id=$1 AND is_active=true', [req.params.id]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    const token = crypto_1.default.randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await (0, db_1.query)('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [existing.rows[0].id, token, expiresAt]);
    const appUrl = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || 'localhost:5173'}`;
    const resetUrl = `${appUrl}/reset-password?token=${token}`;
    await (0, email_1.sendPasswordResetEmail)(existing.rows[0].email, resetUrl);
    await (0, audit_1.logAudit)(req.user.id, 'user', existing.rows[0].id, 'SEND_RESET_LINK', { target_email: existing.rows[0].email });
    res.json({ ok: true });
});
router.delete('/users/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const userId = req.params.id;
    if (req.user.id === userId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You cannot delete your own account' } });
    }
    const existing = await (0, db_1.query)('SELECT id, email FROM users WHERE id=$1', [userId]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    const client = await db_2.default.connect();
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
        await (0, audit_1.logAudit)(req.user.id, 'user', userId, 'DELETE', { target_user_id: userId, target_email: existing.rows[0].email });
        res.status(204).end();
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
});
router.get('/audit-logs', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const page_size = Math.min(parseInt(req.query.page_size) || 50, 200);
    const offset = (page - 1) * page_size;
    const conditions = [];
    const params = [];
    const entity_type = req.query.entity_type;
    const action = req.query.action;
    const actor = req.query.actor;
    const from = req.query.from;
    const to = req.query.to;
    if (entity_type) {
        params.push(entity_type);
        conditions.push(`al.entity_type = $${params.length}`);
    }
    if (action) {
        params.push(action);
        conditions.push(`al.action = $${params.length}`);
    }
    if (actor) {
        params.push(`%${actor}%`);
        conditions.push(`(u.first_name || ' ' || u.last_name) ILIKE $${params.length}`);
    }
    if (from) {
        params.push(from);
        conditions.push(`al.created_at >= $${params.length}`);
    }
    if (to) {
        params.push(to);
        conditions.push(`al.created_at <= $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countParams = [...params];
    const dataParams = [...params, page_size, offset];
    const [result, countResult] = await Promise.all([
        (0, db_1.query)(`SELECT al.*, u.first_name || ' ' || u.last_name as actor_name, u.email as actor_email
       FROM audit_logs al LEFT JOIN users u ON al.actor_id=u.id
       ${where}
       ORDER BY al.created_at DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`, dataParams),
        (0, db_1.query)(`SELECT COUNT(*) FROM audit_logs al LEFT JOIN users u ON al.actor_id=u.id ${where}`, countParams),
    ]);
    const total = parseInt(countResult.rows[0].count);
    res.json({ items: result.rows, pagination: { page, page_size, total, pages: Math.ceil(total / page_size) } });
});
router.get('/stats', auth_1.authenticate, async (req, res) => {
    const [projs, products, docs, equip, mats, systems, comps, docByStatus, equipByStatus, recentDocs] = await Promise.all([
        (0, db_1.query)('SELECT COUNT(*) FROM projects'),
        (0, db_1.query)('SELECT COUNT(*) FROM product_masters'),
        (0, db_1.query)('SELECT COUNT(*) FROM documents'),
        (0, db_1.query)('SELECT COUNT(*) FROM equipment_instances'),
        (0, db_1.query)('SELECT COUNT(*) FROM materials'),
        (0, db_1.query)('SELECT COUNT(*) FROM systems'),
        (0, db_1.query)('SELECT COUNT(*) FROM components'),
        (0, db_1.query)('SELECT status, COUNT(*) as count FROM documents GROUP BY status ORDER BY status'),
        (0, db_1.query)('SELECT status, COUNT(*) as count FROM equipment_instances GROUP BY status ORDER BY status'),
        (0, db_1.query)(`SELECT d.id, d.document_code, d.document_title, d.document_type, d.status, d.created_at,
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
router.get('/categories', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT * FROM product_categories ORDER BY sort_order, name');
    res.json({ items: result.rows });
});
router.post('/categories', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const { name, code, description, sort_order } = req.body;
    if (!name || !code)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'name and code required' } });
    try {
        const result = await (0, db_1.query)('INSERT INTO product_categories (name, code, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *', [name, code.toUpperCase(), description || null, sort_order || 0]);
        res.status(201).json(result.rows[0]);
    }
    catch (err) {
        if (err.code === '23505')
            return res.status(409).json({ error: { code: 'CONFLICT', message: 'Category name or code already exists' } });
        throw err;
    }
});
router.put('/categories/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const { name, code, description, sort_order } = req.body;
    const result = await (0, db_1.query)('UPDATE product_categories SET name=$1, code=$2, description=$3, sort_order=$4, updated_at=NOW() WHERE id=$5 RETURNING *', [name, code?.toUpperCase(), description || null, sort_order ?? 0, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Category not found' } });
    res.json(result.rows[0]);
});
router.delete('/categories/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const existing = await (0, db_1.query)('SELECT is_system FROM product_categories WHERE id=$1', [req.params.id]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Category not found' } });
    if (existing.rows[0].is_system)
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot delete a built-in category' } });
    await (0, db_1.query)('DELETE FROM product_categories WHERE id=$1', [req.params.id]);
    res.status(204).end();
});
// ROLES
router.get('/roles', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT * FROM roles ORDER BY sort_order, name');
    res.json({ items: result.rows });
});
router.post('/roles', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const { name, description, sort_order } = req.body;
    if (!name)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'name is required' } });
    try {
        const result = await (0, db_1.query)('INSERT INTO roles (name, description, sort_order) VALUES ($1,$2,$3) RETURNING *', [name.trim().toLowerCase(), description || null, sort_order || 0]);
        res.status(201).json(result.rows[0]);
    }
    catch (err) {
        if (err.code === '23505')
            return res.status(409).json({ error: { code: 'CONFLICT', message: 'Role name already exists' } });
        throw err;
    }
});
router.put('/roles/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const { name, description, sort_order } = req.body;
    const existing = await (0, db_1.query)('SELECT is_system FROM roles WHERE id=$1', [req.params.id]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
    if (existing.rows[0].is_system && name !== existing.rows[0].name) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot rename a built-in role' } });
    }
    try {
        const result = await (0, db_1.query)('UPDATE roles SET name=$1, description=$2, sort_order=$3, updated_at=NOW() WHERE id=$4 RETURNING *', [name.trim().toLowerCase(), description || null, sort_order ?? 0, req.params.id]);
        res.json(result.rows[0]);
    }
    catch (err) {
        if (err.code === '23505')
            return res.status(409).json({ error: { code: 'CONFLICT', message: 'Role name already exists' } });
        throw err;
    }
});
router.delete('/roles/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const existing = await (0, db_1.query)('SELECT is_system FROM roles WHERE id=$1', [req.params.id]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
    if (existing.rows[0].is_system)
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot delete a built-in role' } });
    await (0, db_1.query)('DELETE FROM roles WHERE id=$1', [req.params.id]);
    res.status(204).end();
});
// PENDING APPROVALS (admin/engineer only)
router.get('/pending-approvals', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const [pendingProducts, pendingDocs] = await Promise.all([
        (0, db_1.query)(`SELECT id, product_code as code, product_name as name, status, 'Product' as type, updated_at
           FROM product_masters WHERE status IN ('Draft','Internal Review','Pending Approval')
           ORDER BY updated_at DESC LIMIT 10`),
        (0, db_1.query)(`SELECT id, document_code as code, document_title as name, status, 'Document' as type, updated_at
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
router.get('/todos', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)('SELECT * FROM todos WHERE user_id=$1 ORDER BY created_at ASC', [req.user.id]);
    res.json({ items: result.rows });
});
router.post('/todos', auth_1.authenticate, async (req, res) => {
    const { text } = req.body;
    if (!text?.trim())
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'text required' } });
    const result = await (0, db_1.query)('INSERT INTO todos (user_id, text) VALUES ($1,$2) RETURNING *', [req.user.id, text.trim()]);
    res.status(201).json(result.rows[0]);
});
router.patch('/todos/:id', auth_1.authenticate, async (req, res) => {
    const { done } = req.body;
    const result = await (0, db_1.query)('UPDATE todos SET done=$1 WHERE id=$2 AND user_id=$3 RETURNING *', [done, req.params.id, req.user.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Todo not found' } });
    res.json(result.rows[0]);
});
router.delete('/todos/:id', auth_1.authenticate, async (req, res) => {
    await (0, db_1.query)('DELETE FROM todos WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.status(204).end();
});
// TANK FAMILIES (admin management)
router.get('/tank-families', auth_1.authenticate, async (req, res) => {
    const result = await (0, db_1.query)(`SELECT tf.*, COUNT(pm.id)::int as product_count
     FROM tank_families tf
     LEFT JOIN product_masters pm ON pm.tank_family_id = tf.id
     GROUP BY tf.id ORDER BY tf.sort_order, tf.name`);
    res.json({ items: result.rows });
});
router.post('/tank-families', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const { code, name, description, sort_order } = req.body;
    if (!code || !name)
        return res.status(400).json({ error: { code: 'INVALID', message: 'code and name are required' } });
    try {
        const result = await (0, db_1.query)('INSERT INTO tank_families (code, name, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *', [code.toUpperCase(), name, description || null, sort_order ?? 0]);
        res.status(201).json(result.rows[0]);
    }
    catch (e) {
        if (e.code === '23505')
            return res.status(400).json({ error: { code: 'DUPLICATE', message: 'A tank family with that code already exists' } });
        throw e;
    }
});
router.put('/tank-families/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const { name, description, sort_order } = req.body;
    const result = await (0, db_1.query)('UPDATE tank_families SET name=$1, description=$2, sort_order=$3, updated_at=NOW() WHERE id::text=$4 RETURNING *', [name, description || null, sort_order ?? 0, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank family not found' } });
    res.json(result.rows[0]);
});
router.delete('/tank-families/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const existing = await (0, db_1.query)('SELECT id FROM tank_families WHERE id::text=$1', [req.params.id]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tank family not found' } });
    await (0, db_1.query)('UPDATE product_masters SET tank_family_id=NULL WHERE tank_family_id::text=$1', [req.params.id]);
    await (0, db_1.query)('DELETE FROM tank_families WHERE id::text=$1', [req.params.id]);
    res.status(204).end();
});
router.get('/system-types', auth_1.authenticate, async (_req, res) => {
    const result = await (0, db_1.query)('SELECT * FROM system_types ORDER BY sort_order, name');
    res.json({ items: result.rows });
});
// ── PO STAGE ROLES ──────────────────────────────────────────────────────────
router.get('/po-stage-roles', auth_1.authenticate, async (_req, res) => {
    const r = await (0, db_1.query)(`SELECT psa.id, psa.stage, psa.user_id, psa.created_at,
            u.first_name, u.last_name, u.email, u.role
     FROM po_stage_assignees psa JOIN users u ON u.id = psa.user_id
     ORDER BY psa.stage, u.first_name`, []);
    const map = {};
    for (const row of r.rows) {
        if (!map[row.stage])
            map[row.stage] = [];
        map[row.stage].push(row);
    }
    res.json(map);
});
router.post('/po-stage-roles', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const { stage, user_id } = req.body;
    const VALID_STAGES = ['purchase_order', 'po_review', 'engineering_review'];
    if (!stage || !VALID_STAGES.includes(stage)) {
        return res.status(400).json({ error: { code: 'INVALID', message: 'Invalid stage' } });
    }
    if (!user_id)
        return res.status(400).json({ error: { code: 'INVALID', message: 'user_id required' } });
    try {
        const r = await (0, db_1.query)(`INSERT INTO po_stage_assignees (stage, user_id, created_by) VALUES ($1,$2,$3)
       RETURNING id, stage, user_id, created_at`, [stage, user_id, req.user.id]);
        res.status(201).json(r.rows[0]);
    }
    catch (e) {
        if (e.code === '23505')
            return res.status(400).json({ error: { code: 'DUPLICATE', message: 'User already assigned to this stage' } });
        throw e;
    }
});
router.delete('/po-stage-roles/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const existing = await (0, db_1.query)('SELECT id FROM po_stage_assignees WHERE id=$1', [req.params.id]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Assignee not found' } });
    await (0, db_1.query)('DELETE FROM po_stage_assignees WHERE id=$1', [req.params.id]);
    res.status(204).end();
});
// ── SYSTEM TYPES ─────────────────────────────────────────────────────────────
router.post('/system-types', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const { name, description, sort_order } = req.body;
    if (!name?.trim())
        return res.status(400).json({ error: { code: 'INVALID', message: 'name is required' } });
    try {
        const result = await (0, db_1.query)('INSERT INTO system_types (name, description, sort_order) VALUES ($1,$2,$3) RETURNING *', [name.trim(), description?.trim() || null, sort_order ?? 0]);
        res.status(201).json(result.rows[0]);
    }
    catch (e) {
        if (e.code === '23505')
            return res.status(400).json({ error: { code: 'DUPLICATE', message: 'A system type with that name already exists' } });
        throw e;
    }
});
router.put('/system-types/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin', 'engineer'), async (req, res) => {
    const { name, description, sort_order, is_active } = req.body;
    if (!name?.trim())
        return res.status(400).json({ error: { code: 'INVALID', message: 'name is required' } });
    try {
        const result = await (0, db_1.query)('UPDATE system_types SET name=$1, description=$2, sort_order=$3, is_active=$4, updated_at=NOW() WHERE id::text=$5 RETURNING *', [name.trim(), description?.trim() || null, sort_order ?? 0, is_active ?? true, req.params.id]);
        if (!result.rows[0])
            return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System type not found' } });
        res.json(result.rows[0]);
    }
    catch (e) {
        if (e.code === '23505')
            return res.status(400).json({ error: { code: 'DUPLICATE', message: 'A system type with that name already exists' } });
        throw e;
    }
});
router.delete('/system-types/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const existing = await (0, db_1.query)('SELECT id FROM system_types WHERE id::text=$1', [req.params.id]);
    if (!existing.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'System type not found' } });
    await (0, db_1.query)('DELETE FROM system_types WHERE id::text=$1', [req.params.id]);
    res.status(204).end();
});
// ── Tank Cost Rates ──────────────────────────────────────────────────────────
router.get('/tank-cost-rates', auth_1.authenticate, async (_req, res) => {
    const result = await (0, db_1.query)('SELECT * FROM tank_cost_rates ORDER BY material_code NULLS LAST, label');
    res.json({ items: result.rows });
});
router.post('/tank-cost-rates', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const { material_code, label, cost_per_sqm_usd, currency, notes } = req.body;
    if (!label?.trim())
        return res.status(400).json({ error: { code: 'INVALID', message: 'Label is required' } });
    const result = await (0, db_1.query)('INSERT INTO tank_cost_rates (material_code, label, cost_per_sqm_usd, currency, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *', [material_code?.trim() || null, label.trim(), parseFloat(cost_per_sqm_usd) || 0, currency || 'USD', notes?.trim() || null]);
    res.status(201).json(result.rows[0]);
});
router.put('/tank-cost-rates/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    const { material_code, label, cost_per_sqm_usd, currency, notes } = req.body;
    const result = await (0, db_1.query)('UPDATE tank_cost_rates SET material_code=$1, label=$2, cost_per_sqm_usd=$3, currency=$4, notes=$5, updated_at=NOW() WHERE id::text=$6 RETURNING *', [material_code?.trim() || null, label?.trim(), parseFloat(cost_per_sqm_usd) || 0, currency || 'USD', notes?.trim() || null, req.params.id]);
    if (!result.rows[0])
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rate not found' } });
    res.json(result.rows[0]);
});
router.delete('/tank-cost-rates/:id', auth_1.authenticate, (0, auth_1.requireRole)('admin'), async (req, res) => {
    await (0, db_1.query)('DELETE FROM tank_cost_rates WHERE id::text=$1', [req.params.id]);
    res.status(204).end();
});
exports.default = router;
