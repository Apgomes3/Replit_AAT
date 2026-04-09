import React, { useState } from "react";
import { 
  Search, 
  Bell, 
  Settings, 
  User, 
  LayoutDashboard, 
  Library, 
  ShoppingCart, 
  FileText, 
  Box, 
  Activity, 
  ChevronRight,
  Filter,
  Plus
} from "lucide-react";

export function CommandCenter() {
  const [activeNav, setActiveNav] = useState("procurement");

  const kpis = [
    { label: "TOTAL POs", value: "47", color: "text-[#00d4aa]" },
    { label: "DRAFT", value: "8", color: "text-slate-400" },
    { label: "PENDING APPROVAL", value: "5", color: "text-amber-400" },
    { label: "RELEASED", value: "12", color: "text-blue-400" },
  ];

  const pos = [
    { id: "PO-2023-8901", project: "Oceanic Pavilion AQ", status: "RELEASED", items: 24, total: "$142,500.00", date: "2023-10-24" },
    { id: "PO-2023-8902", project: "Dubai Mall Aquarium", status: "PENDING", items: 8, total: "$34,200.00", date: "2023-10-25" },
    { id: "PO-2023-8903", project: "London Zoo Penguin Pool", status: "DRAFT", items: 45, total: "$89,150.00", date: "2023-10-26" },
    { id: "PO-2023-8904", project: "Singapore Changi T5", status: "RELEASED", items: 112, total: "$450,800.00", date: "2023-10-26" },
    { id: "PO-2023-8905", project: "Oceanic Pavilion AQ", status: "DRAFT", items: 3, total: "$4,100.00", date: "2023-10-27" },
    { id: "PO-2023-8906", project: "Miami Seaquarium Rehab", status: "REJECTED", items: 15, total: "$22,000.00", date: "2023-10-28" },
    { id: "PO-2023-8907", project: "Dubai Mall Aquarium", status: "RELEASED", items: 31, total: "$67,900.00", date: "2023-10-29" },
    { id: "PO-2023-8908", project: "Sydney Harbor Exhibit", status: "PENDING", items: 5, total: "$12,450.00", date: "2023-10-30" },
  ];

  const getStatusStyle = (status: string) => {
    switch(status) {
      case 'RELEASED': return "bg-blue-500/10 text-blue-400 border-blue-500/30 shadow-[0_0_10px_rgba(59,130,246,0.2)]";
      case 'PENDING': return "bg-amber-500/10 text-amber-400 border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.2)]";
      case 'DRAFT': return "bg-slate-500/10 text-slate-400 border-slate-500/30";
      case 'REJECTED': return "bg-red-500/10 text-red-400 border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.2)]";
      default: return "bg-slate-500/10 text-slate-400 border-slate-500/30";
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#0f1117] text-slate-300 font-sans overflow-hidden selection:bg-[#00d4aa]/30">
      
      {/* Sidebar - Control Panel */}
      <aside className="w-64 border-r border-slate-800 bg-[#0a0c10] flex flex-col shrink-0 relative z-10 shadow-[4px_0_24px_rgba(0,0,0,0.5)]">
        <div className="p-6 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#00d4aa]/10 border border-[#00d4aa]/30 flex items-center justify-center shadow-[0_0_15px_rgba(0,212,170,0.15)]">
              <Activity className="w-5 h-5 text-[#00d4aa]" />
            </div>
            <div>
              <h1 className="text-[#00d4aa] font-bold tracking-wider text-sm">EDP_SYS</h1>
              <p className="text-slate-500 text-[10px] tracking-widest font-mono uppercase">Command Core v2.4</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          {[
            { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
            { id: "library", icon: Library, label: "Component Library" },
            { id: "graph", icon: Box, label: "Knowledge Graph" },
            { id: "procurement", icon: ShoppingCart, label: "Procurement" },
            { id: "docs", icon: FileText, label: "Documents" },
          ].map((item) => {
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveNav(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 group relative ${
                  isActive 
                    ? "bg-[#00d4aa]/10 text-[#00d4aa] shadow-[inset_2px_0_0_#00d4aa,0_0_15px_rgba(0,212,170,0.05)]" 
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                }`}
              >
                <item.icon className={`w-4 h-4 ${isActive ? "drop-shadow-[0_0_5px_rgba(0,212,170,0.5)]" : ""}`} />
                <span className="text-sm font-medium tracking-wide">{item.label}</span>
                {isActive && (
                  <ChevronRight className="w-4 h-4 ml-auto opacity-50" />
                )}
              </button>
            )
          })}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="bg-slate-900/50 border border-slate-800 rounded p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center">
              <User className="w-4 h-4 text-slate-400" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-xs font-medium text-slate-300 truncate">eng_admin_01</p>
              <p className="text-[10px] text-slate-500 font-mono">SYS.ADMIN</p>
            </div>
            <Settings className="w-4 h-4 text-slate-500 cursor-pointer hover:text-slate-300" />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900/40 via-[#0f1117] to-[#0f1117]">
        
        {/* Header Bar */}
        <header className="h-16 border-b border-slate-800/60 bg-[#0f1117]/80 backdrop-blur-md flex items-center justify-between px-6 shrink-0 z-10 sticky top-0">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-slate-100 tracking-wide">Purchase Orders</h2>
            <div className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-400 font-mono">
              /procurement/orders
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative group">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-[#00d4aa] transition-colors" />
              <input 
                type="text" 
                placeholder="Search POs, projects, IDs..." 
                className="bg-[#0a0c10] border border-slate-800 text-sm text-slate-200 rounded-md pl-9 pr-4 py-1.5 focus:outline-none focus:border-[#00d4aa]/50 focus:ring-1 focus:ring-[#00d4aa]/50 transition-all w-64 placeholder:text-slate-600"
              />
            </div>
            <button className="relative p-2 text-slate-400 hover:text-slate-200 transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#00d4aa] rounded-full shadow-[0_0_8px_#00d4aa]"></span>
            </button>
            <button className="px-3 py-1.5 bg-[#00d4aa] hover:bg-[#00ebd0] text-[#0a0c10] text-sm font-semibold rounded shadow-[0_0_15px_rgba(0,212,170,0.3)] transition-all flex items-center gap-2">
              <Plus className="w-4 h-4" />
              NEW PO
            </button>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* KPI Cards */}
          <div className="grid grid-cols-4 gap-4">
            {kpis.map((kpi, i) => (
              <div key={i} className="bg-[#0a0c10]/80 border border-slate-800/80 rounded-lg p-5 flex flex-col justify-between relative overflow-hidden group">
                {/* Subtle corner accent */}
                <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-slate-800/20 to-transparent pointer-events-none group-hover:from-slate-700/30 transition-colors"></div>
                
                <h3 className="text-xs text-slate-500 font-medium tracking-widest">{kpi.label}</h3>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className={`text-3xl font-light tracking-tight ${kpi.color}`}>{kpi.value}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Data Table Area */}
          <div className="bg-[#0a0c10]/90 border border-slate-800 rounded-lg flex flex-col shadow-xl">
            {/* Table Toolbar */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex p-1 bg-[#0f1117] rounded border border-slate-800">
                  <button className="px-3 py-1 text-xs font-medium rounded bg-slate-800 text-slate-200 shadow-sm">All</button>
                  <button className="px-3 py-1 text-xs font-medium rounded text-slate-500 hover:text-slate-300 transition-colors">Pending</button>
                  <button className="px-3 py-1 text-xs font-medium rounded text-slate-500 hover:text-slate-300 transition-colors">Released</button>
                </div>
              </div>
              <button className="flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-slate-200 bg-[#0f1117] px-3 py-1.5 rounded border border-slate-800 transition-colors">
                <Filter className="w-3.5 h-3.5" />
                FILTER
              </button>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-[#0f1117]/50">
                    <th className="px-5 py-3 text-[10px] font-mono tracking-widest text-slate-500 uppercase">PO Code</th>
                    <th className="px-5 py-3 text-[10px] font-mono tracking-widest text-slate-500 uppercase">Project</th>
                    <th className="px-5 py-3 text-[10px] font-mono tracking-widest text-slate-500 uppercase">Status</th>
                    <th className="px-5 py-3 text-[10px] font-mono tracking-widest text-slate-500 uppercase text-right">Items</th>
                    <th className="px-5 py-3 text-[10px] font-mono tracking-widest text-slate-500 uppercase text-right">Total Sell</th>
                    <th className="px-5 py-3 text-[10px] font-mono tracking-widest text-slate-500 uppercase text-right">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {pos.map((po) => (
                    <tr key={po.id} className="hover:bg-slate-800/20 transition-colors group">
                      <td className="px-5 py-3.5">
                        <span className="font-mono text-xs text-[#00d4aa] group-hover:drop-shadow-[0_0_5px_rgba(0,212,170,0.5)] transition-all cursor-pointer">
                          {po.id}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-sm text-slate-300">{po.project}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border ${getStatusStyle(po.status)}`}>
                          {po.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className="text-sm font-mono text-slate-400">{po.items}</span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className="text-sm font-mono text-slate-300">{po.total}</span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className="text-xs font-mono text-slate-500">{po.date}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="p-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
              <span>Showing 1 to 8 of 47 entries</span>
              <div className="flex items-center gap-1 font-mono">
                <button className="px-2 py-1 rounded hover:bg-slate-800 transition-colors text-slate-600 disabled:opacity-50" disabled>PREV</button>
                <button className="px-2 py-1 rounded bg-[#00d4aa]/10 text-[#00d4aa] border border-[#00d4aa]/20">1</button>
                <button className="px-2 py-1 rounded hover:bg-slate-800 transition-colors">2</button>
                <button className="px-2 py-1 rounded hover:bg-slate-800 transition-colors">3</button>
                <span className="px-2 py-1">...</span>
                <button className="px-2 py-1 rounded hover:bg-slate-800 transition-colors">6</button>
                <button className="px-2 py-1 rounded hover:bg-slate-800 transition-colors">NEXT</button>
              </div>
            </div>

          </div>
          
        </div>
      </main>
    </div>
  );
}
