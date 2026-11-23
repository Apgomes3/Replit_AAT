// A company's logo on its page: shown large, and managers can upload, change or remove it.
// Projects for the company show this logo unless they have their own.
import { useRef } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiError, useCompanyLogo } from '../../pages/clients/clientsApi';

export default function CompanyLogo({ clientId, name, logoUrl, canManage }: { clientId: string; name: string; logoUrl?: string | null; canManage: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const logo = useCompanyLogo(clientId);
  const set = async (file: File | null) => {
    try { await logo.mutateAsync(file); toast.success(file ? 'Logo saved. Projects for this company show it too.' : 'Logo removed'); }
    catch (err) { toast.error(apiError(err, file ? 'Could not save the logo' : 'Could not remove the logo')); }
  };
  if (!logoUrl && !canManage) return null;
  return <div className="mb-4">
    <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) set(f); }} />
    {logoUrl
      ? <div className="group relative rounded-lg border border-stone-200 bg-white p-3 flex items-center justify-center h-28">
          <img src={logoUrl} alt={`${name} logo`} className="max-h-full max-w-full object-contain" />
          {canManage && <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 p-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button onClick={() => input.current?.click()} disabled={logo.isPending} className="px-2 py-1 rounded-md bg-stone-900/80 text-white text-[11px] font-bold">{logo.isPending ? 'Saving…' : 'Change'}</button>
            <button onClick={() => window.confirm('Remove the logo? Projects that use it will show no logo.') && set(null)} disabled={logo.isPending} aria-label="Remove logo" className="px-2 py-1 rounded-md bg-stone-900/80 text-white text-[11px] font-bold"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>}
        </div>
      : <button onClick={() => input.current?.click()} disabled={logo.isPending}
          className="w-full h-24 rounded-lg border-2 border-dashed border-stone-200 text-stone-400 hover:border-blue-300 hover:text-blue-600 flex flex-col items-center justify-center gap-1 text-xs font-semibold">
          <ImagePlus className="w-5 h-5" />{logo.isPending ? 'Uploading…' : 'Add the company logo'}
          <span className="font-normal text-[11px]">Used on its projects too. PNG, JPG or SVG, up to 5 MB.</span>
        </button>}
  </div>;
}
