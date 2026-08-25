import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import CountryCombobox from '../components/ui/CountryCombobox';
import InlineStatusSelect from '../components/ui/InlineStatusSelect';

function ProjectCountryHarness() {
  const [country, setCountry] = useState('Canada');

  return (
    <div>
      <label htmlFor="project-country">Country</label>
      <div id="project-country">
        <CountryCombobox value={country} onChange={setCountry} />
      </div>
      <button type="button">Outside control</button>
    </div>
  );
}

function ProductStatusHarness({ onSave = vi.fn(async () => {}) }: { onSave?: (status: string) => Promise<void> }) {
  const [status, setStatus] = useState('Draft');

  return (
    <div>
      <span>Product status</span>
      <InlineStatusSelect
        value={status}
        options={['Draft', 'Active', 'Archived']}
        onSave={async nextStatus => {
          await onSave(nextStatus);
          setStatus(nextStatus);
        }}
      />
      <button type="button">Outside control</button>
    </div>
  );
}

describe('product and project selector keyboard interactions', () => {
  it('opens, navigates, selects, and dismisses the project country selector', async () => {
    const user = userEvent.setup();
    render(<ProjectCountryHarness />);

    const trigger = screen.getByRole('button', { name: /select country/i });
    trigger.focus();
    await user.keyboard('{Enter}');

    const input = screen.getByRole('combobox', { name: 'Search countries' });
    expect(input).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    const activeOptionId = input.getAttribute('aria-activedescendant');
    expect(activeOptionId).toBeTruthy();
    expect(document.getElementById(activeOptionId as string)).toHaveAttribute('role', 'option');

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /select country/i })).toHaveFocus();
    expect(screen.queryByRole('listbox', { name: 'Country options' })).not.toBeInTheDocument();

    await user.keyboard('{Enter}');
    await user.keyboard('japan');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: /select country, currently japan/i })).toBeInTheDocument();

    const outside = screen.getByRole('button', { name: 'Outside control' });
    await user.click(screen.getByRole('button', { name: /select country/i }));
    expect(screen.getByRole('combobox', { name: 'Search countries' })).toBeInTheDocument();
    await user.click(outside);
    expect(outside).toHaveFocus();
    expect(screen.queryByRole('listbox', { name: 'Country options' })).not.toBeInTheDocument();
  });

  it('opens, navigates, selects, and dismisses the product status selector', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {});
    render(<ProductStatusHarness onSave={onSave} />);

    const trigger = screen.getByRole('button', { name: /change status/i });
    trigger.focus();
    await user.keyboard('{Enter}');

    const options = screen.getByRole('listbox');
    expect(options).toBeInTheDocument();
    const draft = screen.getByRole('option', { name: /^Draft/ });
    expect(draft).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /^Active/ })).toHaveFocus();
    await user.keyboard('{Space}');

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('Active');
      expect(screen.getByRole('button', { name: /change status, currently active/i })).toHaveFocus();
    });

    await user.keyboard('{Enter}');
    expect(screen.getByRole('option', { name: /^Active/ })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /change status, currently active/i })).toHaveFocus();

    const outside = screen.getByRole('button', { name: 'Outside control' });
    await user.click(screen.getByRole('button', { name: /change status/i }));
    await user.click(outside);
    expect(outside).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});