import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NewExhibitModal } from './DesignBookDetail';

const modalProps = {
  projectId: 'project-1',
  onClose: vi.fn(),
  onCreated: vi.fn(),
};

describe('NewExhibitModal previous-exhibit controls', () => {
  it('hides the complete inheritance field when there are no existing exhibits', () => {
    render(<NewExhibitModal {...modalProps} exhibits={[]} />);

    expect(screen.queryByLabelText('Link to previous exhibit')).not.toBeInTheDocument();
    expect(screen.queryByText('Copies water type and design temperatures; you can edit them below.')).not.toBeInTheDocument();
  });

  it('shows existing exhibits and copies their water type and design temperatures', async () => {
    const user = userEvent.setup();
    render(
      <NewExhibitModal
        {...modalProps}
        exhibits={[
          {
            id: 'exhibit-1',
            exhibit_code: 'EX-01',
            exhibit_name: 'Coral Reef',
            water_type: 'Marine',
            design_temperature_min: 24,
            design_temperature_max: 26,
          },
        ]}
      />,
    );

    const selector = screen.getByLabelText('Link to previous exhibit');
    expect(selector).toHaveTextContent('— None —');
    expect(selector).toHaveTextContent('EX-01 — Coral Reef');
    expect(screen.getByText('Copies water type and design temperatures; you can edit them below.')).toBeInTheDocument();

    await user.selectOptions(selector, 'exhibit-1');

    expect(screen.getAllByRole('combobox')[0]).toHaveValue('Marine');
    expect(screen.getByPlaceholderText('24')).toHaveValue(24);
    expect(screen.getByPlaceholderText('26')).toHaveValue(26);
  });
});