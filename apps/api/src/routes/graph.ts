import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { traverseGraph, findProductReuse, findImpactedProjects } from '../services/graphService';
import { query } from '../db';

const router = Router();

router.post('/query', authenticate, async (req: AuthRequest, res: Response) => {
  const { start_node, start_type, depth = 3 } = req.body;
  if (!start_node || !start_type) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'start_node and start_type required' } });
  const safeDepth = Math.min(depth, 5);
  const result = await traverseGraph(start_node, start_type, safeDepth);
  res.json(result);
});

router.get('/product-reuse/:productId', authenticate, async (req: AuthRequest, res: Response) => {
  const rows = await findProductReuse(req.params.productId);
  res.json({ items: rows });
});

router.get('/impact/:productId', authenticate, async (req: AuthRequest, res: Response) => {
  const rows = await findImpactedProjects(req.params.productId);
  res.json({ items: rows });
});

router.get('/relationships', authenticate, async (req: AuthRequest, res: Response) => {
  const { source_id, target_id, edge_type } = req.query;
  const filters: string[] = [];
  const params: any[] = [];
  if (source_id) { params.push(source_id); filters.push(`source_id=$${params.length}`); }
  if (target_id) { params.push(target_id); filters.push(`target_id=$${params.length}`); }
  if (edge_type) { params.push(edge_type); filters.push(`edge_type=$${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const result = await query(`SELECT * FROM entity_relationships ${where} ORDER BY created_at LIMIT 500`, params);
  res.json({ items: result.rows });
});

router.post('/relationships', authenticate, async (req: AuthRequest, res: Response) => {
  const { source_id, source_type, target_id, target_type, edge_type, properties } = req.body;
  const result = await query('INSERT INTO entity_relationships (source_id, source_type, target_id, target_type, edge_type, properties) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [source_id, source_type, target_id, target_type, edge_type, properties || {}]);
  res.status(201).json(result.rows[0]);
});

export default router;
