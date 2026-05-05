import React from "react";
import { Plus, ArrowRight, AlertTriangle, Check, Clock, ChevronRight } from "lucide-react";

export function PipelineHealth() {
  const stages = [
    { id: 1, name: "Draft", count: 5, health: "green" },
    { id: 2, name: "Pending Approval", count: 3, health: "red" },
    { id: 3, name: "Purchase Order", count: 4, health: "green" },
    { id: 4, name: "PO Review", count: 2, health: "amber" },
    { id: 5, name: "Engineering Review", count: 3, health: "green" },
    { id: 6, name: "Vendor Confirmation", count: 2, health: "amber" },
    { id: 7, name: "Delivery", count: 3, health: "green" },
    { id: 8, name: "Released", count: 8, health: "green" },
  ];

  const pos = [
    { id: "PO-0031", project: "Alpha Refinery", status: "Pending Approval", stageIdx: 1, time: "8 days ago", action: "Approve" },
    { id: "PO-0042", project: "Beta Pipeline", status: "Draft", stageIdx: 0, time: "2 hours ago", action: "Submit" },
    { id: "PO-0045", project: "Delta Storage", status: "PO Review", stageIdx: 3, time: "3 days ago", action: "Review" },
    { id: "PO-0048", project: "Gamma Plant", status: "Vendor Confirmation", stageIdx: 5, time: "4 days ago", action: "Confirm" },
    { id: "PO-0050", project: "Alpha Refinery", status: "Engineering Review", stageIdx: 4, time: "1 day ago", action: "Review" },
    { id: "PO-0052", project: "Zeta Wells", status: "Delivery", stageIdx: 6, time: "12 hours ago", action: "Track" },
    { id: "PO-0053", project: "Beta Pipeline", status: "Draft", stageIdx: 0, time: "1 hour ago", action: "Submit" },
  ];

  const getHealthColors = (health: string) => {
    switch (health) {
      case "green": return "bg-green-500 border-green-500 text-green-700";
      case "amber": return "bg-amber-500 border-amber-500 text-amber-700";
      case "red": return "bg-red-500 border-red-500 text-red-700";
      default: return "bg-slate-500 border-slate-500 text-slate-700";
    }
  };

  const getHealthDot = (health: string) => {
    switch (health) {
      case "green": return "bg-green-500";
      case "amber": return "bg-amber-500";
      case "red": return "bg-red-500";
      default: return "bg-slate-500";
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Order Management</h1>
            <p className="text-slate-500 text-sm mt-1">Pipeline health and active POs</p>
          </div>
          <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm">
            <Plus className="w-4 h-4" />
            New PO
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center">
            <div className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-1">Active POs</div>
            <div className="text-2xl font-semibold text-slate-900">24</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center">
            <div className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-1">Released This Month</div>
            <div className="text-2xl font-semibold text-slate-900">8</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center">
            <div className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-1">Avg Days in Stage</div>
            <div className="text-2xl font-semibold text-slate-900">4.2</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-center">
            <div className="text-red-500 text-xs font-medium uppercase tracking-wider mb-1">Stalled</div>
            <div className="text-2xl font-semibold text-slate-900">3</div>
          </div>
        </div>

        {/* MAIN SECTION — Pipeline Health */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-6 flex items-center gap-2">
            Pipeline Health
          </h2>
          
          <div className="flex items-center justify-between mb-8 overflow-x-auto pb-4">
            {stages.map((stage, idx) => (
              <React.Fragment key={stage.id}>
                <div className={`flex-shrink-0 w-32 bg-slate-50 rounded-lg p-4 border-b-4 flex flex-col items-center justify-center text-center relative ${getHealthColors(stage.health).split(' ')[1]}`}>
                  <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${getHealthDot(stage.health)}`}></div>
                  <div className="text-3xl font-bold text-slate-800 mb-1">{stage.count}</div>
                  <div className="text-xs font-medium text-slate-600 leading-tight">{stage.name}</div>
                </div>
                {idx < stages.length - 1 && (
                  <div className="flex-shrink-0 text-slate-300 mx-2">
                    <ArrowRight className="w-5 h-5" />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-amber-800 font-medium text-sm">Bottleneck Alert</h3>
              <p className="text-amber-700 text-sm mt-0.5">
                <span className="font-semibold">Pending Approval</span> has 3 POs stalled 8+ days — oldest: <a href="#" className="underline font-medium hover:text-amber-900">PO-0031</a>
              </p>
            </div>
          </div>
        </div>

        {/* BOTTOM — PO List */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
            <h2 className="font-semibold text-slate-800">Active Orders</h2>
            <div className="text-sm text-blue-600 font-medium hover:text-blue-700 cursor-pointer flex items-center gap-1">
              View all <ArrowRight className="w-4 h-4" />
            </div>
          </div>
          
          <div className="divide-y divide-slate-100">
            {pos.map((po) => (
              <div key={po.id} className="p-4 hover:bg-slate-50 transition-colors flex items-center gap-4 group">
                <div className="flex gap-1 mr-2 w-24 flex-shrink-0">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div 
                      key={i} 
                      className={`h-1.5 w-1.5 rounded-full ${i <= po.stageIdx ? 'bg-blue-500' : 'bg-slate-200'}`}
                    />
                  ))}
                </div>
                
                <div className="w-24 font-medium text-slate-900">{po.id}</div>
                
                <div className="w-48 text-slate-600 text-sm truncate">{po.project}</div>
                
                <div className="w-40">
                  <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700">
                    {po.status}
                  </span>
                </div>
                
                <div className="w-32 flex items-center gap-1.5 text-sm text-slate-500">
                  <Clock className="w-3.5 h-3.5" />
                  {po.time}
                </div>
                
                <div className="flex-1 flex justify-end">
                  <button className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-sm font-medium text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100">
                    {po.action === 'Approve' && <Check className="w-4 h-4" />}
                    {po.action === 'Submit' && <ArrowRight className="w-4 h-4" />}
                    {po.action === 'Review' && <ChevronRight className="w-4 h-4" />}
                    {po.action === 'Confirm' && <Check className="w-4 h-4" />}
                    {po.action === 'Track' && <ChevronRight className="w-4 h-4" />}
                    {po.action}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
