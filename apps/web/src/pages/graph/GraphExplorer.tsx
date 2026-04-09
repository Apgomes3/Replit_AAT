import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import ReactFlow, {
  Node, Edge, Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  MarkerType, NodeMouseHandler
} from 'reactflow';
import 'reactflow/dist/style.css';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import { GraphNode } from '../../types';
import toast from 'react-hot-toast';
import { ArrowUpRight } from 'lucide-react';

const domainColors: Record<string, { bg: string; border: string; text: string }> = {
  project:   { bg: '#DBEAFE', border: '#3B82F6', text: '#1E40AF' },
  product:   { bg: '#DCFCE7', border: '#16A34A', text: '#15803D' },
  knowledge: { bg: '#F1F5F9', border: '#94A3B8', text: '#475569' },
  document:  { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
  unknown:   { bg: '#F8FAFC', border: '#CBD5E1', text: '#64748B' },
};

const typeLabels: Record<string, string> = {
  project: 'Project', area: 'Area', exhibit: 'Exhibit', system: 'System',
  equipment: 'Equipment', product: 'Product', material: 'Material',
  document: 'Document', specification: 'Spec',
};

const navigableTypes = new Set(['product', 'project', 'document']);

function routeForNode(type: string, id: string): string | null {
  if (type === 'product')  return `/products/masters/${id}`;
  if (type === 'project')  return `/projects/${id}`;
  if (type === 'document') return `/documents/${id}`;
  return null;
}

function buildLayeredLayout(
  nodes: GraphNode[],
  edges: { source: string; target: string; type: string }[],
  startId: string
): Map<string, { x: number; y: number }> {
  const adjacency = new Map<string, Set<string>>();
  nodes.forEach(n => adjacency.set(n.id, new Set()));
  edges.forEach(e => {
    adjacency.get(e.source)?.add(e.target);
    adjacency.get(e.target)?.add(e.source);
  });

  const depths = new Map<string, number>();
  const queue: string[] = [startId];
  depths.set(startId, 0);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depths.get(cur)!;
    adjacency.get(cur)?.forEach(nb => {
      if (!depths.has(nb)) {
        depths.set(nb, d + 1);
        queue.push(nb);
      }
    });
  }

  nodes.forEach(n => {
    if (!depths.has(n.id)) depths.set(n.id, 999);
  });

  const byDepth = new Map<number, string[]>();
  nodes.forEach(n => {
    const d = depths.get(n.id)!;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(n.id);
  });

  const NODE_W = 180;
  const NODE_H = 72;
  const H_GAP = 40;
  const V_GAP = 140;

  const positions = new Map<string, { x: number; y: number }>();
  byDepth.forEach((ids, depth) => {
    const totalW = ids.length * NODE_W + (ids.length - 1) * H_GAP;
    ids.forEach((id, i) => {
      positions.set(id, {
        x: i * (NODE_W + H_GAP) - totalW / 2 + NODE_W / 2,
        y: depth * (NODE_H + V_GAP),
      });
    });
  });

  return positions;
}

function buildFlowNodes(nodes: GraphNode[], startId: string, positions: Map<string, { x: number; y: number }>): Node[] {
  return nodes.map(n => {
    const col = domainColors[n.domain] ?? domainColors.unknown;
    const isStart = n.id === startId;
    const canNav = navigableTypes.has(n.type);
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      position: pos,
      data: {
        label: (
          <div className="text-center px-1">
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-60 mb-0.5">
              {typeLabels[n.type] ?? n.type}
            </div>
            <div className="font-mono text-xs font-bold truncate max-w-[140px]">{n.code}</div>
            <div className="text-[11px] mt-0.5 opacity-75 truncate max-w-[140px]">{n.name}</div>
            {canNav && (
              <div className="mt-1 text-[10px] opacity-50 flex items-center justify-center gap-0.5">
                <ArrowUpRight className="w-2.5 h-2.5" />click to open
              </div>
            )}
          </div>
        ),
        nodeType: n.type,
        nodeId: n.id,
        canNav,
      },
      style: {
        background: col.bg,
        border: `${isStart ? 3 : 1.5}px solid ${col.border}${isStart ? '' : '99'}`,
        color: col.text,
        borderRadius: '10px',
        padding: '8px 10px',
        minWidth: '160px',
        fontSize: '12px',
        boxShadow: isStart ? `0 0 0 3px ${col.border}33` : '0 1px 3px rgba(0,0,0,0.08)',
        cursor: canNav ? 'pointer' : 'default',
      },
    };
  });
}

function buildFlowEdges(edges: { source: string; target: string; type: string }[]): Edge[] {
  const seen = new Set<string>();
  return edges.flatMap((e, i) => {
    const key = [e.source, e.target].sort().join('|');
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      id: `e-${i}`,
      source: e.source,
      target: e.target,
      label: e.type.replace(/_/g, ' '),
      animated: false,
      style: { stroke: '#94A3B8', strokeWidth: 1.5 },
      labelStyle: { fontSize: '10px', fill: '#64748B', fontWeight: 500 },
      labelBgStyle: { fill: '#F8FAFC', fillOpacity: 0.85 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#94A3B8', width: 16, height: 16 },
    }];
  });
}

function renderGraph(
  rawNodes: GraphNode[],
  rawEdges: { source: string; target: string; type: string }[],
  startId: string,
  setNodes: (n: Node[]) => void,
  setEdges: (e: Edge[]) => void,
  setStats: (s: { nodes: number; edges: number }) => void
) {
  const positions = buildLayeredLayout(rawNodes, rawEdges, startId);
  setNodes(buildFlowNodes(rawNodes, startId, positions));
  setEdges(buildFlowEdges(rawEdges));
  setStats({ nodes: rawNodes.length, edges: rawEdges.length });
}

type ViewMode = 'traverse' | 'reuse' | 'impact';

const viewModeLabel: Record<ViewMode, string> = {
  traverse: 'Relationships for',
  reuse:    'Project reuse of',
  impact:   'Impact paths for',
};

export default function GraphExplorer() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [startNode, setStartNode] = useState(searchParams.get('start') || '');
  const [startType, setStartType] = useState(searchParams.get('type') || 'product');
  const [depth, setDepth] = useState(3);
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [stats, setStats] = useState<{ nodes: number; edges: number } | null>(null);
  const [startNodeName, setStartNodeName] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('traverse');
  const autoFiredRef = useRef(false);

  const runQuery = useCallback(async (nodeId: string, nodeType: string, queryDepth: number) => {
    if (!nodeId) { toast.error('Enter a start node ID'); return; }
    setLoading(true);
    setViewMode('traverse');
    try {
      const res = await api.post('/graph/query', { start_node: nodeId, start_type: nodeType, depth: queryDepth });
      const { nodes: apiNodes, edges: apiEdges } = res.data as { nodes: GraphNode[]; edges: { source: string; target: string; type: string }[] };
      renderGraph(apiNodes, apiEdges, nodeId, setNodes, setEdges, setStats);
      const start = apiNodes.find(n => n.id === nodeId);
      if (start) setStartNodeName(start.name || start.code);
    } catch {
      toast.error('Graph query failed');
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  useEffect(() => {
    const paramStart = searchParams.get('start');
    const paramType  = searchParams.get('type') || 'product';
    if (paramStart && !autoFiredRef.current) {
      autoFiredRef.current = true;
      setStartNode(paramStart);
      setStartType(paramType);
      runQuery(paramStart, paramType, 3);
    }
  }, [searchParams, runQuery]);

  const handleQuery = () => runQuery(startNode, startType, depth);

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    const route = routeForNode(node.data.nodeType, node.data.nodeId);
    if (route) navigate(route);
  }, [navigate]);

  const handleReuse = async () => {
    if (!startNode) return;
    setLoading(true);
    setViewMode('reuse');
    try {
      const res = await api.get(`/graph/product-reuse/${startNode}`);
      const items: { project_id: string; project_code: string; project_name: string; product_code: string; product_name: string }[] = res.data.items;

      if (items.length === 0) {
        toast('This product is not used in any projects yet', { icon: 'ℹ️' });
        setLoading(false);
        return;
      }

      const rawNodes: GraphNode[] = [
        { id: startNode, type: 'product', code: items[0].product_code, name: items[0].product_name, domain: 'product' },
        ...items.map(r => ({
          id: r.project_id,
          type: 'project' as const,
          code: r.project_code,
          name: r.project_name,
          domain: 'project',
        })),
      ];

      const rawEdges = items.map(r => ({
        source: startNode,
        target: r.project_id,
        type: 'used in',
      }));

      setStartNodeName(items[0].product_name);
      renderGraph(rawNodes, rawEdges, startNode, setNodes, setEdges, setStats);
    } catch {
      toast.error('Reuse query failed');
    } finally {
      setLoading(false);
    }
  };

  const handleImpact = async () => {
    if (!startNode) return;
    setLoading(true);
    setViewMode('impact');
    try {
      const res = await api.get(`/graph/impact/${startNode}`);
      const items: { id: string; project_code: string; project_name: string; system_code: string; system_name: string; equipment_code: string; equipment_name: string }[] = res.data.items;

      if (items.length === 0) {
        toast('No impacted project paths found for this product', { icon: 'ℹ️' });
        setLoading(false);
        return;
      }

      const nodeMap = new Map<string, GraphNode>();

      nodeMap.set(startNode, {
        id: startNode,
        type: 'product',
        code: '',
        name: '',
        domain: 'product',
      });

      items.forEach(r => {
        const sysId = `sys-${r.system_code}`;
        const eqId  = `eq-${r.equipment_code}`;

        if (!nodeMap.has(r.id)) {
          nodeMap.set(r.id, { id: r.id, type: 'project', code: r.project_code, name: r.project_name, domain: 'project' });
        }
        if (!nodeMap.has(sysId)) {
          nodeMap.set(sysId, { id: sysId, type: 'system', code: r.system_code, name: r.system_name, domain: 'project' });
        }
        if (!nodeMap.has(eqId)) {
          nodeMap.set(eqId, { id: eqId, type: 'equipment', code: r.equipment_code, name: r.equipment_name, domain: 'project' });
        }
      });

      const rawEdges: { source: string; target: string; type: string }[] = [];
      const edgeSeen = new Set<string>();
      items.forEach(r => {
        const sysId = `sys-${r.system_code}`;
        const eqId  = `eq-${r.equipment_code}`;
        const e1 = `${startNode}|${eqId}`;
        const e2 = `${eqId}|${sysId}`;
        const e3 = `${sysId}|${r.id}`;
        if (!edgeSeen.has(e1)) { edgeSeen.add(e1); rawEdges.push({ source: startNode, target: eqId, type: 'installed as' }); }
        if (!edgeSeen.has(e2)) { edgeSeen.add(e2); rawEdges.push({ source: eqId, target: sysId, type: 'in system' }); }
        if (!edgeSeen.has(e3)) { edgeSeen.add(e3); rawEdges.push({ source: sysId, target: r.id, type: 'in project' }); }
      });

      const rawNodes = [...nodeMap.values()];

      if (startNodeName) {
        const prod = nodeMap.get(startNode);
        if (prod) { prod.name = startNodeName; prod.code = startNode.slice(0, 8); }
      }

      renderGraph(rawNodes, rawEdges, startNode, setNodes, setEdges, setStats);
    } catch {
      toast.error('Impact analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const subtitle = startNodeName
    ? `${viewModeLabel[viewMode]}: ${startNodeName}`
    : 'Traverse engineering entity relationships';

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Graph Explorer" subtitle={subtitle} />

      <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wide block mb-1">Start Node ID</label>
          <input
            value={startNode}
            onChange={e => setStartNode(e.target.value)}
            placeholder="Paste entity UUID"
            className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-amber-600 font-mono"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wide block mb-1">Entity Type</label>
          <select
            value={startType}
            onChange={e => setStartType(e.target.value)}
            className="border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-amber-600"
          >
            {['project','area','exhibit','system','equipment','product','material','document'].map(t => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wide block mb-1">Depth</label>
          <input
            type="number" value={depth} min={1} max={5}
            onChange={e => setDepth(Math.min(5, Math.max(1, parseInt(e.target.value) || 1)))}
            className="border border-slate-300 rounded px-3 py-1.5 text-sm w-16 focus:outline-none focus:border-amber-600"
          />
        </div>
        <div className="flex items-end gap-2">
          <Button
            variant={viewMode === 'traverse' ? 'primary' : undefined}
            onClick={handleQuery}
            disabled={loading}
          >
            {loading && viewMode === 'traverse' ? 'Loading…' : 'Traverse'}
          </Button>
          <Button
            variant={viewMode === 'reuse' ? 'primary' : undefined}
            onClick={handleReuse}
            disabled={loading || startType !== 'product'}
            title="Show which projects use this product"
          >
            {loading && viewMode === 'reuse' ? 'Loading…' : 'Reuse'}
          </Button>
          <Button
            variant={viewMode === 'impact' ? 'primary' : undefined}
            onClick={handleImpact}
            disabled={loading || startType !== 'product'}
            title="Show the full equipment → system → project chain"
          >
            {loading && viewMode === 'impact' ? 'Loading…' : 'Impact'}
          </Button>
        </div>
        {stats && (
          <div className="text-xs text-slate-400 self-end pb-1.5">
            {stats.nodes} nodes · {stats.edges} edges
          </div>
        )}
      </div>

      <div className="flex-1 relative">
        {nodes.length === 0 && !loading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
            <div className="text-base font-medium mb-2 text-slate-500">No graph loaded</div>
            <div className="text-sm text-slate-400 text-center space-y-1">
              <div>Paste an entity UUID above and click Traverse</div>
              <div>or navigate here from any product or project page</div>
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-3 text-xs">
              {Object.entries(domainColors).filter(([k]) => k !== 'unknown').map(([domain, col]) => (
                <div key={domain} className="flex items-center gap-1.5">
                  <div className="w-3.5 h-3.5 rounded" style={{ background: col.bg, border: `2px solid ${col.border}` }} />
                  <span className="capitalize text-slate-500">{domain}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 text-xs text-slate-400 space-y-1 text-center">
              <div><span className="font-medium text-slate-500">Traverse</span> — all connected entities up to N hops</div>
              <div><span className="font-medium text-slate-500">Reuse</span> — which projects use this product</div>
              <div><span className="font-medium text-slate-500">Impact</span> — equipment → system → project chain</div>
            </div>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={2}
          >
            <Background color="#E2E8F0" gap={24} />
            <Controls />
            <MiniMap
              nodeColor={n => {
                const s = n.style as React.CSSProperties | undefined;
                return (s?.borderColor as string) || '#CBD5E1';
              }}
              maskColor="rgba(248,250,252,0.7)"
            />
          </ReactFlow>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60">
            <div className="text-sm text-slate-500 flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
              {viewMode === 'reuse' ? 'Finding project reuse…' : viewMode === 'impact' ? 'Analysing impact paths…' : 'Traversing graph…'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
