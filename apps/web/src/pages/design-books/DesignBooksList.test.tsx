import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DesignBooksList from './DesignBooksList';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

vi.mock('../../lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const apiGet = vi.mocked(api.get);

const book = {
  id: 'book-1',
  book_code: 'DB-001',
  book_title: 'Taoyuan Aquarium Design Book',
  revision: 'A',
  status: 'Draft',
  created_by_name: 'Design Engineer',
};

function renderList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DesignBooksList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DesignBooksList search behavior', () => {
  beforeEach(() => {
    apiGet.mockResolvedValue({ data: { items: [] } });
    useAuthStore.setState({
      user: {
        id: 'engineer-1',
        email: 'engineer@example.com',
        firstName: 'Design',
        lastName: 'Engineer',
        role: 'engineer',
        moduleAccess: {},
      },
      token: 'test-token',
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces rapid typing into one debounced search request', async () => {
    renderList();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/design-books'));

    const input = screen.getByPlaceholderText('Search by code, title or project…');
    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: 'p' } });
    fireEvent.change(input, { target: { value: 'pu' } });
    fireEvent.change(input, { target: { value: 'pump' } });

    expect(input).toHaveValue('pump');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(apiGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    vi.useRealTimers();
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledTimes(2);
      expect(apiGet).toHaveBeenLastCalledWith('/design-books?q=pump');
    });
  });

  it('shows the exact no-match term and clears the search back to the list', async () => {
    apiGet.mockImplementation((url: string) => (
      Promise.resolve({
        data: { items: url === '/design-books' ? [book] : [] },
      })
    ));

    renderList();
    expect(await screen.findByText(book.book_title)).toBeVisible();

    const input = screen.getByPlaceholderText('Search by code, title or project…');
    fireEvent.change(input, { target: { value: 'missing design book' } });
    await new Promise(resolve => setTimeout(resolve, 350));

    expect(await screen.findByText('No design books found for “missing design book”')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');

    await new Promise(resolve => setTimeout(resolve, 350));
    expect(await screen.findByText(book.book_title)).toBeVisible();
    expect(apiGet).toHaveBeenLastCalledWith('/design-books');
  });

  it('keeps the New Design Book action visible for an empty collection', async () => {
    renderList();

    expect(await screen.findByText('No design books yet')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'New Design Book' })).toHaveLength(2);
  });

  it('hides stale rows during loading while keeping keyboard input usable', async () => {
    let resolveSearch: ((value: { data: { items: unknown[] } }) => void) | undefined;
    apiGet.mockImplementation((url: string) => {
      if (url === '/design-books') {
        return Promise.resolve({ data: { items: [book] } });
      }

      return new Promise(resolve => {
        resolveSearch = resolve;
      });
    });

    renderList();
    expect(await screen.findByText(book.book_title)).toBeVisible();

    const input = screen.getByPlaceholderText('Search by code, title or project…');
    fireEvent.change(input, { target: { value: 'new search' } });
    expect(input).toHaveValue('new search');
    expect(screen.getByText('Loading…')).toBeVisible();
    expect(screen.queryByText(book.book_title)).not.toBeInTheDocument();

    await new Promise(resolve => setTimeout(resolve, 350));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/design-books?q=new%20search'));

    expect(screen.getByText('Loading…')).toBeVisible();
    expect(screen.queryByText(book.book_title)).not.toBeInTheDocument();
    expect(input).toHaveValue('new search');

    await act(async () => {
      resolveSearch?.({ data: { items: [] } });
    });
    expect(await screen.findByText('No design books found for “new search”')).toBeVisible();
  });
});