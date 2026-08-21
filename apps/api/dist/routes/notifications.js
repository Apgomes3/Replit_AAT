"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const index_1 = require("../db/index");
const router = (0, express_1.Router)();
router.get('/notifications', auth_1.authenticate, async (req, res) => {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit || '50');
    const result = await (0, index_1.query)(`SELECT id, type, title, body, entity_type, entity_id, is_read, created_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`, [userId, limit]);
    const unread = result.rows.filter(r => !r.is_read).length;
    res.json({ notifications: result.rows, unread_count: unread });
});
router.patch('/notifications/:id/read', auth_1.authenticate, async (req, res) => {
    const { id } = req.params;
    await (0, index_1.query)(`UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
    res.json({ ok: true });
});
router.patch('/notifications/read-all', auth_1.authenticate, async (req, res) => {
    await (0, index_1.query)(`UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`, [req.user.id]);
    res.json({ ok: true });
});
router.delete('/notifications/:id', auth_1.authenticate, async (req, res) => {
    await (0, index_1.query)(`DELETE FROM notifications WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    res.json({ ok: true });
});
exports.default = router;
