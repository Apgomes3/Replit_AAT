import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReactFlow, {
  Node, Edge, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge, Connection,
  NodeTypes, MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import { GraphNode } from '../../types';
import toast from 'react-hot-toast';

const domainColors: Record<string, { bg: string; border: string; text: string }> = {
  project: { bg: '#DBEAFE', border: '#3B82F6', text: '#1E40AF' },
  product: { bg: '#DCFCE7', border: '#22C55E', text: '#15803D' },
  knowledge: { bg: '#F1F5F9', border: '#94A3B8', text: '#475569' },
  document: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E' },
  unknown: { bg: '#F8FAFC', border: '#CBD5E1', text: '#64748B' },
};

const nodeTypeLabels: Record<string, string> = {
  project: 'PROJECT', area: 'AREA', exhibit: 'EXHIBIT', system: 'SYSTEM',
  equipment: 'EQUIPMENT', product: 'PRODUCT', material: 'MATERIAL',
  document: 'DOCUMENT', specification: 'SPEC',
};

function buildFlowNodes(nodes: GraphNode[]): Node[] {
  return nodes.map((n, i) => {
    const col = domainColors[n.domain] || domainColors.unknown;
    const angle = (i / nodes.length) * 2 * Math.PI;
    const r = Math.min(200 + nodes.length * 10, 400);
    return {
      id: n.id,
      position: i === 0 ? { x: 300, y: 300 } : { x: 300 + r * Math.cos(angle), y: 300 + r * Math.sin(angle) },
      data: { label: <div className="text-center"><div className="text-xs font-bold opacity-50 mb-0.5">{nodeTypeLabels[n.type] || n.type.toUpperCase()}</div><div className="font-mono text-xs font-semibold">{n.code}</div><div className="text-xs mt-0.5 opacity-70 truncate max-w-24">{n.name}</div></div> },
      style: { background: col.bg, border: `2px solid ${col.border}`, color: col.text, borderRadius: '8px', padding: '8px 12px', minWidth: '120px', fontSize: '12px' },
    };
  });
}

function buildFlowEdges(edges: { source: string; target: string; type: string }[]): Edge[] {
  return edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    label: e.type,
    style: { stroke: '#94A3B8', strokeWidth: 1.5 },
    labelStyle: { fontSize: '10px', fill: '#94A3B8' },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#94A3B8' },
  }));
}

export default function GraphExplorer() {
  const [searchParams] = useSearchParams();
  const [startNode, setStartNode] = useState(searchParams.get('start') || '');
  const [startType, setStartType] = useState(searchParams.get('type') || 'project');
  const [depth, setDepth] = useState(3);
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [stats, setStats] = useState<{ nodes: number; edges: number } | null>(null);

  const handleQuery = async () => {
    if (!startNode) { toast.error('Enter a start node ID or code'); return; }
    setLoading(true);
    try {
      const res = await api.post('/graph/query', { start_node: startNode, start_type: startType, depth });
      const flowNodes = buildFlowNodes(res.data.nodes);
      const flowEdges = buildFlowEdges(res.data.edges);
      setNodes(flowNodes);
      setEdges(flowEdges);
      setStats({ nodes: res.data.nodes.length, edges: res.data.edges.length });
    } catch {
      toast.error('Graph query failed');
    } finally {
      setLoading(false);
    }
  };

  const handleImpact = async () => {
    if (!startNode) return;
    setLoading(true);
    try {
      const res = await api.get(`/graph/impact/${startNode}`);
      toast.success(`${res.data.items.length} impacted project paths found`);
    } catch { toast.error('Impact analysis failed'); } finally { setLoading(false); }
  };

  const handleReuse = async () => {
    if (!startNode) return;
    setLoading(true);
    try {
      const res = await api.get(`/graph/product-reuse/${startNode}`);
      toast.success(`Product used in ${res.data.items.length} project(s)`);
    } catch { toast.error('Reuse query failed'); } finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Graph Explorer" subtitle="Traverse engineering entity relationships" />
      <div className="bg-white border-b border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wide block mb-1">Start Node ID / Code</label>
          <input value={startNode} onChange={e => setStartNode(e.target.value)} placeholder="UUID or entity code"
            className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-[#3E5C76] font-mono" />
        </div>
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wide block mb-1">Entity Type</label>
          <select value={startType} onChange={e => setStartType(e.target.value)}
            className="border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none">
            {['project', 'area', 'exhibit', 'system', 'equipment', 'product', 'material', 'document'].map(t => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wide block mb-1">Depth (max 5)</label>
          <input type="number" value={depth} onChange={e => setDepth(Math.min(5, Math.max(1, parseInt(e.target.value))))} min={1} max={5}
            className="border border-slate-300 rounded px-3 py-1.5 text-sm w-16 focus:outline-none" />
        </div>
        <Button variant="primary" onClick={handleQuery} disabled={loading}>{loading ? 'Querying...' : 'Traverse Graph'}</Button>
        <Button onClick={handleReuse} disabled={loading || startType !== 'product'}>Product Reuse</Button>
        <Button onClick={handleImpact} disabled={loading || startType !== 'product'}>Impact Analysis</Button>
        {stats && <div className="text-xs text-slate-400 ml-2">{stats.nodes} nodes · {stats.edges} edges</div>}
      </div>

      <div className="flex-1 relative">
        {nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
            <div className="text-lg mb-2">Enter a node ID and traverse the graph</div>
            <div className="text-sm space-y-1 text-center">
              <div>Copy an entity ID from any detail page</div>
              <div>Select the entity type and click Traverse Graph</div>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3 text-xs">
              {Object.entries(domainColors).filter(([k]) => k !== 'unknown').map(([domain, col]) => (
                <div key={domain} className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded" style={{ background: col.bg, border: `2px solid ${col.border}` }} />
                  <span className="capitalize">{domain}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView>
            <Background color="#E2E8F0" gap={20} />
            <Controls />
            <MiniMap nodeColor={n => (n.style as any)?.border || '#CBD5E1'} maskColor="rgba(248,250,252,0.7)" />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
