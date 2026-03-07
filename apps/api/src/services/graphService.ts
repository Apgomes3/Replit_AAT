import { query } from '../db';

export interface GraphNode {
  id: string;
  type: string;
  code: string;
  name: string;
  domain: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

export async function traverseGraph(startId: string, startType: string, depth: number = 3): Promise<{ nodes: GraphNode[], edges: GraphEdge[] }> {
  const visitedNodes = new Set<string>();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const startInfo = await getEntityInfo(startId, startType);
  if (startInfo) {
    nodes.push(startInfo);
    visitedNodes.add(startId);
  }

  async function traverse(currentId: string, currentType: string, currentDepth: number) {
    if (currentDepth <= 0) return;

    const rels = await query(
      `SELECT * FROM entity_relationships WHERE source_id = $1 OR target_id = $1 LIMIT 50`,
      [currentId]
    );

    for (const rel of rels.rows) {
      const otherId = rel.source_id === currentId ? rel.target_id : rel.source_id;
      const otherType = rel.source_id === currentId ? rel.target_type : rel.source_type;

      edges.push({ source: rel.source_id, target: rel.target_id, type: rel.edge_type });

      if (!visitedNodes.has(otherId)) {
        visitedNodes.add(otherId);
        const info = await getEntityInfo(otherId, otherType);
        if (info) {
          nodes.push(info);
          await traverse(otherId, otherType, currentDepth - 1);
        }
      }
    }
  }

  await traverse(startId, startType, depth);
  return { nodes, edges };
}

async function getEntityInfo(id: string, type: string): Promise<GraphNode | null> {
  const domainMap: Record<string, string> = {
    project: 'project', area: 'project', exhibit: 'project', system: 'project', equipment: 'project',
    product: 'product', material: 'knowledge', specification: 'knowledge',
    document: 'document'
  };

  const queries: Record<string, string> = {
    project: `SELECT id::text, project_code as code, project_name as name FROM projects WHERE id = $1`,
    area: `SELECT id::text, area_code as code, area_name as name FROM areas WHERE id = $1`,
    exhibit: `SELECT id::text, exhibit_code as code, exhibit_name as name FROM exhibits WHERE id = $1`,
    system: `SELECT id::text, system_code as code, system_name as name FROM systems WHERE id = $1`,
    equipment: `SELECT id::text, equipment_code as code, equipment_name as name FROM equipment_instances WHERE id = $1`,
    product: `SELECT id::text, product_code as code, product_name as name FROM product_masters WHERE id = $1`,
    material: `SELECT id::text, material_code as code, material_name as name FROM materials WHERE id = $1`,
    document: `SELECT id::text, document_code as code, document_title as name FROM documents WHERE id = $1`,
  };

  const q = queries[type];
  if (!q) return { id, type, code: id, name: id, domain: domainMap[type] || 'unknown' };

  try {
    const result = await query(q, [id]);
    if (!result.rows[0]) return null;
    return { id, type, code: result.rows[0].code, name: result.rows[0].name, domain: domainMap[type] || 'unknown' };
  } catch {
    return null;
  }
}

export async function findProductReuse(productId: string) {
  const result = await query(`
    SELECT DISTINCT p.project_code, p.project_name, p.project_status,
           pm.product_code, pm.product_name
    FROM product_usages pu
    JOIN projects p ON pu.project_id = p.id
    JOIN product_masters pm ON pu.product_master_id = pm.id
    WHERE pu.product_master_id = $1
  `, [productId]);
  return result.rows;
}

export async function findImpactedProjects(productId: string) {
  const result = await query(`
    SELECT DISTINCT p.id, p.project_code, p.project_name,
           s.system_code, s.system_name,
           ei.equipment_code, ei.equipment_name
    FROM product_usages pu
    JOIN projects p ON pu.project_id = p.id
    JOIN equipment_instances ei ON pu.equipment_instance_id = ei.id
    JOIN systems s ON ei.system_id = s.id
    WHERE pu.product_master_id = $1
  `, [productId]);
  return result.rows;
}
