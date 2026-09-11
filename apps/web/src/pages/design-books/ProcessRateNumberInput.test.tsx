import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProcessRateNumberInput } from './DesignBookLSSDetail';

describe('ProcessRateNumberInput', () => {
  it('lets the current value be cleared and replaced before committing', () => {
    const onCommit = vi.fn();
    render(
      <ProcessRateNumberInput
        id="rate"
        value="20"
        onCommit={onCommit}
        ariaLabel="AAT process rate"
        className=""
      />,
    );

    const input = screen.getByLabelText('AAT process rate');
    input.focus();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: '18.5' } });

    expect(input).toHaveValue('18.5');
    expect(input).toHaveFocus();
    expect(onCommit).toHaveBeenNthCalledWith(1, '');
    expect(onCommit).toHaveBeenNthCalledWith(2, '18.5');
  });
});