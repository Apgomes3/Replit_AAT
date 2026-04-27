import { useState, useCallback } from 'react';
import ConfirmDialog from '../components/ui/ConfirmDialog';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function useConfirm() {
  const [cfg, setCfg] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => setCfg({ ...opts, resolve }));
  }, []);

  const dialog = cfg ? (
    <ConfirmDialog
      {...cfg}
      onConfirm={() => { const r = cfg.resolve; setCfg(null); r(true); }}
      onCancel={() => { const r = cfg.resolve; setCfg(null); r(false); }}
    />
  ) : null;

  return { confirm, dialog };
}
