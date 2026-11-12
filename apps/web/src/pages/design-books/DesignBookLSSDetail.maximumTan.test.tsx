import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BiologicalMediaCalculatorPanel } from './DesignBookLSSDetail';

const controlled = {
  id: 'max-tan-public',
  profile_code: 'PUBLIC_AQUARIUM',
  profile_name: 'Public Aquarium',
  revision: 1,
  status: 'Approved',
  is_default: true,
  max_tan_mg_n_l: 0.1,
  engineering_note: 'Public-aquarium starting assumption.',
};

function Harness() {
  const [form, setForm] = useState<any>({
    // Maximum TAN belongs to the mass-balance engine; the AAT Core engine hides it.
    calculation_engine: 'MASS_BALANCE',
    biomass_method: '',
    species_rows: [],
    tan_generation_profile_revision_id: '',
    max_tan_source: 'CONTROLLED',
    max_tan_profile_revision_id: controlled.id,
    max_tan_mg_n_l: 0.1,
    media_profile_revision_id: '',
    reactor_type: '',
    notes: '',
    _stale: false,
  });
  return <MemoryRouter><BiologicalMediaCalculatorPanel
    data={{ context: { linked_exhibits: [] }, case: null, runs: [] }}
    mediaProfiles={[]}
    tanProfiles={[]}
    maxTanProfiles={[controlled]}
    speciesCatalog={[]}
    readOnly={false}
    form={form}
    onChange={(key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value, _stale: true }))}
    onSave={vi.fn()}
    onPreview={vi.fn()}
    onCreateRun={vi.fn()}
    onApproveRun={vi.fn()}
    onRejectRun={vi.fn()}
    onExportRun={vi.fn()}
    onCompareRuns={vi.fn()}
    saving={false}
    previewing={false}
    runBusy={null}
    comparison={null}
  /></MemoryRouter>;
}

describe('Biological Media Maximum TAN selection', () => {
  it('shows the controlled default and switches to an editable Custom value', () => {
    render(<Harness />);

    const selector = screen.getByLabelText('Maximum TAN concentration profile');
    expect(selector).toHaveValue(controlled.id);
    expect(screen.getByText('0.1 mg N/L')).toBeInTheDocument();
    expect(screen.getByText(/not a universal safety guarantee/i)).toBeInTheDocument();

    fireEvent.change(selector, { target: { value: 'CUSTOM' } });
    const custom = screen.getByLabelText('Custom Maximum TAN mg N/L');
    fireEvent.change(custom, { target: { value: '0.25' } });
    expect(custom).toHaveValue(0.25);
  });
});