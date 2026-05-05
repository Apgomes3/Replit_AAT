import React, { useState } from "react";
import { 
  Archive, 
  Clock, 
  CheckCircle2, 
  Square,
  CheckSquare,
  MoreHorizontal,
  ExternalLink,
  Search,
  Plus,
  ArrowRight,
  X,
  Check,
  MessageSquare,
  Mail,
  MailOpen,
  User,
  MoreVertical,
  Reply,
  Forward,
  Star,
  Tag
} from "lucide-react";

interface PO {
  id: string;
  code: string;
  project: string;
  snippet: string;
  amount: number;
  age: string;
  unread: boolean;
  avatar: string;
  avatarColor: string;
  initials: string;
  actionLabel: string;
  vendor: string;
  creator: string;
  status: string;
  timeline: { title: string; time: string; active?: boolean }[];
}

const mockPOs: PO[] = [
  {
    id: "1",
    code: "PO-0041",
    project: "HVAC System",
    snippet: "Awaiting your approval",
    amount: 124500,
    age: "8d",
    unread: true,
    avatar: "JS",
    avatarColor: "bg-blue-100 text-blue-700",
    initials: "JS",
    actionLabel: "Approve ✓",
    vendor: "ClimateTech Inc",
    creator: "J. Smith",
    status: "Awaiting Approval",
    timeline: [
      { title: "Created", time: "10d ago" },
      { title: "Submitted", time: "8d ago" },
      { title: "Awaiting Approval", time: "8d ago", active: true }
    ]
  },
  {
    id: "2",
    code: "PO-0039",
    project: "Steel Structure",
    snippet: "Awaiting your approval",
    amount: 450000,
    age: "5d",
    unread: true,
    avatar: "MK",
    avatarColor: "bg-purple-100 text-purple-700",
    initials: "MK",
    actionLabel: "Approve ✓",
    vendor: "IronWorks Corp",
    creator: "M. Klein",
    status: "Awaiting Approval",
    timeline: [
      { title: "Created", time: "7d ago" },
      { title: "Submitted", time: "5d ago" },
      { title: "Awaiting Approval", time: "5d ago", active: true }
    ]
  },
  {
    id: "3",
    code: "PO-0037",
    project: "Electrical Panels",
    snippet: "Awaiting your approval",
    amount: 85200,
    age: "2d",
    unread: true,
    avatar: "AL",
    avatarColor: "bg-emerald-100 text-emerald-700",
    initials: "AL",
    actionLabel: "Approve ✓",
    vendor: "Volt Systems",
    creator: "A. Lee",
    status: "Awaiting Approval",
    timeline: [
      { title: "Created", time: "4d ago" },
      { title: "Submitted", time: "2d ago" },
      { title: "Awaiting Approval", time: "2d ago", active: true }
    ]
  },
  {
    id: "4",
    code: "PO-0043",
    project: "Concrete Works",
    snippet: "Draft — ready to submit",
    amount: 32000,
    age: "today",
    unread: false,
    avatar: "JD",
    avatarColor: "bg-slate-100 text-slate-700",
    initials: "JD",
    actionLabel: "Submit →",
    vendor: "Solid Foundations",
    creator: "J. Doe",
    status: "Draft",
    timeline: [
      { title: "Created", time: "today", active: true }
    ]
  },
  {
    id: "5",
    code: "PO-0044",
    project: "Safety Equipment",
    snippet: "Draft — ready to submit",
    amount: 15400,
    age: "yest",
    unread: false,
    avatar: "JD",
    avatarColor: "bg-slate-100 text-slate-700",
    initials: "JD",
    actionLabel: "Submit →",
    vendor: "SecureGear Ltd",
    creator: "J. Doe",
    status: "Draft",
    timeline: [
      { title: "Created", time: "yesterday", active: true }
    ]
  },
  {
    id: "6",
    code: "PO-0035",
    project: "Pump Assembly",
    snippet: "PO Review — advance when ready",
    amount: 67800,
    age: "3d",
    unread: false,
    avatar: "MK",
    avatarColor: "bg-purple-100 text-purple-700",
    initials: "MK",
    actionLabel: "Advance →",
    vendor: "Flow Dynamics",
    creator: "M. Klein",
    status: "PO Review",
    timeline: [
      { title: "Created", time: "12d ago" },
      { title: "Submitted", time: "10d ago" },
      { title: "Approved", time: "5d ago" },
      { title: "PO Review", time: "3d ago", active: true }
    ]
  },
  {
    id: "7",
    code: "PO-0033",
    project: "Crane Rental",
    snippet: "Engineering Review — advance when ready",
    amount: 45000,
    age: "1d",
    unread: false,
    avatar: "TR",
    avatarColor: "bg-orange-100 text-orange-700",
    initials: "TR",
    actionLabel: "Advance →",
    vendor: "HeavyLift Inc",
    creator: "T. Rogers",
    status: "Engineering Review",
    timeline: [
      { title: "Created", time: "15d ago" },
      { title: "Submitted", time: "14d ago" },
      { title: "Engineering Review", time: "1d ago", active: true }
    ]
  }
];

export function InboxZero() {
  const [activeTab, setActiveTab] = useState("needs-action");
  const [selectedPOs, setSelectedPOs] = useState<Set<string>>(new Set());
  const [activePOId, setActivePOId] = useState<string>("1");
  const [readPOs, setReadPOs] = useState<Set<string>>(new Set());
  
  const activePO = mockPOs.find(p => p.id === activePOId);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selectedPOs);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedPOs(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedPOs.size === mockPOs.length) {
      setSelectedPOs(new Set());
    } else {
      setSelectedPOs(new Set(mockPOs.map(p => p.id)));
    }
  };

  const handleRowClick = (id: string) => {
    setActivePOId(id);
    const newRead = new Set(readPOs);
    newRead.add(id);
    setReadPOs(newRead);
  };

  const isUnread = (po: PO) => po.unread && !readPOs.has(po.id);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(val);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col overflow-hidden text-slate-900 h-screen">
      
      {/* 1. Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
              OM
            </div>
            <h1 className="text-lg font-semibold text-slate-800">Order Management</h1>
          </div>
          
          <div className="h-6 w-px bg-slate-200"></div>
          
          {/* Pipeline chip strip */}
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
              Draft <span className="bg-slate-200 text-slate-700 px-1.5 rounded-full text-[10px]">5</span>
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              Pending <span className="bg-amber-100 text-amber-800 px-1.5 rounded-full text-[10px]">3</span>
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              PO <span className="bg-blue-100 text-blue-800 px-1.5 rounded-full text-[10px]">4</span>
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
              Review <span className="bg-purple-100 text-purple-800 px-1.5 rounded-full text-[10px]">2</span>
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Search POs..." 
              className="pl-9 pr-4 py-1.5 bg-slate-100 border-none rounded-md text-sm focus:ring-2 focus:ring-blue-500 w-64 outline-none"
            />
          </div>
          <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors shadow-sm">
            <Plus className="w-4 h-4" />
            Compose / New PO
          </button>
        </div>
      </header>

      {/* 2. Progress banner */}
      <div className="bg-blue-50/50 border-b border-blue-100 px-6 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 w-full max-w-4xl mx-auto">
          <span className="text-xs font-medium text-slate-600 whitespace-nowrap">Your queue: <strong className="text-slate-800">7 of 14</strong> handled today</span>
          <div className="flex gap-1 flex-1">
            {[...Array(7)].map((_, i) => (
              <div key={`done-${i}`} className="h-2 flex-1 bg-blue-500 rounded-full"></div>
            ))}
            {[...Array(7)].map((_, i) => (
              <div key={`todo-${i}`} className="h-2 flex-1 bg-slate-200 rounded-full"></div>
            ))}
          </div>
          <span className="text-xs font-bold text-blue-600 whitespace-nowrap">50% Complete</span>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        
        {/* LEFT PANEL: Inbox List */}
        <div className="w-[45%] flex flex-col bg-white border-r border-slate-200 z-10 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)]">
          
          {/* 3. THREE-TAB ROW */}
          <div className="flex px-4 pt-3 border-b border-slate-200 gap-6 shrink-0 bg-slate-50/50">
            <button 
              className={`pb-3 text-sm font-medium border-b-2 transition-colors relative ${activeTab === 'needs-action' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              onClick={() => setActiveTab('needs-action')}
            >
              Needs Action 
              <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === 'needs-action' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>7</span>
            </button>
            <button 
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'waiting' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              onClick={() => setActiveTab('waiting')}
            >
              Waiting on Others
              <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === 'waiting' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>12</span>
            </button>
            <button 
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'done' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              onClick={() => setActiveTab('done')}
            >
              Done
              <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === 'done' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>8</span>
            </button>
          </div>

          {/* Toolbar row */}
          <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white sticky top-0 z-10 shadow-sm">
            <div className="flex items-center gap-4">
              <button onClick={toggleSelectAll} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
                {selectedPOs.size === mockPOs.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              </button>
              
              <div className="flex items-center gap-1 border-l border-slate-200 pl-4">
                <button className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors" title="Archive">
                  <Archive className="w-4 h-4" />
                </button>
                <button className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors" title="Snooze">
                  <Clock className="w-4 h-4" />
                </button>
                <button className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors" title="Mark as read">
                  <MailOpen className="w-4 h-4" />
                </button>
                <button className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors" title="More">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            <div className="text-xs text-slate-500">
              1-7 of 7
            </div>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto bg-white">
            {mockPOs.map(po => {
              const unread = isUnread(po);
              const isActive = activePOId === po.id;
              const isSelected = selectedPOs.has(po.id);
              
              return (
                <div 
                  key={po.id}
                  onClick={() => handleRowClick(po.id)}
                  className={`
                    group flex items-center px-4 py-3 border-b border-slate-100 cursor-pointer transition-colors relative
                    ${isActive ? 'bg-blue-50 border-l-4 border-l-blue-600 pr-3' : 'hover:bg-slate-50 border-l-4 border-l-transparent pr-4'}
                    ${unread ? 'bg-white' : 'bg-slate-50/30'}
                  `}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button 
                      onClick={(e) => toggleSelect(po.id, e)}
                      className={`shrink-0 transition-colors p-1 -ml-1 ${isSelected ? 'text-blue-600' : 'text-slate-300 group-hover:text-slate-400'}`}
                    >
                      {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </button>
                    
                    <button className="shrink-0 text-slate-300 hover:text-amber-400 p-1 -ml-1 transition-colors">
                      <Star className="w-4 h-4" />
                    </button>
                    
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${po.avatarColor}`}>
                      {po.initials}
                    </div>
                    
                    <div className="flex flex-col min-w-0 flex-1 ml-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-sm truncate ${unread ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>
                          {po.code} <span className="text-slate-400 font-normal mx-0.5">·</span> {po.project}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs truncate">
                        <span className={`${unread ? 'font-medium text-slate-800' : 'text-slate-500'} truncate`}>
                          {po.snippet}
                        </span>
                        <span className="text-slate-400 shrink-0">·</span>
                        <span className={`${unread ? 'font-medium text-slate-700' : 'text-slate-500'} shrink-0`}>
                          {formatCurrency(po.amount)}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <span className={`text-xs ${unread ? 'font-bold text-blue-600' : 'text-slate-400'}`}>
                      {po.age}
                    </span>
                    
                    <div className={`
                      opacity-0 group-hover:opacity-100 transition-opacity absolute right-4 bg-white/90 backdrop-blur-sm
                      px-2 py-1 flex items-center gap-1 shadow-sm rounded-md border border-slate-200
                      ${isActive ? 'opacity-100 bg-blue-50/90 border-blue-200' : ''}
                    `}>
                      <span className="text-[10px] font-medium text-slate-600 uppercase tracking-wider pr-1 border-r border-slate-200 mr-1">Quick Action</span>
                      <button className="text-xs font-medium text-blue-700 hover:text-blue-800 hover:bg-blue-100 px-2 py-0.5 rounded transition-colors">
                        {po.actionLabel}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT PANEL: Reading Pane */}
        {activePO ? (
          <div className="w-[55%] flex flex-col bg-white">
            
            {/* Reading Pane Toolbar */}
            <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Mail className="w-4 h-4" />
                <span>PO Thread</span>
              </div>
              <div className="flex items-center gap-2">
                <button className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors" title="Reply">
                  <Reply className="w-4 h-4" />
                </button>
                <button className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors" title="Forward">
                  <Forward className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-slate-200 mx-1"></div>
                <button className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors" title="Archive">
                  <Archive className="w-4 h-4" />
                </button>
                <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded transition-colors ml-2 border border-slate-200">
                  Open full view <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-8 py-8">
                
                {/* Header Section */}
                <div className="mb-8">
                  <div className="flex items-start justify-between mb-4">
                    <h2 className="text-2xl font-bold text-slate-900 leading-tight">
                      {activePO.code} · {activePO.project}
                    </h2>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 whitespace-nowrap">
                      {activePO.status}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-4 bg-slate-50 rounded-lg p-4 border border-slate-100">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${activePO.avatarColor}`}>
                      {activePO.initials}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-baseline justify-between">
                        <div className="font-semibold text-slate-900">{activePO.creator}</div>
                        <div className="text-sm text-slate-500">{activePO.age}</div>
                      </div>
                      <div className="text-sm text-slate-600">to Me, Procurement Team</div>
                    </div>
                  </div>
                </div>

                {/* Details Section */}
                <div className="mb-8 grid grid-cols-2 gap-6 bg-white rounded-lg border border-slate-200 p-6 shadow-sm">
                  <div>
                    <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Vendor</div>
                    <div className="text-base font-medium text-slate-900 flex items-center gap-2">
                      {activePO.vendor}
                      <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Total Amount</div>
                    <div className="text-xl font-bold text-slate-900">{formatCurrency(activePO.amount)}</div>
                  </div>
                  <div className="col-span-2 pt-4 border-t border-slate-100">
                    <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Line Items (3)</div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm py-1 border-b border-dashed border-slate-200">
                        <span className="text-slate-700">1x Main HVAC Unit - Industrial</span>
                        <span className="font-medium">$85,000</span>
                      </div>
                      <div className="flex justify-between text-sm py-1 border-b border-dashed border-slate-200">
                        <span className="text-slate-700">2x Auxiliary Circulation Pumps</span>
                        <span className="font-medium">$24,500</span>
                      </div>
                      <div className="flex justify-between text-sm py-1 border-b border-dashed border-slate-200">
                        <span className="text-slate-700">Installation & Commissioning</span>
                        <span className="font-medium">$15,000</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Timeline */}
                <div className="mb-10 pl-2">
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-4">Activity</div>
                  <div className="relative border-l-2 border-slate-200 ml-3 space-y-6 pb-2">
                    {activePO.timeline.map((event, idx) => (
                      <div key={idx} className="relative pl-6">
                        <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 bg-white ${event.active ? 'border-blue-600 bg-blue-100' : 'border-slate-300'}`}></div>
                        <div className="flex justify-between items-start">
                          <div>
                            <div className={`text-sm ${event.active ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                              {event.title}
                            </div>
                            {event.active && (
                              <div className="text-sm text-slate-600 mt-1 bg-slate-50 p-3 rounded-md border border-slate-100 inline-block">
                                <span className="font-medium">System note:</span> Required approval from Procurement Manager.
                              </div>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 font-medium">{event.time}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Reply / Action Area */}
                <div className="mt-8 bg-slate-50 rounded-xl border border-slate-200 p-5 shadow-sm">
                  <textarea 
                    className="w-full bg-white border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none mb-4"
                    rows={3}
                    placeholder="Add an internal note or reply to creator..."
                  ></textarea>
                  
                  <div className="flex items-center justify-between">
                    <button className="text-sm text-slate-600 hover:text-slate-900 font-medium flex items-center gap-2">
                      <Tag className="w-4 h-4" /> Add Tags
                    </button>
                    
                    <div className="flex items-center gap-3">
                      <button className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors shadow-sm flex items-center gap-2">
                        <X className="w-4 h-4" /> Reject
                      </button>
                      <button className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2">
                        <Check className="w-4 h-4" /> Approve this PO
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        ) : (
          <div className="w-[55%] flex flex-col items-center justify-center bg-slate-50 text-slate-400">
            <Mail className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg font-medium text-slate-500">Select an item to read</p>
            <p className="text-sm mt-1">Nothing is selected in the inbox.</p>
          </div>
        )}

      </div>
    </div>
  );
}
