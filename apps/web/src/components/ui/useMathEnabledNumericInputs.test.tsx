import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMathEnabledNumericInputs } from './useMathEnabledNumericInputs';

function NumericInputHarness() {
  useMathEnabledNumericInputs();
  const [value, setValue] = useState('');
  return (
    <>
      <label htmlFor="max-flow">Maximum flow</label>
      <input
        id="max-flow"
        type="number"
        min="0"
        value={value}
        onChange={event => setValue(event.target.value)}
      />
      <output>{value}</output>
    </>
  );
}

describe('math-enabled numeric inputs', () => {
  it('resolves an expression into a normal controlled numeric value on blur', async () => {
    render(<NumericInputHarness />);
    const input = screen.getByLabelText('Maximum flow') as HTMLInputElement;

    fireEvent.focusIn(input);
    expect(input.type).toBe('text');
    fireEvent.input(input, { target: { value: '22.5 x 4' } });
    expect(input.title).toBe('Calculated result: 90');
    await waitFor(() => expect(input.type).toBe('text'));
    fireEvent.blur(input);

    expect(input.type).toBe('number');
    expect(input.value).toBe('90');
    expect(screen.getByText('90', { selector: 'output' })).toBeInTheDocument();
  });

  it('keeps an invalid expression available for correction', async () => {
    render(<NumericInputHarness />);
    const input = screen.getByLabelText('Maximum flow') as HTMLInputElement;

    fireEvent.focusIn(input);
    fireEvent.input(input, { target: { value: '22.5 *' } });
    await waitFor(() => expect(input.value).toBe('22.5 *'));
    fireEvent.blur(input);

    expect(input.type).toBe('text');
    expect(input.value).toBe('22.5 *');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
