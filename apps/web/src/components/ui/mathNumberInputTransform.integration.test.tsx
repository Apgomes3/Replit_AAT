import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

function NativeNumericField() {
  const [value, setValue] = useState('');
  return (
    <>
      <label htmlFor="native-max-flow">Maximum flow</label>
      <input
        id="native-max-flow"
        type="number"
        value={value}
        onChange={event => setValue(event.target.value)}
      />
      <output>{value}</output>
    </>
  );
}

describe('numeric JSX transform', () => {
  it('makes an ordinary number input formula-aware without reversing digits', async () => {
    const user = userEvent.setup();
    render(<NativeNumericField />);
    const input = screen.getByLabelText('Maximum flow');

    expect(input).toHaveAttribute('type', 'number');
    await user.type(input, '51');
    expect(input).toHaveValue('51');

    await user.clear(input);
    await user.type(input, '22.5 * 4');
    expect(input).toHaveValue('22.5 * 4');
    await user.tab();

    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveValue(90);
    expect(screen.getByText('90', { selector: 'output' })).toBeInTheDocument();
  });
});
