import React, { useState } from "react";
import { 
  Search, 
  Bell, 
  Settings, 
  User, 
  LayoutDashboard, 
  Library, 
  ShoppingCart, 
  ChevronRight, 
  ChevronDown,
  Folder, 
  FileBox, 
  Plus, 
  Filter, 
  Download,
  Settings2,
  Database,
  Briefcase
} from "lucide-react";

export function PrecisionLight() {
  const [activeItem, setActiveItem] = useState("Library");
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({
    'equipment': true,
    'pumps': true
  });

  const toggleNode = (id: string) => {
    setExpandedNodes(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const navItems = [
    { name: "Dashboard", icon: LayoutDashboard },
    { name: "Projects", icon: Briefcase },
    { name: "Library", icon: Library },
    { name: "Procurement", icon: ShoppingCart },
    { name: "Systems", icon: Database },
    { name: "Admin", icon: Settings2 },
  ];

  const treeData = [
    {
      id: 'equipment',
      name: 'Equipment',
      type: 'folder',
      children: [
        {
          id: 'pumps',
          name: 'Pumps',
          type: 'folder',
          children: [
            { id: 'aq-pumps', name: 'Aquarium Pumps', type: 'category', active: true },
            { id: 'dos-pumps', name: 'Dosing Pumps', type: 'category' },
            { id: 'sump-pumps', name: 'Sump Pumps', type: 'category' },
          ]
        },
        { id: 'filters', name: 'Filtration', type: 'folder' },
        { id: 'lighting', name: 'Lighting', type: 'folder' },
        { id: 'heaters', name: 'Heaters & Chillers', type: 'folder' },
      ]
    },
    {
      id: 'plumbing',
      name: 'Plumbing & Fittings',
      type: 'folder',
    },
    {
      id: 'tanks',
      name: 'Tanks & Enclosures',
      type: 'folder',
    }
  ];

  const products = [
    { code: "PMP-AQ-001", name: "Iwaki MD-55", type: "Circulation", specs: "1200 GPH, 115V", created: "2023-10-12", status: "Active" },
    { code: "PMP-AQ-002", name: "Iwaki MD-70", type: "Circulation", specs: "1500 GPH, 115V", created: "2023-10-15", status: "Active" },
    { code: "PMP-AQ-003", name: "Abyzz A200", type: "Variable Speed", specs: "4400 l/h, 24V", created: "2023-11-01", status: "Active" },
    { code: "PMP-AQ-004", name: "Abyzz A400", type: "Variable Speed", specs: "6100 l/h, 24V", created: "2023-11-05", status: "Active" },
    { code: "PMP-AQ-005", name: "Reef Octopus VarioS-2", type: "DC Pump", specs: "792 GPH, 24V", created: "2023-11-10", status: "Review" },
    { code: "PMP-AQ-006", name: "Reef Octopus VarioS-4", type: "DC Pump", specs: "1056 GPH, 24V", created: "2023-11-12", status: "Draft" },
    { code: "PMP-AQ-007", name: "Ecotech Vectra M2", type: "Centrifugal", specs: "2000 GPH, 36V", created: "2023-12-01", status: "Active" },
    { code: "PMP-AQ-008", name: "Ecotech Vectra L2", type: "Centrifugal", specs: "3100 GPH, 36V", created: "2023-12-05", status: "Active" },
  ];

  const renderTree = (nodes: any[], level = 0) => {
    return nodes.map(node => (
      <div key={node.id} className="flex flex-col">
        <div 
          className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer select-none text-sm transition-colors
            ${node.active ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
          style={{ paddingLeft: `${level * 12 + 8}px` }}
          onClick={() => toggleNode(node.id)}
        >
          {node.children ? (
            expandedNodes[node.id] ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <div className="w-3.5 h-3.5" />
          )}
          
          {node.type === 'folder' ? (
            <Folder className={`w-4 h-4 ${expandedNodes[node.id] ? 'text-blue-500' : 'text-slate-400'}`} />
          ) : (
            <FileBox className={`w-4 h-4 ${node.active ? 'text-blue-600' : 'text-slate-400'}`} />
          )}
          <span className="truncate">{node.name}</span>
        </div>
        {node.children && expandedNodes[node.id] && (
          <div className="flex flex-col">
            {renderTree(node.children, level + 1)}
          </div>
        )}
      </div>
    ));
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-900 overflow-hidden">
      {/* Top Header */}
      <header className="h-12 border-b border-slate-300 bg-white flex items-center justify-between px-4 shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-semibold text-slate-800 tracking-tight">
            <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center text-white">
              <Database className="w-4 h-4" />
            </div>
            EDP Base
          </div>
          <div className="h-4 w-px bg-slate-300"></div>
          <div className="relative group">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500" />
            <input 
              type="text" 
              placeholder="Search components, products, or POs..." 
              className="pl-8 pr-4 py-1 h-8 w-80 bg-slate-50 border border-slate-200 rounded text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-slate-400"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors relative">
            <Bell className="w-4 h-4" />
            <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
          </button>
          <button className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors">
            <Settings className="w-4 h-4" />
          </button>
          <div className="h-4 w-px bg-slate-300 mx-1"></div>
          <button className="flex items-center gap-2 pl-2 pr-1 py-1 hover:bg-slate-100 rounded transition-colors text-sm font-medium text-slate-700">
            J. Smith
            <div className="w-6 h-6 bg-blue-100 text-blue-700 rounded flex items-center justify-center text-xs">
              JS
            </div>
          </button>
        </div>
      </header>

      {/* Main App Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar Navigation */}
        <aside className="w-64 border-r border-slate-300 bg-slate-50 flex flex-col shrink-0">
          <div className="p-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Navigation
          </div>
          <nav className="flex flex-col gap-0.5 px-2">
            {navItems.map((item) => (
              <button
                key={item.name}
                onClick={() => setActiveItem(item.name)}
                className={`flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition-colors ${
                  activeItem === item.name 
                    ? 'bg-blue-600 text-white shadow-sm' 
                    : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.name}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content Area */}
        <main className="flex flex-1 flex-col overflow-hidden bg-[#eef2f6]">
          {/* Breadcrumb / Toolbar */}
          <div className="h-12 border-b border-slate-300 bg-white flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span className="hover:text-blue-600 cursor-pointer">Library</span>
              <ChevronRight className="w-4 h-4 text-slate-400" />
              <span className="hover:text-blue-600 cursor-pointer">Products</span>
              <ChevronRight className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-900">Aquarium Pumps</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-50 transition-colors">
                <Filter className="w-4 h-4" />
                Filter
              </button>
              <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-50 transition-colors">
                <Download className="w-4 h-4" />
                Export
              </button>
              <div className="w-px h-4 bg-slate-300 mx-1"></div>
              <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 border border-blue-700 rounded shadow-sm hover:bg-blue-700 transition-colors">
                <Plus className="w-4 h-4" />
                New Product
              </button>
            </div>
          </div>

          {/* Two-Panel Layout */}
          <div className="flex flex-1 overflow-hidden p-4 gap-4">
            {/* Category Tree Panel */}
            <div className="w-72 bg-white border border-slate-300 rounded shadow-sm flex flex-col overflow-hidden shrink-0">
              <div className="h-10 border-b border-slate-200 bg-slate-50 flex items-center px-3 font-medium text-sm text-slate-700 shrink-0">
                Categories
              </div>
              <div className="flex-1 overflow-y-auto py-2 custom-scrollbar">
                {renderTree(treeData)}
              </div>
            </div>

            {/* Product Table Panel */}
            <div className="flex-1 bg-white border border-slate-300 rounded shadow-sm flex flex-col overflow-hidden min-w-0">
              <div className="h-10 border-b border-slate-200 bg-slate-50 flex items-center px-4 font-medium text-sm text-slate-700 shrink-0 justify-between">
                <span>Aquarium Pumps List</span>
                <span className="text-xs font-normal text-slate-500 border border-slate-200 bg-white px-2 py-0.5 rounded">
                  8 Items
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold sticky top-0 z-10 shadow-sm">
                      <th className="px-4 py-2.5 w-10">
                        <input type="checkbox" className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                      </th>
                      <th className="px-4 py-2.5 font-medium">Product Code</th>
                      <th className="px-4 py-2.5 font-medium">Name</th>
                      <th className="px-4 py-2.5 font-medium">Type</th>
                      <th className="px-4 py-2.5 font-medium">Specifications</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium text-right">Created</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-slate-100">
                    {products.map((product, i) => (
                      <tr key={product.code} className="hover:bg-blue-50/50 group cursor-pointer transition-colors">
                        <td className="px-4 py-2.5">
                          <input type="checkbox" className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </td>
                        <td className="px-4 py-2.5 font-medium text-blue-600 whitespace-nowrap">{product.code}</td>
                        <td className="px-4 py-2.5 font-medium text-slate-800">{product.name}</td>
                        <td className="px-4 py-2.5 text-slate-600">{product.type}</td>
                        <td className="px-4 py-2.5 text-slate-600 truncate max-w-[200px]" title={product.specs}>{product.specs}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border
                            ${product.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 
                              product.status === 'Review' ? 'bg-amber-50 text-amber-700 border-amber-200' : 
                              'bg-slate-100 text-slate-700 border-slate-200'}`}
                          >
                            {product.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 text-right whitespace-nowrap">{product.created}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}} />
    </div>
  );
}
