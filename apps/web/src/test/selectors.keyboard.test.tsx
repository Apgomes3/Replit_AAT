import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import CountryCombobox from '../components/ui/CountryCombobox';
import InlineStatusSelect from '../components/ui/InlineStatusSelect';
import ProjectsList from '../pages/projects/ProjectsList';
import { useAuthStore } from '../store/authStore';

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

  it('opens, filters, navigates, selects, and dismisses the project manager picker in the new project form', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(['projects', ''], {
      items: [{ id: 'project-1', project_code: 'PR-100', project_name: 'Marine Exhibit', project_status: 'Active' }],
      pagination: { total: 1 },
    });
    queryClient.setQueryData(['admin-users-list'], {
      items: [
        { id: 'user-1', first_name: 'Alice', last_name: 'Smith', email: 'alice@example.com', role: 'engineer' },
        { id: 'user-2', first_name: 'Alan', last_name: 'Turing', email: 'alan@example.com', role: 'engineer' },
        { id: 'user-3', first_name: 'Grace', last_name: 'Hopper', email: 'grace@example.com', role: 'admin' },
      ],
    });
    const previousUser = useAuthStore.getState().user;
    useAuthStore.setState({
      user: {
        id: 'current-user',
        email: 'current@example.com',
        firstName: 'Current',
        lastName: 'User',
        role: 'engineer',
      },
    });

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <ProjectsList />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      await user.click(screen.getByRole('button', { name: 'New Project' }));
      const trigger = screen.getByRole('button', { name: 'Select project manager' });
      trigger.focus();
      await user.keyboard('{Enter}');

      const input = screen.getByRole('combobox', { name: 'Search project managers' });
      expect(input).toHaveFocus();
      await user.keyboard('al');
      expect(screen.getByRole('listbox', { name: 'Project manager options' })).toBeInTheDocument();
      await user.keyboard('{ArrowDown}');
      const activeOptionId = input.getAttribute('aria-activedescendant');
      expect(activeOptionId).toBeTruthy();
      expect(screen.getByRole('option', { name: /Alan Turing/ })).toHaveAttribute('id', activeOptionId);

      await user.keyboard('{Enter}');
      expect(screen.getByRole('button', { name: 'Select project manager, currently Alan Turing' })).toHaveFocus();
      expect(screen.queryByRole('listbox', { name: 'Project manager options' })).not.toBeInTheDocument();

      await user.keyboard('{Enter}');
      expect(screen.getByRole('combobox', { name: 'Search project managers' })).toHaveFocus();
      await user.keyboard('{Escape}');
      expect(screen.getByRole('button', { name: 'Select project manager, currently Alan Turing' })).toHaveFocus();
      expect(screen.queryByRole('listbox', { name: 'Project manager options' })).not.toBeInTheDocument();

      await user.keyboard('{Enter}');
      const city = screen.getAllByRole('textbox')[3];
      await user.click(city);
      expect(city).toHaveFocus();
      expect(screen.queryByRole('listbox', { name: 'Project manager options' })).not.toBeInTheDocument();
    } finally {
      useAuthStore.setState({ user: previousUser });
    }
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