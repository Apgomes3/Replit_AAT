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

const domainColors: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  project:   { bg: '#DBEAFE', border: '#3B82F6', text: '#1E40AF', badge: '#3B82F6' },
  product:   { bg: '#DCFCE7', border: '#16A34A', text: '#15803D', badge: '#16A34A' },
  knowledge: { bg: '#F1F5F9', border: '#94A3B8', text: '#475569', badge: '#94A3B8' },
  document:  { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E', badge: '#F59E0B' },
  unknown:   { bg: '#F8FAFC', border: '#CBD5E1', text: '#64748B', badge: '#CBD5E1' },
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

  const byDepth = new Map<number, string[]>();
  nodes.forEach(n => {
    const d = depths.get(n.id) ?? 999;
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
        border: `2px solid ${isStart ? col.border : col.border + '99'}`,
        borderWidth: isStart ? 3 : 1.5,
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
    const key = [e.source, e.target].sort().join('-');
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
  const autoFiredRef = useRef(false);

  const runQuery = useCallback(async (nodeId: string, nodeType: string, queryDepth: number) => {
    if (!nodeId) { toast.error('Enter a start node ID'); return; }
    setLoading(true);
    try {
      const res = await api.post('/graph/query', { start_node: nodeId, start_type: nodeType, depth: queryDepth });
      const { nodes: apiNodes, edges: apiEdges } = res.data as { nodes: GraphNode[]; edges: { source: string; target: string; type: string }[] };
      const positions = buildLayeredLayout(apiNodes, apiEdges, nodeId);
      setNodes(buildFlowNodes(apiNodes, nodeId, positions));
      setEdges(buildFlowEdges(apiEdges));
      setStats({ nodes: apiNodes.length, edges: apiEdges.length });
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
    try {
      const res = await api.get(`/graph/product-reuse/${startNode}`);
      toast.success(`Product used in ${res.data.items.length} project(s)`);
    } catch { toast.error('Reuse query failed'); } finally { setLoading(false); }
  };

  const handleImpact = async () => {
    if (!startNode) return;
    setLoading(true);
    try {
      const res = await api.get(`/graph/impact/${startNode}`);
      toast.success(`${res.data.items.length} impacted project path(s) found`);
    } catch { toast.error('Impact analysis failed'); } finally { setLoading(false); }
  };

  const subtitle = startNodeName
    ? `Relationships for: ${startNodeName}`
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
            className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-[#3E5C76] font-mono"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wide block mb-1">Entity Type</label>
          <select
            value={startType}
            onChange={e => setStartType(e.target.value)}
            className="border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[#3E5C76]"
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
            className="border border-slate-300 rounded px-3 py-1.5 text-sm w-16 focus:outline-none focus:border-[#3E5C76]"
          />
        </div>
        <Button variant="primary" onClick={handleQuery} disabled={loading}>
          {loading ? 'Loading…' : 'Traverse'}
        </Button>
        <Button onClick={handleReuse} disabled={loading || startType !== 'product'}>Reuse</Button>
        <Button onClick={handleImpact} disabled={loading || startType !== 'product'}>Impact</Button>
        {stats && (
          <div className="text-xs text-slate-400 ml-1">
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
              <div>or navigate here from any product, project, or document page</div>
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-3 text-xs">
              {Object.entries(domainColors).filter(([k]) => k !== 'unknown').map(([domain, col]) => (
                <div key={domain} className="flex items-center gap-1.5">
                  <div className="w-3.5 h-3.5 rounded" style={{ background: col.bg, border: `2px solid ${col.border}` }} />
                  <span className="capitalize text-slate-500">{domain}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-slate-400">
              Click any navigable node (Product, Project, Document) to open its detail page
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
                const style = n.style as React.CSSProperties | undefined;
                return (style?.borderColor as string) || '#CBD5E1';
              }}
              maskColor="rgba(248,250,252,0.7)"
            />
          </ReactFlow>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60">
            <div className="text-sm text-slate-500 flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-[#3E5C76] border-t-transparent rounded-full animate-spin" />
              Traversing graph…
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
