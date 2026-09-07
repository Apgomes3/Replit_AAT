import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, LayoutGrid, List, SlidersHorizontal } from 'lucide-react';
import EntityCode from '../../components/ui/EntityCode';
import LSSControlPanel from './LSSControlPanel';

export function isLssSystem(system: any) {
  const type = String(system?.system_type || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  return type === 'lss' || /(^|[^a-z])lss([^a-z]|$)/.test(type)
    || type === 'life support' || type.startsWith('life support ');
}

export function getLssSystems(systems: any[]) {
  return (systems || []).filter(isLssSystem);
}

type Props = {
  book: any;
  readOnly: boolean;
  canOverrideProduct: boolean;
};

/**
 * Design Book-level control workspace. The selected LSS is deliberately kept
 * in the URL so a specific panel/instrument configuration can be bookmarked
 * and shared without reintroducing Control as an individual LSS tool.
 */
export default function ControlFieldInstrumentsTab({ book, readOnly, canOverrideProduct }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<'list' | 'card'>('list');
  const systems = getLssSystems(book.systems);
  const selectedSystemId = searchParams.get('system');
  const selectedSystem = systems.find((system: any) => String(system.id) === selectedSystemId);

  const selectSystem = (systemId: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (systemId) next.set('system', systemId);
    else next.delete('system');
    setSearchParams(next);
  };

  if (selectedSystem) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-stone-200 bg-white px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50">
              <SlidersHorizontal className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Control and Field Instruments</p>
              <h2 className="mt-0.5 text-lg font-semibold text-stone-900">{selectedSystem.system_name}</h2>
              <EntityCode code={selectedSystem.system_code} />
            </div>
          </div>
          <button type="button" onClick={() => selectSystem(null)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50">
            <ChevronLeft className="h-4 w-4" /> All LSS systems
          </button>
        </div>
        <LSSControlPanel
          bookId={book.id}
          systemId={selectedSystem.id}
          readOnly={readOnly}
          canOverrideProduct={canOverrideProduct}
        />
      </div>
    );
  }

  if (!systems.length) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white py-16 text-center">
        <SlidersHorizontal className="mx-auto mb-3 h-10 w-10 text-stone-300" />
        <p className="font-semibold text-stone-700">No Life Support Systems to configure</p>
        <p className="mt-1 text-sm text-stone-500">Create and configure a Life Support System first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-stone-800">Control and Field Instruments</h2>
          <p className="mt-1 text-sm text-stone-500">Choose a Life Support System to configure its panel, field instruments, tags, signals, products, and control logic.</p>
        </div>
        <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1" aria-label="System view">
          <button type="button" onClick={() => setView('list')} aria-pressed={view === 'list'}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${view === 'list' ? 'bg-blue-50 text-blue-700' : 'text-stone-500 hover:bg-stone-50'}`}>
            <List className="h-3.5 w-3.5" /> List
          </button>
          <button type="button" onClick={() => setView('card')} aria-pressed={view === 'card'}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${view === 'card' ? 'bg-blue-50 text-blue-700' : 'text-stone-500 hover:bg-stone-50'}`}>
            <LayoutGrid className="h-3.5 w-3.5" /> Cards
          </button>
        </div>
      </div>
      {view === 'list' ? <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr><th className="px-4 py-3">LSS system</th><th className="px-4 py-3">Water type</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {systems.map((system: any) => (
              <tr key={system.id}>
                <td className="px-4 py-3"><div className="font-semibold text-stone-800">{system.system_name}</div><EntityCode code={system.system_code} /></td>
                <td className="px-4 py-3 text-stone-600">{system.water_type || '—'}</td>
                <td className="px-4 py-3 text-stone-600">{system.status || '—'}</td>
                <td className="px-4 py-3 text-right">
                  <button type="button" onClick={() => selectSystem(system.id)}
                    className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800">
                    Open control <ChevronRight className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {systems.map((system: any) => (
          <article key={system.id} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-stone-800">{system.system_name}</h3>
                <EntityCode code={system.system_code} />
              </div>
              <SlidersHorizontal className="h-5 w-5 shrink-0 text-blue-500" />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-stone-400">Water type</dt><dd className="mt-0.5 text-stone-700">{system.water_type || '—'}</dd></div>
              <div><dt className="text-xs text-stone-400">Status</dt><dd className="mt-0.5 text-stone-700">{system.status || '—'}</dd></div>
            </dl>
            <button type="button" onClick={() => selectSystem(system.id)}
              className="mt-5 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
              Open control <ChevronRight className="h-4 w-4" />
            </button>
          </article>
        ))}
      </div>}
    </div>
  );
}