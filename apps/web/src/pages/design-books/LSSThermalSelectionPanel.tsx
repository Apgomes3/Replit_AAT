import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertCircle, Check, LockKeyhole, Thermometer } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';

export default function LSSThermalSelectionPanel({
  bookId,
  systemId,
  readOnly,
}: {
  bookId?: string;
  systemId?: string;
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const [sideStreamId, setSideStreamId] = useState('');
  const [productId, setProductId] = useState('');
  const [saving, setSaving] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['thermal-selection', bookId, systemId],
    queryFn: () => api.get(`/design-books/${bookId}/thermal-selection/${systemId}`).then(response => response.data),
    enabled: !!bookId && !!systemId,
  });

  const saved = data?.saved;
  const duty = data?.duty;
  const streams = data?.side_streams || [];
  const products = data?.products || [];
  const compatibleProducts = useMemo(() => products.filter((product: any) =>
    (!product.duty || !duty?.duty || String(product.duty).toLowerCase() === String(duty.duty).toLowerCase())
    && Number(product.thermal_capacity_kw) >= Number(duty?.required_capacity_kw || 0),
  ), [products, duty]);

  useEffect(() => {
    if (saved) {
      setSideStreamId(saved.side_stream_id || saved.input_snapshot?.side_stream?.id || '');
      setProductId(saved.product_master_id || saved.product_snapshot?.product_master_id || saved.product_snapshot?.id || '');
    } else if (!sideStreamId && streams[0]) {
      setSideStreamId(streams[0].id);
    }
  }, [saved?.id, saved?.side_stream_id, saved?.product_master_id, streams.length]);

  useEffect(() => {
    if (!productId && compatibleProducts[0]) setProductId(compatibleProducts[0].product_master_id || compatibleProducts[0].id);
  }, [compatibleProducts, productId]);

  const selectedStream = streams.find((stream: any) => stream.id === sideStreamId);
  const selectedProduct = products.find((product: any) =>
    String(product.product_master_id || product.id) === String(productId),
  );
  const saveSelection = async () => {
    if (!bookId || !systemId || !sideStreamId || !productId) return;
    setSaving(true);
    try {
      await api.post(`/design-books/${bookId}/thermal-selection/${systemId}`, {
        side_stream_id: sideStreamId,
        product_master_id: productId,
      });
      toast.success('Thermal plate selection saved');
      await refetch();
      qc.invalidateQueries({ queryKey: ['design-book', bookId] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Thermal selection could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const displayProduct = saved?.product_snapshot || selectedProduct;
  const displayStream = saved?.side_stream || selectedStream;
  const frozen = !!data?.frozen;

  return (
    <div className="space-y-5">
      {frozen && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <div className="flex items-start gap-2">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Frozen Thermal selection — read-only</p>
              <p className="mt-1 text-xs text-emerald-800">The captured duty, plate product, and Flow Route side-stream flow cannot be changed in this revision.</p>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-100 bg-cyan-50/30 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Thermometer className="h-4 w-4 text-cyan-700" />
            <span className="text-sm font-semibold text-cyan-900">Thermal plate selection</span>
          </div>
          {saved && <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">Saved</span>}
        </div>

        {isLoading && <div className="px-5 py-12 text-center text-sm text-stone-500"><Activity className="mx-auto mb-3 h-7 w-7 animate-pulse text-cyan-300" />Loading Thermal selection…</div>}
        {isError && (
          <div className="px-5 py-12 text-center">
            <AlertCircle className="mx-auto mb-3 h-8 w-8 text-red-300" />
            <p className="text-sm font-medium text-red-700">Unable to load Thermal selection</p>
            <p className="mt-1 text-xs text-red-600">{(error as any)?.response?.data?.error?.message || 'Try again.'}</p>
            <button type="button" onClick={() => { void refetch(); }} className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700">Retry</button>
          </div>
        )}

        {!isLoading && !isError && (
          <>
            <div className="grid gap-3 border-b border-stone-100 bg-stone-50/50 px-5 py-4 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">Active duty</p>
                <p className="mt-1 text-sm font-semibold text-stone-800">{duty?.duty || saved?.duty || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">Required capacity</p>
                <p className="mt-1 font-mono text-sm font-semibold text-stone-800">
                  {duty?.required_capacity_kw != null ? `${Number(duty.required_capacity_kw).toFixed(2)} kW` : saved ? `${Number(saved.required_capacity_kw).toFixed(2)} kW` : '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">Thermal basis</p>
                <p className="mt-1 text-xs text-stone-600">{data?.thermal_status || 'Not configured'} · {data?.thermal_freshness || 'unsaved'}</p>
              </div>
            </div>

            {!duty && !saved && (
              <div className="px-5 py-10 text-center">
                <Thermometer className="mx-auto mb-3 h-8 w-8 text-stone-200" />
                <p className="text-sm font-medium text-stone-700">Save a Ready Thermal calculation first</p>
                <p className="mx-auto mt-1 max-w-lg text-xs text-stone-500">The active cooling or heating duty determines the minimum plate capacity.</p>
              </div>
            )}

            {(duty || saved) && (
              <div className="space-y-4 px-5 py-5">
                {frozen ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><p className="text-xs font-medium text-stone-500">Flow Route side stream</p><p className="mt-1 text-sm font-semibold text-stone-800">{displayStream?.name || '—'}</p><p className="text-xs text-stone-500">Resolved flow: {displayStream?.flow_m3h != null ? `${Number(displayStream.flow_m3h).toFixed(3)} m³/h` : '—'}</p></div>
                    <div><p className="text-xs font-medium text-stone-500">Selected plate</p><p className="mt-1 text-sm font-semibold text-stone-800">{displayProduct?.product_name || '—'}</p><p className="text-xs text-stone-500">{displayProduct?.product_code || '—'} · {displayProduct?.thermal_capacity_kw != null ? `${Number(displayProduct.thermal_capacity_kw).toFixed(2)} kW` : 'capacity unavailable'}</p></div>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="text-xs font-medium text-stone-600">Flow Route side stream
                        <select value={sideStreamId} onChange={event => setSideStreamId(event.target.value)} disabled={readOnly || streams.length === 0} className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
                          <option value="">— Choose a Thermal stream —</option>
                          {streams.map((stream: any) => <option key={stream.id} value={stream.id}>{stream.name} · {stream.flow_m3h != null ? `${Number(stream.flow_m3h).toFixed(3)} m³/h` : 'flow unavailable'}</option>)}
                        </select>
                        <span className="mt-1 block text-[10px] font-normal text-stone-400">Plate-side flow is resolved from the selected stream's parent loop allocation.</span>
                      </label>
                      <label className="text-xs font-medium text-stone-600">Thermal Product Master plate
                        <select value={productId} onChange={event => setProductId(event.target.value)} disabled={readOnly || compatibleProducts.length === 0} className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
                          <option value="">— Choose an eligible plate —</option>
                          {compatibleProducts.map((product: any) => <option key={product.product_master_id || product.id} value={product.product_master_id || product.id}>{product.product_code} · {product.product_name} · {Number(product.thermal_capacity_kw).toFixed(2)} kW</option>)}
                        </select>
                        <span className="mt-1 block text-[10px] font-normal text-stone-400">Only active products with matching duty and enough capacity are shown.</span>
                      </label>
                    </div>
                    {selectedStream && <div className="rounded-lg border border-cyan-100 bg-cyan-50/40 px-3 py-2 text-xs text-cyan-900">Resolved plate-side flow: <strong className="font-mono">{selectedStream.flow_m3h != null ? `${Number(selectedStream.flow_m3h).toFixed(3)} m³/h` : 'unavailable'}</strong></div>}
                    {!streams.length && <p className="text-xs text-amber-700">Add a Thermal side stream in Flow Route before selecting a plate.</p>}
                    {duty && !compatibleProducts.length && <p className="text-xs text-amber-700">No active Thermal Product Master plate meets the current {duty.duty.toLowerCase()} duty of {Number(duty.required_capacity_kw).toFixed(2)} kW.</p>}
                    {!readOnly && <button type="button" onClick={saveSelection} disabled={saving || !sideStreamId || !productId || !selectedStream?.flow_m3h || !duty} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"><Check className="h-3.5 w-3.5" />{saving ? 'Saving…' : 'Save plate selection'}</button>}
                  </>
                )}
                {saved && saved.result_snapshot?.capacity_margin_kw != null && <p className="text-xs text-stone-500">Capacity margin: <span className="font-mono font-semibold text-stone-700">{Number(saved.result_snapshot.capacity_margin_kw).toFixed(2)} kW</span></p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}