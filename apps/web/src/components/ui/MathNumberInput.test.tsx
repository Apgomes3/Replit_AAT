import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import MathNumberInput from './MathNumberInput';

function Harness() {
  const [value, setValue] = useState('');
  return (
    <>
      <label htmlFor="max-flow">Maximum flow</label>
      <MathNumberInput
        id="max-flow"
        value={value}
        onChange={event => setValue(event.target.value)}
      />
      <output>{value}</output>
    </>
  );
}

describe('MathNumberInput', () => {
  it('preserves digit order while typing an ordinary number', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Maximum flow');

    await user.type(input, '51');

    expect(input).toHaveValue('51');
  });

  it('accepts a formula and commits the result on blur', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Maximum flow');

    await user.type(input, '22.5 x 4');
    expect(input).toHaveValue('22.5 x 4');
    expect(input).toHaveAttribute('title', 'Calculated result: 90');
    await user.tab();

    expect(input).toHaveValue(90);
    expect(screen.getByText('90', { selector: 'output' })).toBeInTheDocument();
  });

  it('marks an invalid expression without reversing or clearing it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Maximum flow');

    await user.type(input, '22.5 *');
    await user.tab();

    expect(input).toHaveValue('22.5 *');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
