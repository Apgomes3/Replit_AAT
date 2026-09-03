import { useEffect } from 'react';
import { evaluateMathExpression, resolveMathInput } from './mathExpression';

export function useMathEnabledNumericInputs() {
  useEffect(() => {
    const selector = 'input[type="number"], input[data-math-input="true"]';
    const setNativeValue = (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(input, value);
      else input.value = value;
    };

    const onFocus = (event: FocusEvent) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !input.matches(selector) || input.disabled) return;
      input.dataset.mathInput = 'true';
      input.dataset.mathFocused = 'true';
      input.inputMode = 'decimal';
      // Native number inputs reject operators before React receives them.
      // Switch only while editing, then restore number behavior after resolve.
      if (input.type === 'number') input.type = 'text';
      input.title = 'Enter a number or a calculation, such as 22.5 * 4';
    };

    const onInput = (event: Event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.dataset.mathFocused !== 'true') return;
      const rawValue = input.value;
      input.removeAttribute('aria-invalid');
      const result = evaluateMathExpression(rawValue);
      input.title = result == null
        ? 'Enter a number or a calculation, such as 22.5 * 4'
        : `Calculated result: ${result}`;
      // A controlled React input may restore its JSX type="number" after its
      // onChange state update. Restore text mode and the expression afterward.
      queueMicrotask(() => {
        if (input.dataset.mathFocused !== 'true') return;
        input.type = 'text';
        if (input.value !== rawValue) setNativeValue(input, rawValue);
      });
    };

    const onBlur = (event: FocusEvent) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.dataset.mathFocused !== 'true') return;
      const rawValue = input.value;
      const resolved = resolveMathInput(rawValue);
      if (resolved == null && rawValue.trim() !== '') {
        input.setAttribute('aria-invalid', 'true');
        input.title = 'Enter a valid number or calculation using +, -, *, /, or x';
        return;
      }

      const nextValue = resolved == null ? '' : String(resolved);
      input.dataset.mathFocused = 'false';
      input.type = 'number';
      if (input.value !== nextValue) {
        setNativeValue(input, nextValue);
        // Controlled React inputs need an input event to receive the resolved value.
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      input.removeAttribute('aria-invalid');
      input.title = '';
    };

    document.addEventListener('focusin', onFocus);
    document.addEventListener('input', onInput, true);
    document.addEventListener('blur', onBlur, true);
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('blur', onBlur, true);
    };
  }, []);
}
