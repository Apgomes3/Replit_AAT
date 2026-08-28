"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const graphService_1 = require("../services/graphService");
const db_1 = require("../db");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate, (0, auth_1.requireModuleAccess)('graph'));
router.post('/query', auth_1.authenticate, async (req, res) => {
    const { start_node, start_type, depth = 3 } = req.body;
    if (!start_node || !start_type)
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'start_node and start_type required' } });
    const safeDepth = Math.min(depth, 5);
    const result = await (0, graphService_1.traverseGraph)(start_node, start_type, safeDepth);
    res.json(result);
});
router.get('/product-reuse/:productId', auth_1.authenticate, async (req, res) => {
    const rows = await (0, graphService_1.findProductReuse)(String(req.params.productId));
    res.json({ items: rows });
});
router.get('/impact/:productId', auth_1.authenticate, async (req, res) => {
    const rows = await (0, graphService_1.findImpactedProjects)(String(req.params.productId));
    res.json({ items: rows });
});
router.get('/relationships', auth_1.authenticate, async (req, res) => {
    const { source_id, target_id, edge_type } = req.query;
    const filters = [];
    const params = [];
    if (source_id) {
        params.push(source_id);
        filters.push(`source_id=$${params.length}`);
    }
    if (target_id) {
        params.push(target_id);
        filters.push(`target_id=$${params.length}`);
    }
    if (edge_type) {
        params.push(edge_type);
        filters.push(`edge_type=$${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const result = await (0, db_1.query)(`SELECT * FROM entity_relationships ${where} ORDER BY created_at LIMIT 500`, params);
    res.json({ items: result.rows });
});
router.post('/relationships', auth_1.authenticate, async (req, res) => {
    const { source_id, source_type, target_id, target_type, edge_type, properties } = req.body;
    const result = await (0, db_1.query)('INSERT INTO entity_relationships (source_id, source_type, target_id, target_type, edge_type, properties) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [source_id, source_type, target_id, target_type, edge_type, properties || {}]);
    res.status(201).json(result.rows[0]);
});
exports.default = router;
