import { useState, useRef } from 'react';

function safeEval(expr: string): number | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  const sanitized = trimmed.replace(/[^0-9+\-*/().\s]/g, '');
  if (!/[+\-*/]/.test(sanitized)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const result = new Function(`'use strict'; return (${sanitized})`)();
    if (typeof result === 'number' && isFinite(result)) {
      return Math.round(result * 10000) / 10000;
    }
    return null;
  } catch {
    return null;
  }
}

interface FormulaInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export default function FormulaInput({ value, onChange, placeholder, className, disabled }: FormulaInputProps) {
  const [rawText, setRawText] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [lastFormula, setLastFormula] = useState<{ expr: string; result: number } | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const liveResult = isFocused ? safeEval(rawText) : null;

  const handleFocus = () => {
    setRawText(value);
    setIsFocused(true);
  };

  const handleBlur = () => {
    const result = safeEval(rawText);
    if (result !== null) {
      setLastFormula({ expr: rawText.trim(), result });
      onChange(String(result));
    } else {
      const num = parseFloat(rawText);
      if (!isNaN(num)) {
        onChange(String(num));
      } else if (rawText.trim() === '') {
        onChange('');
      }
    }
    setIsFocused(false);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!lastFormula) return;
    e.preventDefault();
    setTooltipVisible(true);
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    tooltipTimer.current = setTimeout(() => setTooltipVisible(false), 3000);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={isFocused ? rawText : value}
        onChange={e => setRawText(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onContextMenu={handleContextMenu}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
      />
      {isFocused && liveResult !== null && (
        <div className="absolute left-0 -bottom-5 text-xs text-emerald-600 font-semibold whitespace-nowrap pointer-events-none z-10">
          = {liveResult}
        </div>
      )}
      {tooltipVisible && lastFormula && (
        <div className="absolute bottom-full left-0 mb-1.5 bg-slate-800 text-white text-xs px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap z-50 pointer-events-none flex items-center gap-1.5">
          <span className="text-amber-300 font-mono">{lastFormula.expr}</span>
          <span className="text-slate-400">=</span>
          <span className="font-semibold font-mono">{lastFormula.result}</span>
        </div>
      )}
    </div>
  );
}
