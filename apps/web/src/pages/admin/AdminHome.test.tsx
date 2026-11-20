import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import AdminHome from './AdminHome';
import { useAuthStore } from '../../store/authStore';

const renderHome = () => render(<MemoryRouter><AdminHome /></MemoryRouter>);

describe('AdminHome', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthStore.setState({
      user: { id: 'a', email: 'a@example.com', firstName: 'A', lastName: 'D', role: 'admin', moduleAccess: {} },
    });
  });

  it('groups pages by department and shows empty departments to admins', () => {
    renderHome();
    expect(screen.getByRole('region', { name: 'Engineering' })).toHaveTextContent('Pump Duty Types');
    expect(screen.getByRole('region', { name: 'Platform' })).toHaveTextContent('Users');
    expect(screen.getByRole('region', { name: 'Logistics' })).toHaveTextContent('Nothing to configure yet');
  });

  it('filters by search words, including keywords', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.type(screen.getByLabelText('Search settings'), 'currency');
    expect(screen.getByRole('link', { name: 'Exchange Rates' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('pins a page into the Pinned card and remembers it', async () => {
    const user = userEvent.setup();
    const { unmount } = renderHome();
    await user.click(screen.getByRole('button', { name: 'Pin Roles' }));
    expect(screen.getByRole('region', { name: 'Pinned' })).toHaveTextContent('Roles');
    unmount();
    renderHome();
    expect(screen.getByRole('region', { name: 'Pinned' })).toHaveTextContent('Roles');
  });
});
