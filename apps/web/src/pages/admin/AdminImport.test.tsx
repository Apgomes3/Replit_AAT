import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../lib/api';
import { MemoryRouter } from 'react-router-dom';
import AdminImport from './AdminImport';

vi.mock('../../lib/api', () => ({
  default: { post: vi.fn() },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

describe('AdminImport component flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('locks required fields and lets optional fields be reset and selected', () => {
    render(<MemoryRouter><AdminImport /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'components' }));

    const code = screen.getByRole('checkbox', { name: 'component_code' });
    const name = screen.getByRole('checkbox', { name: 'component_name' });
    const notes = screen.getByRole('checkbox', { name: 'notes' });
    expect(code).toBeChecked();
    expect(code).toBeDisabled();
    expect(name).toBeChecked();
    expect(name).toBeDisabled();
    expect(notes).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Reset optional' }));
    expect(code).toBeChecked();
    expect(name).toBeChecked();
    expect(notes).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(notes).toBeChecked();
    expect(screen.getByText(/Use semicolons to separate multiple/)).toBeInTheDocument();
    expect(screen.getByText(/Materials library/)).toBeInTheDocument();
  });

  it('downloads and submits the selected component fields, then renders results', async () => {
    let blobParts: unknown[] = [];
    class BlobMock {
      constructor(parts: unknown[]) {
        blobParts = parts;
      }
    }
    vi.stubGlobal('Blob', BlobMock);
    const createObjectURL = vi.fn(() => 'blob:component-template');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.mocked(api.post).mockResolvedValue({
      data: {
        imported: 1,
        skipped: 1,
        total: 2,
        errors: ['Row 3: component code CMP-001 already exists; row skipped'],
      },
    });

    render(<MemoryRouter><AdminImport /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'components' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'cost' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download Template' }));

    const csv = String(blobParts[0]);
    expect(csv.split('\n')[0]).toContain('component_code,component_name');
    expect(csv.split('\n')[0]).not.toContain(',cost,');
    expect(csv.split('\n')[0]).toContain('sell_price');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:component-template');

    const file = new File(['component_code,component_name\nCMP-001,Valve'], 'components.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('CSV File'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import components' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/import/components');
    expect(body).toBeInstanceOf(FormData);
    const fields = JSON.parse((body as FormData).get('fields') as string);
    expect(fields).toContain('component_code');
    expect(fields).toContain('component_name');
    expect(fields).not.toContain('cost');
    expect(await screen.findByText('Row 3: component code CMP-001 already exists; row skipped')).toBeInTheDocument();
    expect(screen.getByText('Imported')).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();

    anchorClick.mockRestore();
    vi.unstubAllGlobals();
  });
});