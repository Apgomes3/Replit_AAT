import { AlertCircle, RefreshCw } from 'lucide-react';

interface QueryErrorProps {
  message: string;
  onRetry: () => void;
  detail?: string;
}

export default function QueryError({ message, onRetry, detail }: QueryErrorProps) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500">
        <AlertCircle className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-slate-700">{message}</p>
      <p className="max-w-sm text-xs text-slate-400">
        {detail || 'Something went wrong while loading this data. Please try again.'}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}