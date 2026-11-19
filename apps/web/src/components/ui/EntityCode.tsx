import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Copy } from 'lucide-react';

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some embedded previews expose the Clipboard API but reject writes.
      // Try the legacy browser API before asking the user to copy manually.
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (!copied) throw new Error('Copy command was rejected');
  } catch {
    throw new Error('Unable to copy code');
  }
}

export default function EntityCode({ code, className }: { code: string; className?: string }) {
  const handleCopy = async () => {
    try {
      await copyText(code);
      toast.success(`${code} copied to clipboard`);
    } catch {
      toast.error(`Couldn't copy ${code}. Select the code and copy it manually.`);
    }
  };

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Copy ${code}`}
      title={`Copy ${code}`}
      onClick={e => {
        e.stopPropagation();
        void handleCopy();
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          void handleCopy();
        }
      }}
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap shrink-0 font-mono text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200 cursor-pointer hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1',
        className,
      )}
    >
      {code}
      <Copy aria-hidden="true" className="w-3 h-3 opacity-50" />
    </span>
  );
}
