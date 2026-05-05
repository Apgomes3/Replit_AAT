import React, { useState } from 'react';
import { 
  ChevronRight, 
  Clock, 
  AlertCircle, 
  AlertTriangle,
  Calendar,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Settings,
  Check,
  X,
  ArrowRight,
  FileText,
  MoreHorizontal
} from 'lucide-react';
import { Button } from "@/components/ui/button";

export function DailyDigest() {
  const [agingOpen, setAgingOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6 font-sans max-w-4xl mx-auto text-slate-900">
      
      {/* 1. GREETING BANNER */}
      <div className="mb-8 rounded-2xl bg-gradient-to-br from-white to-blue-50/50 p-6 shadow-sm border border-slate-200/60">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900 mb-2">
          Good morning, Jamie <span className="text-xl">👋</span>
        </h1>
        <p className="text-slate-600 mb-6 font-medium">
          Tuesday, May 5 &middot; <span className="text-slate-900 font-semibold">9 of your 24 active POs</span> need attention today
        </p>
        
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-100/50 text-blue-800 rounded-full text-sm font-medium border border-blue-200/50">
            <span className="w-2 h-2 rounded-full bg-blue-600"></span>
            7 actions needed
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-full text-sm font-medium border border-slate-200/50">
            <span className="w-2 h-2 rounded-full bg-slate-400"></span>
            12 in progress
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-sm font-medium border border-emerald-200/50">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            8 completed this week
          </div>
        </div>
      </div>

      {/* 2. PIPELINE STRIP */}
      <div className="mb-10 flex items-center justify-between px-2 overflow-x-auto pb-2 scrollbar-hide">
        <div className="flex items-center space-x-2 text-sm font-medium text-slate-500 whitespace-nowrap">
          <span className="flex items-center gap-1.5 text-slate-900"><div className="w-5 h-5 rounded flex items-center justify-center bg-slate-200 text-xs">2</div> Drafts</span>
          <ChevronRight className="w-4 h-4 text-slate-300" />
          <span className="flex items-center gap-1.5 text-blue-600"><div className="w-5 h-5 rounded flex items-center justify-center bg-blue-100 text-xs">4</div> In Review</span>
          <ChevronRight className="w-4 h-4 text-slate-300" />
          <span className="flex items-center gap-1.5"><div className="w-5 h-5 rounded flex items-center justify-center bg-slate-100 text-xs">7</div> Approved</span>
          <ChevronRight className="w-4 h-4 text-slate-300" />
          <span className="flex items-center gap-1.5"><div className="w-5 h-5 rounded flex items-center justify-center bg-slate-100 text-xs">3</div> Sent</span>
          <ChevronRight className="w-4 h-4 text-slate-300" />
          <span className="flex items-center gap-1.5"><div className="w-5 h-5 rounded flex items-center justify-center bg-slate-100 text-xs">8</div> Received</span>
        </div>
      </div>

      <div className="space-y-6">
        
        {/* 3. SECTION: Overdue */}
        <div className="relative rounded-xl bg-red-50/50 border border-red-100 overflow-hidden shadow-sm">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500"></div>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 text-red-700 font-semibold mb-4">
              <AlertCircle className="w-5 h-5" />
              <h2 className="text-lg">Act Now &mdash; Overdue</h2>
              <span className="ml-2 text-sm font-medium bg-red-100 px-2 py-0.5 rounded-full">2</span>
            </div>
            
            <div className="space-y-3">
              <div className="bg-white rounded-lg p-3 md:p-4 border border-red-100 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors hover:border-red-200">
                <div className="flex items-start gap-4">
                  <div className="hidden md:flex p-2 bg-red-50 text-red-600 rounded-md">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-900">PO-0031</span>
                      <span className="text-slate-400">&middot;</span>
                      <span className="font-medium text-slate-700">Safety Equipment</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-slate-500">
                      <span className="flex items-center gap-1 text-red-600 font-medium">
                        <Clock className="w-3.5 h-3.5" /> Due yesterday
                      </span>
                      <span>&middot;</span>
                      <span>$15,200</span>
                    </div>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="text-slate-700 border-slate-300 hover:bg-slate-50 md:w-auto w-full">
                  Advance <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </div>

              <div className="bg-white rounded-lg p-3 md:p-4 border border-red-100 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors hover:border-red-200">
                <div className="flex items-start gap-4">
                  <div className="hidden md:flex p-2 bg-red-50 text-red-600 rounded-md">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-900">PO-0028</span>
                      <span className="text-slate-400">&middot;</span>
                      <span className="font-medium text-slate-700">Scaffolding</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-slate-500">
                      <span className="flex items-center gap-1 text-red-600 font-medium">
                        <Clock className="w-3.5 h-3.5" /> 2 days overdue
                      </span>
                      <span>&middot;</span>
                      <span>$42,000</span>
                    </div>
                  </div>
                </div>
                <Button size="sm" variant="outline" className="text-slate-700 border-slate-300 hover:bg-slate-50 md:w-auto w-full">
                  Advance <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* 4. SECTION: Due Today */}
        <div className="relative rounded-xl bg-amber-50/50 border border-amber-100 overflow-hidden shadow-sm">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400"></div>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 text-amber-700 font-semibold mb-4">
              <AlertTriangle className="w-5 h-5" />
              <h2 className="text-lg">Due Today</h2>
              <span className="ml-2 text-sm font-medium bg-amber-100 px-2 py-0.5 rounded-full">3</span>
            </div>
            
            <div className="space-y-3">
              <div className="bg-white rounded-lg p-3 md:p-4 border border-amber-100 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors hover:border-amber-200">
                <div className="flex items-start gap-4">
                  <div className="hidden md:flex p-2 bg-amber-50 text-amber-600 rounded-md">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-900">PO-0041</span>
                      <span className="text-slate-400">&middot;</span>
                      <span className="font-medium text-slate-700">HVAC System</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-slate-500">
                      <span className="flex items-center gap-1 text-amber-700 font-medium">
                        Approval pending 8d
                      </span>
                      <span>&middot;</span>
                      <span>$124,500</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="text-slate-600 border-slate-200 hover:bg-slate-50">
                    <X className="w-4 h-4 mr-1.5" /> Reject
                  </Button>
                  <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white shadow-none">
                    <Check className="w-4 h-4 mr-1.5" /> Approve
                  </Button>
                </div>
              </div>

              <div className="bg-white rounded-lg p-3 md:p-4 border border-amber-100 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors hover:border-amber-200">
                <div className="flex items-start gap-4">
                  <div className="hidden md:flex p-2 bg-amber-50 text-amber-600 rounded-md">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-900">PO-0039</span>
                      <span className="text-slate-400">&middot;</span>
                      <span className="font-medium text-slate-700">Steel Structure</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-slate-500">
                      <span className="flex items-center gap-1 text-amber-700 font-medium">
                        Approval pending 5d
                      </span>
                      <span>&middot;</span>
                      <span>$450,000</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="text-slate-600 border-slate-200 hover:bg-slate-50">
                    <X className="w-4 h-4 mr-1.5" /> Reject
                  </Button>
                  <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white shadow-none">
                    <Check className="w-4 h-4 mr-1.5" /> Approve
                  </Button>
                </div>
              </div>
              
              <div className="bg-white rounded-lg p-3 md:p-4 border border-amber-100 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors hover:border-amber-200">
                <div className="flex items-start gap-4">
                  <div className="hidden md:flex p-2 bg-slate-50 text-slate-500 rounded-md">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-900">PO-0043</span>
                      <span className="text-slate-400">&middot;</span>
                      <span className="font-medium text-slate-700">Concrete Works</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-slate-500">
                      <span className="flex items-center gap-1 text-slate-600 font-medium">
                        Draft &middot; ready to submit
                      </span>
                      <span>&middot;</span>
                      <span>$89,000</span>
                    </div>
                  </div>
                </div>
                <Button size="sm" className="bg-slate-800 hover:bg-slate-900 text-white shadow-none md:w-auto w-full">
                  Submit <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* 5. SECTION: Your Approvals */}
        <div className="relative rounded-xl bg-blue-50/40 border border-blue-100 overflow-hidden shadow-sm">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500"></div>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 text-blue-800 font-semibold mb-1">
              <Check className="w-5 h-5" />
              <h2 className="text-lg">Your Approvals Pending</h2>
              <span className="ml-2 text-sm font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">3</span>
            </div>
            <p className="text-sm text-blue-600/80 mb-4 pl-7">These have been waiting an average of 5 days for your decision.</p>
            
            <div className="space-y-3">
              {[
                { id: "PO-0041", name: "HVAC System", amount: "$124,500", wait: "8d" },
                { id: "PO-0039", name: "Steel Structure", amount: "$450,000", wait: "5d" },
                { id: "PO-0035", name: "Site Fencing", amount: "$24,000", wait: "2d" }
              ].map((po) => (
                <div key={po.id} className="bg-white rounded-lg p-3 md:p-4 border border-blue-100 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors hover:border-blue-200 group">
                  <div className="flex items-start gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-slate-900">{po.id}</span>
                        <span className="text-slate-400">&middot;</span>
                        <span className="font-medium text-slate-700">{po.name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-slate-500">
                        <span>Waiting {po.wait}</span>
                        <span>&middot;</span>
                        <span>{po.amount}</span>
                      </div>
                    </div>
                  </div>
                  <button className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center group-hover:underline md:self-auto self-start">
                    Review &amp; decide <ArrowRight className="w-4 h-4 ml-1" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 6. SECTION: Aging */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <button 
            onClick={() => setAgingOpen(!agingOpen)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 transition-colors focus:outline-none"
          >
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-slate-400" />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-700">Aging &mdash; No activity for 7+ days</h2>
                  <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">4</span>
                </div>
                <p className="text-sm text-slate-500 mt-0.5">Oldest: PO-0027 Concrete Works (12d) &mdash; <span className="text-blue-600 hover:underline">Review stalled POs</span></p>
              </div>
            </div>
            {agingOpen ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
          </button>
          
          {agingOpen && (
            <div className="px-5 pb-5 pt-1 border-t border-slate-100">
              <div className="space-y-2 mt-3">
                {[
                  { id: "PO-0027", name: "Concrete Works", status: "In Review", days: 12 },
                  { id: "PO-0029", name: "Earthmoving", status: "Draft", days: 9 },
                  { id: "PO-0030", name: "Temporary Power", status: "Approved", days: 8 },
                  { id: "PO-0033", name: "Plumbing Fixtures", status: "In Review", days: 7 }
                ].map((po) => (
                  <div key={po.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-slate-700">{po.id}</span>
                      <span className="text-slate-500">{po.name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-slate-500">
                      <span>{po.status}</span>
                      <span className="text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded">{po.days}d</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 7. SECTION: New Since Yesterday */}
        <div className="rounded-xl bg-slate-50 border border-slate-200/60 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-slate-700 font-semibold mb-4">
            <Sparkles className="w-5 h-5 text-slate-400" />
            <h2 className="text-lg">New Since Yesterday</h2>
            <span className="ml-2 text-sm font-medium bg-slate-200/50 text-slate-600 px-2 py-0.5 rounded-full">6</span>
          </div>
          
          <div className="space-y-1">
            {[
              { id: "PO-0044", name: "Lumber Supply", creator: "Sarah J.", action: "Created draft" },
              { id: "PO-0045", name: "Roofing Materials", creator: "Mike T.", action: "Submitted for review" },
              { id: "PO-0046", name: "Paint & Supplies", creator: "Elena G.", action: "Created draft" },
              { id: "PO-0047", name: "Windows", creator: "David L.", action: "Approved" },
              { id: "PO-0048", name: "Doors", creator: "Sarah J.", action: "Created draft" },
              { id: "PO-0049", name: "Lighting Fixtures", creator: "Mike T.", action: "Submitted for review" }
            ].map((po) => (
              <div key={po.id} className="flex items-center justify-between py-2.5 px-3 hover:bg-white rounded-lg transition-colors group">
                <div className="flex items-center gap-3 w-1/2">
                  <span className="font-medium text-slate-900">{po.id}</span>
                  <span className="text-slate-600 truncate">{po.name}</span>
                </div>
                <div className="flex items-center gap-4 text-sm w-1/2 justify-between">
                  <span className="text-slate-500 hidden sm:inline-block">{po.creator}</span>
                  <span className="text-slate-500">{po.action}</span>
                  <button className="text-slate-400 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* 8. FOOTER */}
      <div className="mt-12 text-center pb-8">
        <p className="text-slate-400 text-sm flex items-center justify-center gap-4">
          <span>Next check-in reminder: 4:00 PM</span>
          <span>&middot;</span>
          <button className="hover:text-slate-600 flex items-center gap-1 transition-colors">
            <Settings className="w-3.5 h-3.5" />
            Set daily digest time
          </button>
        </p>
      </div>

    </div>
  );
}
