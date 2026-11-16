import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';

/** A client's name that opens their page; plain text when there is no linked company. */
export default function ClientLink({ id, name, className = '' }: { id?: string | null; name?: string | null; className?: string }) {
  if (!name) return <span className={`text-[#8a9b9a] ${className}`}>—</span>;
  if (!id) return <span className={className}>{name}</span>;
  return <Link to={`/clients/${id}`} onClick={e => e.stopPropagation()}
    className={`inline-flex items-center gap-1 font-semibold text-[#087f73] hover:underline ${className}`}>
    <Building2 className="w-3.5 h-3.5 shrink-0" aria-hidden />{name}
  </Link>;
}
