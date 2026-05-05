import React, { useState } from 'react';
import {
  Search,
  Filter,
  ChevronDown,
  ArrowRight,
  CheckCircle,
  XCircle,
  Play,
  Eye,
  CheckSquare,
  Square,
  User,
  Settings,
  MoreVertical,
  Activity
} from 'lucide-react';

const mockData = [
  { id: 'PO-0041', project: 'HVAC System', stage: 'Pending Approval', amount: '$124,500', days: 8, assignee: 'JS', actions: ['A', 'R'] },
  { id: 'PO-0039', project: 'Steel Structure', stage: 'Pending Approval', amount: '$450,000', days: 5, assignee: 'JS', actions: ['A', 'R'] },
  { id: 'PO-0037', project: 'Electrical Panels', stage: 'Pending Approval', amount: '$85,200', days: 2, assignee: 'MK', actions: ['A', 'R'] },
  { id: 'PO-0043', project: 'Concrete Works', stage: 'Draft', amount: '$—', days: 0, assignee: 'JD', actions: ['S'] },
  { id: 'PO-0044', project: 'Safety Equipment', stage: 'Draft', amount: '$—', days: 1, assignee: 'JD', actions: ['S'] },
  { id: 'PO-0035', project: 'Pump Assembly', stage: 'PO Review', amount: '$67,000', days: 4, assignee: 'AL', actions: ['Advance'] },
  { id: 'PO-0033', project: 'Crane Rental', stage: 'Eng Review', amount: '$28,500', days: 3, assignee: 'MK', actions: ['Advance'] },
  { id: 'PO-0031', project: 'Safety Equip', stage: 'Vendor Conf', amount: '$15,200', days: 2, assignee: 'TR', actions: ['Advance'] },
  { id: 'PO-0029', project: 'Scaffolding', stage: 'Delivery', amount: '$42,000', days: 1, assignee: 'JS', actions: ['Advance'] },
  { id: 'PO-0027', project: 'Concrete Works', stage: 'Released', amount: '$189,000', days: null, assignee: 'AL', actions: ['View'] },
];

export function PowerUser() {
  const [selectedId, setSelectedId] = useState('PO-0041');

  const selectedItem = mockData.find(item => item.id === selectedId);

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col text-sm text-slate-900">
      {/* HEADER BAR */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 text-slate-300">
        <div className="flex items-center gap-3">
          <Activity className="w-4 h-4 text-blue-400" />
          <span className="font-semibold text-white">Shark OS <span className="font-normal text-slate-500 mx-1">·</span> Order Management</span>
        </div>
        <div className="flex items-center gap-4">
          <button className="flex items-center gap-1.5 px-2 py-1 hover:bg-slate-800 rounded text-slate-300 transition-colors">
            <span className="text-xs uppercase tracking-wider font-semibold">New PO</span>
            <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-[10px] bg-slate-800 border border-slate-700 rounded text-slate-400 font-mono">N</kbd>
          </button>
          <div className="w-6 h-6 rounded bg-slate-700 flex items-center justify-center text-xs font-medium text-white">JD</div>
        </div>
      </div>

      {/* COMMAND BAR */}
      <div className="flex flex-col bg-white border-b border-slate-200 shadow-sm z-10">
        <div className="flex items-center px-4 py-3 gap-4">
          <div className="flex-1 flex items-center gap-2 bg-slate-100 rounded-md px-3 py-1.5 border border-slate-200 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
            <Search className="w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Filter POs..." 
              className="bg-transparent border-none outline-none flex-1 text-sm font-medium placeholder-slate-400"
              autoFocus
            />
            <div className="flex items-center gap-1.5 border-l border-slate-200 pl-3">
              <button className="flex items-center gap-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded shadow-sm hover:bg-slate-50">
                Status <ChevronDown className="w-3 h-3" />
              </button>
              <button className="flex items-center gap-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded shadow-sm hover:bg-slate-50">
                Assignee <ChevronDown className="w-3 h-3" />
              </button>
              <button className="flex items-center gap-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded shadow-sm hover:bg-slate-50">
                Stage <ChevronDown className="w-3 h-3" />
              </button>
              <button className="flex items-center gap-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded shadow-sm hover:bg-slate-50">
                Date <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="text-sm font-medium text-slate-500 whitespace-nowrap">
            <span className="text-slate-900">24 POs</span> · <span className="text-orange-600">7 need action</span>
          </div>
        </div>
        
        {/* KEYBOARD HINTS ROW */}
        <div className="flex items-center gap-4 px-4 py-1.5 bg-slate-100 border-t border-slate-200 text-xs text-slate-500 overflow-x-auto">
          <div className="flex items-center gap-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-[10px] text-slate-700 shadow-sm">/</kbd> Search</div>
          <div className="w-px h-3 bg-slate-300"></div>
          <div className="flex items-center gap-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-[10px] text-slate-700 shadow-sm">A</kbd> Approve</div>
          <div className="w-px h-3 bg-slate-300"></div>
          <div className="flex items-center gap-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-[10px] text-slate-700 shadow-sm">R</kbd> Reject</div>
          <div className="w-px h-3 bg-slate-300"></div>
          <div className="flex items-center gap-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-[10px] text-slate-700 shadow-sm">S</kbd> Submit</div>
          <div className="w-px h-3 bg-slate-300"></div>
          <div className="flex items-center gap-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-[10px] text-slate-700 shadow-sm">→</kbd> Advance</div>
          <div className="w-px h-3 bg-slate-300"></div>
          <div className="flex items-center gap-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-[10px] text-slate-700 shadow-sm">N</kbd> New</div>
          <div className="w-px h-3 bg-slate-300"></div>
          <div className="flex items-center gap-1.5 whitespace-nowrap"><kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-[10px] text-slate-700 shadow-sm">Esc</kbd> Clear</div>
        </div>
      </div>

      {/* DENSE DATA TABLE */}
      <div className="flex-1 overflow-auto bg-white">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 w-10 text-center font-medium text-slate-500"><Square className="w-3.5 h-3.5 inline-block" /></th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wider">PO Code</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wider">Project</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wider">Stage</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wider text-right">Amount</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wider text-right">Days</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wider text-center">Assignee</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-xs uppercase tracking-wider">Action</th>
            </tr>
          </thead>
          <tbody className="font-mono text-sm">
            {mockData.map((row) => {
              const isSelected = row.id === selectedId;
              let daysColor = 'text-slate-400';
              if (row.days !== null) {
                if (row.days > 7) daysColor = 'text-red-600 font-semibold';
                else if (row.days >= 3) daysColor = 'text-amber-600 font-semibold';
                else daysColor = 'text-emerald-600 font-semibold';
              }

              return (
                <tr 
                  key={row.id} 
                  className={`
                    border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors
                    ${isSelected ? 'bg-blue-50/50 relative' : 'bg-white'}
                  `}
                  onClick={() => setSelectedId(row.id)}
                >
                  {isSelected && (
                    <td className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-600"></td>
                  )}
                  <td className="px-3 py-2 text-center text-slate-300">
                    {isSelected ? <CheckSquare className="w-3.5 h-3.5 inline-block text-blue-600" /> : <Square className="w-3.5 h-3.5 inline-block" />}
                  </td>
                  <td className={`px-3 py-2 font-medium ${isSelected ? 'text-blue-700' : 'text-slate-900'}`}>{row.id}</td>
                  <td className="px-3 py-2 font-sans text-slate-700 truncate max-w-[200px]">{row.project}</td>
                  <td className="px-3 py-2 text-slate-600 font-sans">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-slate-100 text-xs font-medium text-slate-700">
                      {row.stage}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">{row.amount}</td>
                  <td className={`px-3 py-2 text-right ${daysColor}`}>{row.days !== null ? `${row.days}d` : '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-[10px] font-bold text-slate-600 font-sans border border-slate-200">
                      {row.assignee}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {row.actions.includes('A') && (
                        <button className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100 transition-colors text-[10px] font-bold uppercase tracking-wide">
                          <kbd className="font-mono bg-white px-1 py-0 rounded-sm border border-emerald-200 shadow-sm text-emerald-800">A</kbd> Approve
                        </button>
                      )}
                      {row.actions.includes('R') && (
                        <button className="flex items-center gap-1 px-1.5 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 transition-colors text-[10px] font-bold uppercase tracking-wide">
                          <kbd className="font-mono bg-white px-1 py-0 rounded-sm border border-red-200 shadow-sm text-red-800">R</kbd> Reject
                        </button>
                      )}
                      {row.actions.includes('S') && (
                        <button className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 transition-colors text-[10px] font-bold uppercase tracking-wide">
                          <kbd className="font-mono bg-white px-1 py-0 rounded-sm border border-blue-200 shadow-sm text-blue-800">S</kbd> Submit
                        </button>
                      )}
                      {row.actions.includes('Advance') && (
                        <button className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-100 text-slate-700 border border-slate-200 rounded hover:bg-slate-200 transition-colors text-[10px] font-bold uppercase tracking-wide">
                          <kbd className="font-mono bg-white px-1 py-0 rounded-sm border border-slate-300 shadow-sm text-slate-800">→</kbd> Advance
                        </button>
                      )}
                      {row.actions.includes('View') && (
                        <button className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-50 text-slate-600 border border-slate-200 rounded hover:bg-slate-100 transition-colors text-[10px] font-bold uppercase tracking-wide">
                          <Eye className="w-3 h-3" /> View
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* STATUS BAR */}
      <div className="bg-slate-900 text-slate-400 px-4 py-1.5 flex items-center justify-between text-xs border-t border-slate-800 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
        <div className="flex items-center gap-2">
          <span className="text-blue-400 font-medium">1 selected</span>
          <span className="text-slate-600">·</span>
          {selectedItem ? (
            <>
              <span className="text-slate-300 font-mono">{selectedItem.id}</span>
              <span className="text-slate-200">{selectedItem.project}</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400 font-mono">{selectedItem.amount}</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">{selectedItem.days}d in {selectedItem.stage}</span>
            </>
          ) : (
            <span>No item selected</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1"><kbd className="px-1 py-0 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700">A</kbd> approve</div>
          <div className="flex items-center gap-1"><kbd className="px-1 py-0 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700">R</kbd> reject</div>
          <div className="flex items-center gap-1"><kbd className="px-1 py-0 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700">↓↑</kbd> navigate</div>
          <div className="flex items-center gap-1"><kbd className="px-1 py-0 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700">Enter</kbd> open</div>
          <div className="flex items-center gap-1"><kbd className="px-1 py-0 rounded bg-slate-800 text-slate-300 font-mono text-[10px] border border-slate-700">Esc</kbd> deselect</div>
        </div>
      </div>
    </div>
  );
}
