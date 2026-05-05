import React, { useState } from 'react';
import { Plus, AlertTriangle, ArrowRight, Check, X, Clock, FileText, ChevronDown, Filter, Search, MoreHorizontal } from 'lucide-react';

type POCard = {
  id: string;
  code: string;
  project: string;
  amount: number;
  age: number;
  status: 'green' | 'amber' | 'red';
  action: 'approve' | 'advance';
};

type Column = {
  id: string;
  title: string;
  health: 'green' | 'amber' | 'red';
  oldestAge: number;
  count: number;
  cards: POCard[];
  isBottleneck?: boolean;
  stalledCount?: number;
};

const MOCK_COLUMNS: Column[] = [
  {
    id: 'pending_approval',
    title: 'Pending Approval',
    health: 'red',
    oldestAge: 8,
    count: 3,
    isBottleneck: true,
    stalledCount: 3,
    cards: [
      { id: '1', code: 'PO-0041', project: 'HVAC System', amount: 124500, age: 8, status: 'red', action: 'approve' },
      { id: '2', code: 'PO-0039', project: 'Steel Structure', amount: 450000, age: 7, status: 'red', action: 'approve' },
      { id: '3', code: 'PO-0037', project: 'Electrical Panels', amount: 85200, age: 5, status: 'amber', action: 'approve' },
    ]
  },
  {
    id: 'purchase_order',
    title: 'Purchase Order',
    health: 'green',
    oldestAge: 2,
    count: 2,
    cards: [
      { id: '4', code: 'PO-0035', project: 'Pump Assembly', amount: 67000, age: 2, status: 'green', action: 'advance' },
      { id: '5', code: 'PO-0033', project: 'Crane Rental', amount: 28500, age: 1, status: 'green', action: 'advance' },
    ]
  },
  {
    id: 'po_review',
    title: 'PO Review',
    health: 'amber',
    oldestAge: 4,
    count: 2,
    cards: [
      { id: '6', code: 'PO-0031', project: 'Safety Equipment', amount: 15200, age: 4, status: 'amber', action: 'advance' },
      { id: '7', code: 'PO-0029', project: 'Scaffolding', amount: 42000, age: 3, status: 'amber', action: 'advance' },
    ]
  },
  {
    id: 'eng_review',
    title: 'Engineering Review',
    health: 'green',
    oldestAge: 2,
    count: 3,
    cards: [
      { id: '8', code: 'PO-0027', project: 'Concrete Works', amount: 189000, age: 2, status: 'green', action: 'advance' },
      { id: '9', code: 'PO-0025', project: 'Steel Beams', amount: 330000, age: 2, status: 'green', action: 'advance' },
      { id: '10', code: 'PO-0023', project: 'Lighting', amount: 28000, age: 1, status: 'green', action: 'advance' },
    ]
  },
  {
    id: 'vendor_conf',
    title: 'Vendor Confirmation',
    health: 'green',
    oldestAge: 2,
    count: 1,
    cards: [
      { id: '11', code: 'PO-0021', project: 'Excavator', amount: 95000, age: 2, status: 'green', action: 'advance' },
    ]
  },
  {
    id: 'delivery',
    title: 'Delivery',
    health: 'green',
    oldestAge: 1,
    count: 2,
    cards: [
      { id: '12', code: 'PO-0019', project: 'Fire Suppression', amount: 67200, age: 1, status: 'green', action: 'advance' },
      { id: '13', code: 'PO-0017', project: 'Insulation', amount: 23000, age: 1, status: 'green', action: 'advance' },
    ]
  }
];

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
};

const getHealthColor = (health: 'green' | 'amber' | 'red') => {
  switch (health) {
    case 'green': return 'bg-emerald-500';
    case 'amber': return 'bg-amber-500';
    case 'red': return 'bg-rose-500';
    default: return 'bg-slate-500';
  }
};

const getHealthBorder = (health: 'green' | 'amber' | 'red') => {
  switch (health) {
    case 'green': return 'border-emerald-500';
    case 'amber': return 'border-amber-500';
    case 'red': return 'border-rose-500';
    default: return 'border-slate-500';
  }
};

export function KanbanBoard() {
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  const toggleCard = (id: string) => {
    setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between max-w-[1600px] mx-auto">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Order Management</h1>
            
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 rounded-full text-slate-600 font-medium">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                24 active
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1 bg-rose-50 rounded-full text-rose-700 font-medium">
                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                3 bottlenecked
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 rounded-full text-amber-700 font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                7 need your action
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors">
              <Search className="w-5 h-5" />
            </button>
            <button className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors">
              <Filter className="w-5 h-5" />
            </button>
            <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium text-sm transition-colors shadow-sm">
              <Plus className="w-4 h-4" />
              New PO
            </button>
          </div>
        </div>
      </header>

      {/* Main Board */}
      <main className="flex-1 overflow-x-auto overflow-y-hidden p-6 relative">
        <div className="flex gap-6 h-full min-w-max pb-8 items-start">
          {MOCK_COLUMNS.map((column) => (
            <div key={column.id} className="w-[280px] flex flex-col max-h-full">
              {/* Column Header */}
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${getHealthColor(column.health)} shadow-sm`} />
                  <h2 className="font-semibold text-slate-700 text-sm">{column.title}</h2>
                </div>
                <span className="bg-slate-200 text-slate-600 text-xs font-bold px-2 py-0.5 rounded-full">
                  {column.count}
                </span>
              </div>

              {/* Bottleneck Banner */}
              {column.isBottleneck && (
                <div className="mb-3 bg-rose-50 border border-rose-200 rounded-md p-2.5 flex items-start gap-2 shadow-sm">
                  <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-rose-800 leading-snug font-medium">
                    <span className="font-bold">{column.stalledCount} POs stalled.</span> Oldest is {column.oldestAge}d in this stage.
                  </div>
                </div>
              )}

              {/* Cards Container */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-1 pb-2 custom-scrollbar">
                {column.cards.map((card) => (
                  <div 
                    key={card.id} 
                    className={`bg-white rounded-lg border shadow-sm transition-all duration-200 hover:shadow-md cursor-pointer
                      ${expandedCards[card.id] ? 'border-slate-300 ring-1 ring-slate-200' : 'border-slate-200'}
                    `}
                    onClick={() => toggleCard(card.id)}
                  >
                    <div className={`border-l-4 ${getHealthBorder(card.status)} rounded-l-lg p-3.5`}>
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-mono text-xs font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                          {card.code}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className={`flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-sm
                            ${card.age >= 7 ? 'text-rose-700 bg-rose-50' : 
                              card.age >= 3 ? 'text-amber-700 bg-amber-50' : 'text-slate-500 bg-slate-50'}`}>
                            <Clock className="w-3 h-3" />
                            {card.age}d
                          </span>
                          <button className="text-slate-400 hover:text-slate-600">
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      
                      <h3 className="text-sm font-semibold text-slate-900 leading-tight mb-1">{card.project}</h3>
                      <div className="text-sm font-medium text-slate-500 mb-4">{formatCurrency(card.amount)}</div>
                      
                      {expandedCards[card.id] && (
                        <div className="mb-4 pt-3 border-t border-slate-100 text-xs text-slate-600 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-slate-400 block mb-0.5">Vendor</span>
                              <span className="font-medium text-slate-700">Acme Corp</span>
                            </div>
                            <div>
                              <span className="text-slate-400 block mb-0.5">Requester</span>
                              <span className="font-medium text-slate-700">J. Smith</span>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        {card.action === 'approve' ? (
                          <>
                            <button className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold py-1.5 px-3 rounded border border-emerald-200 transition-colors">
                              <Check className="w-3.5 h-3.5" />
                              Approve
                            </button>
                            <button className="flex items-center justify-center bg-white hover:bg-rose-50 text-slate-500 hover:text-rose-600 text-xs font-semibold py-1.5 px-2.5 rounded border border-slate-200 hover:border-rose-200 transition-colors">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <button className="flex-1 flex items-center justify-center gap-1.5 bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 text-xs font-semibold py-1.5 px-3 rounded border border-slate-200 hover:border-blue-200 transition-colors group">
                            Advance
                            <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500 transition-colors" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Footer Summary */}
      <footer className="bg-white border-t border-slate-200 px-6 py-2.5 flex-shrink-0 flex items-center justify-between text-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-medium">Drafts:</span>
            <span className="bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded-full text-xs">5</span>
            <button className="text-blue-600 hover:text-blue-800 font-medium text-xs ml-1 hover:underline">Submit all</button>
          </div>
          <div className="w-px h-4 bg-slate-300"></div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-medium">Released:</span>
            <span className="bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded-full text-xs">8</span>
            <span className="text-slate-400 text-xs">this month</span>
          </div>
        </div>
        
        <div className="text-slate-400 text-xs font-medium">
          Last updated just now
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 20px;
        }
        .custom-scrollbar:hover::-webkit-scrollbar-thumb {
          background-color: #94a3b8;
        }
      `}</style>
    </div>
  );
}
