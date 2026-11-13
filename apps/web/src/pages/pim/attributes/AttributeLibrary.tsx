import { useSearchParams } from 'react-router-dom';
import { LayoutTemplate, Ruler, SlidersHorizontal } from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import AttributesPanel from './AttributesPanel';
import FamilyTemplatesPanel from './FamilyTemplatesPanel';
import { useUnits } from './pimAttributesApi';

const TABS = [
  { id: 'attributes', label: 'Attributes', icon: SlidersHorizontal },
  { id: 'families', label: 'Family templates', icon: LayoutTemplate },
  { id: 'units', label: 'Units', icon: Ruler },
] as const;
type TabId = typeof TABS[number]['id'];

function UnitsPanel() {
  const { data: measures = [] } = useUnits();
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {measures.map(m => (
        <section key={m.code} className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="font-semibold text-slate-900">{m.name}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {m.units.map(u => <li key={u.code} className="flex justify-between">
              <span>{u.symbol}{u.code === m.base_unit && <span className="ml-2 text-xs text-slate-500">stored unit</span>}</span>
              {u.code !== m.base_unit && <span className="text-xs text-slate-500">
                1 {u.symbol} = {Number((u.factor + u.offset_value).toPrecision(6))} {m.units.find(b => b.code === m.base_unit)?.symbol}
                {u.offset_value ? ' (with offset)' : ''}</span>}
            </li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** PIM › Attributes: the attribute library, family templates and units (PIM redesign step 1). */
export default function AttributeLibrary() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = (TABS.find(t => t.id === params.get('tab'))?.id) ?? 'attributes';
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Attributes" subtitle="The attribute library, family templates and units used to describe products"
        crumbs={[{ label: 'PIM', href: '/pim' }, { label: 'Attributes' }]} />
      <div className="flex-1 overflow-auto bg-slate-50 p-6">
        <div role="tablist" aria-label="Attribute library sections" className="mb-5 flex gap-1 border-b border-slate-200">
          {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id}
            onClick={() => setParams(t.id === 'attributes' ? {} : { tab: t.id }, { replace: true })}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium ${tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>)}
        </div>
        {tab === 'attributes' ? <AttributesPanel /> : tab === 'families' ? <FamilyTemplatesPanel /> : <UnitsPanel />}
      </div>
    </div>
  );
}
