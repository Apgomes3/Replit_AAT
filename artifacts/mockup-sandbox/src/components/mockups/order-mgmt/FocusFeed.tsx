import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  Bell, 
  ChevronDown, 
  ChevronRight, 
  CheckCircle2, 
  XCircle, 
  ArrowRight,
  Clock,
  CircleDashed,
  Eye,
  FileText
} from 'lucide-react';

export function FocusFeed() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    watching: true,
  });

  const toggleSection = (id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const pipeline = [
    { label: "Draft", count: 5, color: "bg-slate-100 text-slate-700" },
    { label: "Pending", count: 3, color: "bg-slate-100 text-slate-700" },
    { label: "PO", count: 4, color: "bg-slate-100 text-slate-700" },
    { label: "Review", count: 2, color: "bg-amber-100 text-amber-800" },
    { label: "Eng", count: 3, color: "bg-blue-100 text-blue-800" },
    { label: "Vendor", count: 2, color: "bg-indigo-100 text-indigo-800" },
    { label: "Delivery", count: 3, color: "bg-purple-100 text-purple-800" },
    { label: "Released", count: 8, color: "bg-emerald-100 text-emerald-800" },
  ];

  const teamActivity = [
    { id: 1, user: "JS", color: "bg-blue-100 text-blue-700", action: "PO-0040 approved by J. Smith", time: "2h ago" },
    { id: 2, user: "MK", color: "bg-purple-100 text-purple-700", action: "PO-0038 advanced to PO Review", time: "4h ago" },
    { id: 3, user: "AL", color: "bg-emerald-100 text-emerald-700", action: "PO-0036 submitted for approval", time: "6h ago" },
    { id: 4, user: "JS", color: "bg-blue-100 text-blue-700", action: "PO-0034 approved by J. Smith", time: "1d ago" },
    { id: 5, user: "MK", color: "bg-purple-100 text-purple-700", action: "PO-0032 advanced to Delivery", time: "1d ago" },
    { id: 6, user: "AL", color: "bg-emerald-100 text-emerald-700", action: "New PO PO-0044 created", time: "2d ago" },
    { id: 7, user: "JS", color: "bg-blue-100 text-blue-700", action: "PO-0031 rejected by J. Smith", time: "2d ago" },
    { id: 8, user: "TR", color: "bg-orange-100 text-orange-700", action: "PO-0030 advanced to Eng", time: "3d ago" },
    { id: 9, user: "AL", color: "bg-emerald-100 text-emerald-700", action: "PO-0028 submitted for approval", time: "3d ago" },
    { id: 10, user: "MK", color: "bg-purple-100 text-purple-700", action: "PO-0027 delivered", time: "4d ago" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Order Management</h1>
            <p className="text-sm text-slate-500 mt-1">Focus & Activity Feed</p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search POs..." 
                className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-64"
              />
            </div>
            
            <button className="relative p-2 text-slate-500 hover:bg-white hover:text-slate-700 rounded-full transition-colors border border-transparent hover:border-slate-200">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-slate-50"></span>
            </button>
            
            <div className="w-9 h-9 bg-slate-200 rounded-full border-2 border-white shadow-sm flex items-center justify-center text-sm font-medium text-slate-600">
              JD
            </div>
            
            <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm">
              <Plus className="w-4 h-4" />
              New PO
            </button>
          </div>
        </header>

        {/* Pipeline Strip */}
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-2 overflow-x-auto">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2">Pipeline</span>
          <div className="w-px h-4 bg-slate-200 mx-2"></div>
          {pipeline.map((stage, idx) => (
            <button key={idx} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-slate-50 transition-colors group border border-transparent hover:border-slate-200">
              <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">{stage.label}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${stage.color}`}>
                {stage.count}
              </span>
            </button>
          ))}
        </div>

        {/* Main Two-Column Layout */}
        <div className="grid grid-cols-12 gap-6">
          
          {/* Left Column - My Focus (approx 60%) */}
          <div className="col-span-12 lg:col-span-7 xl:col-span-8 space-y-6">
            
            {/* Needs Approval */}
            <div className="space-y-3">
              <button 
                onClick={() => toggleSection('approval')}
                className="flex items-center gap-2 w-full text-left group"
              >
                {collapsed['approval'] ? (
                  <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-slate-600" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-400 group-hover:text-slate-600" />
                )}
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <h2 className="text-base font-semibold text-slate-900">Needs Your Approval <span className="text-slate-400 font-normal ml-1">(3)</span></h2>
              </button>
              
              {!collapsed['approval'] && (
                <div className="space-y-3 pl-7">
                  {/* Card 1 */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-blue-500 flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">PO-0041</span>
                        <span className="text-sm text-slate-600 font-medium">— HVAC System</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1 text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-md">
                          <Clock className="w-3 h-3" />
                          8d waiting
                        </span>
                        <span>Total: $124,500</span>
                        <span>Vendor: ClimateTech Inc</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1">
                        <XCircle className="w-4 h-4" /> Reject
                      </button>
                      <button className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1 shadow-sm">
                        <CheckCircle2 className="w-4 h-4" /> Approve
                      </button>
                    </div>
                  </div>

                  {/* Card 2 */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-blue-500 flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">PO-0039</span>
                        <span className="text-sm text-slate-600 font-medium">— Steel Structure</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1 text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-md">
                          <Clock className="w-3 h-3" />
                          5d waiting
                        </span>
                        <span>Total: $450,000</span>
                        <span>Vendor: BuildSteel Co</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1">
                        <XCircle className="w-4 h-4" /> Reject
                      </button>
                      <button className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1 shadow-sm">
                        <CheckCircle2 className="w-4 h-4" /> Approve
                      </button>
                    </div>
                  </div>

                  {/* Card 3 */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-blue-500 flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">PO-0037</span>
                        <span className="text-sm text-slate-600 font-medium">— Electrical Panels</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1 text-slate-600 font-medium bg-slate-100 px-2 py-0.5 rounded-md">
                          <Clock className="w-3 h-3" />
                          2d waiting
                        </span>
                        <span>Total: $85,200</span>
                        <span>Vendor: ElectroSys</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1">
                        <XCircle className="w-4 h-4" /> Reject
                      </button>
                      <button className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1 shadow-sm">
                        <CheckCircle2 className="w-4 h-4" /> Approve
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Ready to Submit */}
            <div className="space-y-3 mt-8">
              <button 
                onClick={() => toggleSection('submit')}
                className="flex items-center gap-2 w-full text-left group"
              >
                {collapsed['submit'] ? (
                  <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-slate-600" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-400 group-hover:text-slate-600" />
                )}
                <div className="w-2 h-2 rounded-full bg-slate-400"></div>
                <h2 className="text-base font-semibold text-slate-900">Ready to Submit <span className="text-slate-400 font-normal ml-1">(2)</span></h2>
              </button>
              
              {!collapsed['submit'] && (
                <div className="space-y-3 pl-7">
                  {/* Card 1 */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-slate-400 flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">PO-0043</span>
                        <span className="text-sm text-slate-600 font-medium">— Concrete Works</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1 text-slate-600 font-medium bg-slate-100 px-2 py-0.5 rounded-md">
                          <FileText className="w-3 h-3" />
                          draft
                        </span>
                        <span>Created: Today</span>
                        <span>Missing: 1 attachment</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 rounded-lg transition-colors flex items-center gap-1 shadow-sm">
                        <ArrowRight className="w-4 h-4" /> Submit
                      </button>
                    </div>
                  </div>

                  {/* Card 2 */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-slate-400 flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">PO-0044</span>
                        <span className="text-sm text-slate-600 font-medium">— Safety Equipment</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1 text-slate-600 font-medium bg-slate-100 px-2 py-0.5 rounded-md">
                          <FileText className="w-3 h-3" />
                          draft
                        </span>
                        <span>Created: Yesterday</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 rounded-lg transition-colors flex items-center gap-1 shadow-sm">
                        <ArrowRight className="w-4 h-4" /> Submit
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Advance Stage */}
            <div className="space-y-3 mt-8">
              <button 
                onClick={() => toggleSection('advance')}
                className="flex items-center gap-2 w-full text-left group"
              >
                {collapsed['advance'] ? (
                  <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-slate-600" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-400 group-hover:text-slate-600" />
                )}
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <h2 className="text-base font-semibold text-slate-900">Advance Stage <span className="text-slate-400 font-normal ml-1">(2)</span></h2>
              </button>
              
              {!collapsed['advance'] && (
                <div className="space-y-3 pl-7">
                  {/* Card 1 */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-blue-500 flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">PO-0035</span>
                        <span className="text-sm text-slate-600 font-medium">— Pump Assembly</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1 text-amber-700 font-medium bg-amber-100 px-2 py-0.5 rounded-md">
                          <CircleDashed className="w-3 h-3" />
                          PO Review
                        </span>
                        <span>Ready for Eng Review</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 rounded-lg transition-colors flex items-center gap-1 shadow-sm">
                        Advance <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Card 2 */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-l-4 border-l-blue-500 flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">PO-0033</span>
                        <span className="text-sm text-slate-600 font-medium">— Crane Rental</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1 text-blue-700 font-medium bg-blue-100 px-2 py-0.5 rounded-md">
                          <CircleDashed className="w-3 h-3" />
                          Engineering Review
                        </span>
                        <span>Approved by MK</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-900 rounded-lg transition-colors flex items-center gap-1 shadow-sm">
                        Advance <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Watching */}
            <div className="space-y-3 mt-8">
              <button 
                onClick={() => toggleSection('watching')}
                className="flex items-center gap-2 w-full text-left group"
              >
                {collapsed['watching'] ? (
                  <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-slate-600" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-400 group-hover:text-slate-600" />
                )}
                <div className="w-2 h-2 rounded-full bg-slate-300"></div>
                <h2 className="text-base font-semibold text-slate-600">Watching <span className="text-slate-400 font-normal ml-1">(4)</span></h2>
              </button>
              
              {!collapsed['watching'] && (
                <div className="space-y-3 pl-7">
                  <div className="bg-slate-100/50 p-4 rounded-xl border border-slate-200/60 shadow-sm flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 opacity-80">
                        <span className="text-sm font-bold text-slate-700">PO-0030</span>
                        <span className="text-sm text-slate-500 font-medium">— Scaffolding Services</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="text-indigo-600 font-medium bg-indigo-50 px-2 py-0.5 rounded-md">Vendor</span>
                      </div>
                    </div>
                    <button className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors">
                      <Eye className="w-5 h-5" />
                    </button>
                  </div>
                  {/* Additional watching items could go here */}
                  <div className="text-sm text-slate-500 pl-2">
                    + 3 more items (PO-0028, PO-0026, PO-0024)
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Right Column - Team Feed (approx 40%) */}
          <div className="col-span-12 lg:col-span-5 xl:col-span-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden sticky top-6">
              
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <div className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </div>
                  <h3 className="font-semibold text-slate-900">Team Activity</h3>
                </div>
                <button className="text-xs font-medium text-blue-600 hover:text-blue-700">
                  Filter
                </button>
              </div>

              <div className="divide-y divide-slate-100 max-h-[calc(100vh-250px)] overflow-y-auto">
                {teamActivity.map((item) => (
                  <div key={item.id} className="px-5 py-3.5 hover:bg-slate-50 transition-colors flex items-start gap-3 group cursor-pointer">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${item.color}`}>
                      {item.user}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700 group-hover:text-slate-900 leading-snug">
                        {item.action}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        {item.time}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50/50">
                <button className="w-full py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors flex items-center justify-center gap-1">
                  View full history <ArrowRight className="w-4 h-4" />
                </button>
              </div>
              
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
