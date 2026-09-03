import {
  forwardRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from 'react';
import { evaluateMathExpression, resolveMathInput } from './mathExpression';

type MathNumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * A numeric field that accepts basic arithmetic while preserving the existing
 * controlled-input contract used by forms throughout the app.
 */
const MathNumberInput = forwardRef<HTMLInputElement, MathNumberInputProps>(
  function MathNumberInput({
    onChange,
    onBlur,
    onFocus,
    inputMode,
    title,
    ...props
  }, ref) {
    const [editing, setEditing] = useState(false);
    const [invalid, setInvalid] = useState(false);
    const [calculatedResult, setCalculatedResult] = useState<number | null>(null);

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
      setInvalid(false);
      setCalculatedResult(evaluateMathExpression(event.currentTarget.value));
      onChange?.(event);
    };

    const handleBlur: React.FocusEventHandler<HTMLInputElement> = event => {
      const rawValue = event.currentTarget.value;
      const resolved = resolveMathInput(rawValue);
      if (resolved == null && rawValue.trim() !== '') {
        setInvalid(true);
        onBlur?.(event);
        return;
      }

      const nextValue = resolved == null ? '' : String(resolved);
      if (rawValue !== nextValue) {
        const descriptor = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        );
        descriptor?.set?.call(event.currentTarget, nextValue);
        onChange?.(event as unknown as ChangeEvent<HTMLInputElement>);
      }
      setCalculatedResult(null);
      setInvalid(false);
      setEditing(false);
      onBlur?.(event);
    };

    return (
      <input
        {...props}
        ref={ref}
        type={editing ? 'text' : 'number'}
        role={props.role || 'spinbutton'}
        inputMode={inputMode || 'decimal'}
        aria-invalid={invalid || undefined}
        title={calculatedResult != null
          ? `Calculated result: ${calculatedResult}`
          : invalid
            ? 'Enter a valid number or calculation using +, -, *, /, or x'
            : title}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={event => {
          setEditing(true);
          onFocus?.(event);
        }}
      />
    );
  },
);

export default MathNumberInput;
