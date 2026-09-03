import { useState, useRef } from 'react';
import { evaluateMathExpression, resolveMathInput } from './mathExpression';

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

  const liveResult = isFocused ? evaluateMathExpression(rawText) : null;

  const handleFocus = () => {
    setRawText(value);
    setIsFocused(true);
  };

  const handleBlur = () => {
    const result = evaluateMathExpression(rawText);
    if (result !== null) {
      setLastFormula({ expr: rawText.trim(), result });
      onChange(String(result));
    } else {
      const num = resolveMathInput(rawText);
      if (num !== null) {
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
          <span className="text-blue-300 font-mono">{lastFormula.expr}</span>
          <span className="text-slate-400">=</span>
          <span className="font-semibold font-mono">{lastFormula.result}</span>
        </div>
      )}
    </div>
  );
}
