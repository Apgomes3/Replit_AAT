import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { User } from '../../types';
import ProjectDetail from './ProjectDetail';

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../components/ui/ProjectsMap', () => ({ default: () => null }));

const apiGet = vi.mocked(api.get);
const apiPost = vi.mocked(api.post);

const project = {
  id: 'project-1',
  project_code: 'PRJ-001',
  project_name: 'Aquarium Project',
  project_status: 'Design',
  scopes: ['LSS'],
};

function renderPage(role: User['role'] = 'engineer', moduleAccess: Record<string, 'manage' | 'view' | 'hidden'> = {}) {
  useAuthStore.setState({
    user: {
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Project',
      lastName: 'Manager',
      role,
      moduleAccess,
    },
    token: 'test-token',
    isLoading: false,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/project-1']}>
        <Routes><Route path="/projects/:id" element={<ProjectDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('project document upload experience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockImplementation((url: string) => {
      if (url === '/projects/project-1') return Promise.resolve({ data: project });
      if (url.startsWith('/documents?project_id=')) {
        return Promise.resolve({ data: { items: [{
          id: 'document-1',
          document_code: 'DOC-001',
          document_title: 'Hydraulic Basis',
          document_type: 'Report',
          classification: 'Design',
          current_revision: 'A',
          status: 'Draft',
        }] } });
      }
      if (url === '/document-classifications') {
        return Promise.resolve({ data: { items: [
          { code: 'Design', display_name: 'Design' },
          { code: 'Commercial', display_name: 'Commercial' },
        ] } });
      }
      return Promise.resolve({ data: { items: [] } });
    });
    apiPost.mockResolvedValue({ data: { id: 'document-2' } } as any);
  });

  it('shows classification and uploads required metadata before refreshing the project list', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Hydraulic Basis')).toBeVisible();
    expect(screen.getByText('Classification')).toBeVisible();
    expect(screen.getAllByText('Design').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /upload document/i }));
    expect(await screen.findByRole('option', { name: 'Commercial' })).toBeVisible();
    await user.upload(screen.getByLabelText('File *'), new File(['offer'], 'offer.pdf', { type: 'application/pdf' }));
    await user.type(screen.getByLabelText('Document code *'), 'DOC-002');
    await user.type(screen.getByLabelText('Document title *'), 'Commercial Offer');
    await user.selectOptions(screen.getByLabelText('Classification *'), 'Commercial');
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [url, body] = apiPost.mock.calls[0];
    expect(url).toBe('/projects/project-1/documents');
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('document_code')).toBe('DOC-002');
    expect((body as FormData).get('document_title')).toBe('Commercial Offer');
    expect((body as FormData).get('classification')).toBe('Commercial');
    await waitFor(() => expect(apiGet.mock.calls.filter(([url]) => String(url).startsWith('/documents?project_id=')).length).toBeGreaterThan(1));
  });

  it('hides upload from read-only document users', async () => {
    renderPage('engineer', { documents: 'view' });
    expect(await screen.findByText('Hydraulic Basis')).toBeVisible();
    expect(screen.queryByRole('button', { name: /upload document/i })).not.toBeInTheDocument();
  });
});