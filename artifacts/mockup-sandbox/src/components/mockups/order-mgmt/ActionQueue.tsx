import React from "react";
import { 
  Plus, 
  Check, 
  X, 
  Send, 
  Clock, 
  AlertCircle,
  ChevronRight,
  FileText,
  Building2,
  Package,
  History,
  ArrowRight
} from "lucide-react";

export function ActionQueue() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans text-slate-900">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Order Management</h1>
            <p className="text-sm text-slate-500 mt-1">Good morning, Alex. You have 5 pending actions today.</p>
          </div>
          <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm">
            <Plus className="w-5 h-5" />
            New PO
          </button>
        </header>

        {/* TOP SECTION: Your Action Queue */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold shadow-sm">
              5
            </div>
            <h2 className="text-lg font-semibold text-slate-800">Your Action Queue</h2>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Group 1: Awaiting Your Approval */}
            <div className="border-l-4 border-l-blue-600 border-b border-slate-100">
              <div className="bg-blue-50/50 px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600" />
                <h3 className="font-semibold text-slate-800 text-sm uppercase tracking-wider">Awaiting Your Approval</h3>
                <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full ml-auto">3</span>
              </div>
              <div className="divide-y divide-slate-100">
                {[
                  { id: "PO-0041", desc: "HVAC System Upgrade", vendor: "ClimateTech Inc", amount: "$45,200.00", date: "Today" },
                  { id: "PO-0039", desc: "Steel Structure Framework", vendor: "IronWorks Ltd", amount: "$112,500.00", date: "Yesterday" },
                  { id: "PO-0037", desc: "Electrical Panels", vendor: "Volt Systems", amount: "$28,450.00", date: "2 days ago" },
                ].map(po => (
                  <div key={po.id} className="p-5 flex items-center justify-between hover:bg-slate-50 transition-colors group">
                    <div className="flex items-start gap-4">
                      <div className="p-2 bg-slate-100 rounded-lg text-slate-500">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-slate-900">{po.id}</span>
                          <span className="text-slate-400 text-sm px-2 py-0.5 rounded bg-slate-100 border border-slate-200">{po.date}</span>
                        </div>
                        <p className="font-medium text-slate-700">{po.desc}</p>
                        <div className="flex items-center gap-3 text-sm text-slate-500 mt-1">
                          <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {po.vendor}</span>
                          <span className="font-medium text-slate-700">{po.amount}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 opacity-100">
                      <button className="flex items-center gap-1.5 px-3 py-2 bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 rounded-lg font-medium text-sm transition-all shadow-sm">
                        <X className="w-4 h-4" /> Reject
                      </button>
                      <button className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm transition-all shadow-sm">
                        <Check className="w-4 h-4" /> Approve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Group 2: Ready to Submit */}
            <div className="border-l-4 border-l-slate-400 border-b border-slate-100">
              <div className="bg-slate-50 px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                <Send className="w-4 h-4 text-slate-600" />
                <h3 className="font-semibold text-slate-800 text-sm uppercase tracking-wider">Ready to Submit</h3>
                <span className="bg-slate-200 text-slate-700 text-xs font-bold px-2 py-0.5 rounded-full ml-auto">2</span>
              </div>
              <div className="divide-y divide-slate-100">
                {[
                  { id: "PO-0043", desc: "Concrete Works - Phase 1", vendor: "Solid Foundations", amount: "$85,000.00" },
                  { id: "PO-0044", desc: "Safety Equipment Restock", vendor: "SafeGuard Supply", amount: "$4,250.00" },
                ].map(po => (
                  <div key={po.id} className="p-5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-start gap-4">
                      <div className="p-2 bg-slate-100 rounded-lg text-slate-500">
                        <Package className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-bold text-slate-900 mb-1">{po.id}</div>
                        <p className="font-medium text-slate-700">{po.desc}</p>
                        <div className="flex items-center gap-3 text-sm text-slate-500 mt-1">
                          <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {po.vendor}</span>
                          <span className="font-medium text-slate-700">{po.amount}</span>
                        </div>
                      </div>
                    </div>
                    <button className="flex items-center gap-1.5 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 rounded-lg font-medium text-sm transition-all shadow-sm">
                      <Send className="w-4 h-4" /> Submit PO
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Group 3: Stalled */}
            <div className="border-l-4 border-l-red-500">
              <div className="bg-red-50/50 px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600" />
                <h3 className="font-semibold text-slate-800 text-sm uppercase tracking-wider">Stalled — Needs Attention</h3>
                <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full ml-auto">2</span>
              </div>
              <div className="divide-y divide-slate-100">
                {[
                  { id: "PO-0031", desc: "Pump Assembly Unit", vendor: "FlowTech Global", amount: "$32,100.00", stalled: "8d" },
                  { id: "PO-0028", desc: "Heavy Crane Rental", vendor: "LiftMaster Pro", amount: "$15,000.00", stalled: "12d" },
                ].map(po => (
                  <div key={po.id} className="p-5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-start gap-4">
                      <div className="p-2 bg-red-50 rounded-lg text-red-500">
                        <AlertCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-slate-900">{po.id}</span>
                          <span className="text-red-700 text-xs font-bold px-2 py-0.5 rounded bg-red-50 border border-red-100">Stalled {po.stalled}</span>
                        </div>
                        <p className="font-medium text-slate-700">{po.desc}</p>
                        <div className="flex items-center gap-3 text-sm text-slate-500 mt-1">
                          <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {po.vendor}</span>
                          <span className="font-medium text-slate-700">{po.amount}</span>
                        </div>
                      </div>
                    </div>
                    <button className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-lg font-medium text-sm transition-all shadow-sm">
                      Review Issue <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* MIDDLE SECTION: Pipeline Summary */}
        <section className="pt-4">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 px-1">Overall Pipeline</h2>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {[
              { label: "Draft", count: 12, color: "slate" },
              { label: "Internal Approval", count: 8, color: "blue", active: true },
              { label: "Client Approval", count: 3, color: "amber" },
              { label: "Released", count: 45, color: "green" },
              { label: "Sent to Supplier", count: 41, color: "indigo" },
              { label: "Acknowledged", count: 28, color: "purple" },
              { label: "In Transit", count: 15, color: "teal" },
              { label: "Received", count: 104, color: "slate" },
            ].map((stage, idx, arr) => (
              <React.Fragment key={stage.label}>
                <div className={`flex flex-col flex-1 min-w-[100px] bg-white rounded-lg border p-3 shadow-sm ${stage.active ? 'border-blue-400 ring-1 ring-blue-100' : 'border-slate-200'}`}>
                  <span className="text-2xl font-bold text-slate-800 leading-none mb-1">{stage.count}</span>
                  <span className={`text-xs font-medium leading-tight ${stage.active ? 'text-blue-700' : 'text-slate-500'}`}>{stage.label}</span>
                </div>
                {idx < arr.length - 1 && (
                  <ArrowRight className="w-4 h-4 text-slate-300 shrink-0 mx-1" />
                )}
              </React.Fragment>
            ))}
          </div>
        </section>

        {/* BOTTOM SECTION: Recent Activity */}
        <section className="pt-4">
          <div className="flex items-center gap-2 mb-4 px-1">
            <History className="w-5 h-5 text-slate-400" />
            <h2 className="text-lg font-semibold text-slate-800">Recent Activity</h2>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200">
            <div className="divide-y divide-slate-100">
              {[
                { id: "PO-0042", desc: "Lumber Supply", action: "Approved by Client", time: "10 mins ago", status: "Client Approved", color: "text-amber-700 bg-amber-50 border-amber-200" },
                { id: "PO-0040", desc: "Plumbing Fixtures", action: "Sent to Supplier", time: "1 hour ago", status: "Sent", color: "text-indigo-700 bg-indigo-50 border-indigo-200" },
                { id: "PO-0038", desc: "Interior Doors", action: "Supplier Acknowledged", time: "3 hours ago", status: "Acknowledged", color: "text-purple-700 bg-purple-50 border-purple-200" },
                { id: "PO-0036", desc: "Lighting Fixtures", action: "Received at Site", time: "Yesterday", status: "Received", color: "text-slate-700 bg-slate-100 border-slate-300" },
                { id: "PO-0035", desc: "Roofing Materials", action: "Released by Procurement", time: "Yesterday", status: "Released", color: "text-green-700 bg-green-50 border-green-200" },
                { id: "PO-0034", desc: "Insulation Boards", action: "Created Draft", time: "2 days ago", status: "Draft", color: "text-slate-600 bg-slate-50 border-slate-200" },
              ].map(activity => (
                <div key={activity.id} className="p-4 flex items-center gap-4 hover:bg-slate-50">
                  <div className="w-12 text-sm font-medium text-slate-400 text-right">{activity.time.split(' ')[0]}</div>
                  <div className="w-2 h-2 rounded-full bg-slate-300"></div>
                  <div className="flex-1 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-800 text-sm">
                        <span className="text-blue-600 hover:underline cursor-pointer">{activity.id}</span> - {activity.desc}
                      </p>
                      <p className="text-sm text-slate-500">{activity.action}</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${activity.color}`}>
                      {activity.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-slate-100 bg-slate-50 rounded-b-xl text-center">
              <button className="text-sm font-medium text-blue-600 hover:text-blue-700">View All Activity</button>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
