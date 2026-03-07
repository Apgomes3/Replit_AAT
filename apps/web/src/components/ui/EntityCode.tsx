import clsx from 'clsx';

export default function EntityCode({ code, className }: { code: string; className?: string }) {
  return (
    <span className={clsx('font-mono text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200', className)}>
      {code}
    </span>
  );
}
