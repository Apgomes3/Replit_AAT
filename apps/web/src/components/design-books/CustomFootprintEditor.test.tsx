import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CustomFootprintEditor, { FootprintPrompt } from './CustomFootprintEditor';

const rectangle = {
  schema_version: 1,
  units: 'mm',
  calibration: { model_unit: 'mm', mm_per_unit: 1 },
  closed: true,
  sampling: { quadratic_steps: 24, freehand_step_mm: 25 },
  segments: [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: 2000, y: 0 } },
    { type: 'line', start: { x: 2000, y: 0 }, end: { x: 2000, y: 1000 } },
    { type: 'line', start: { x: 2000, y: 1000 }, end: { x: 0, y: 1000 } },
    { type: 'line', start: { x: 0, y: 1000 }, end: { x: 0, y: 0 } },
  ],
};

describe('CustomFootprintEditor', () => {
  it('offers the accessible launch and decline choices', async () => {
    const user = userEvent.setup();
    const onLaunch = vi.fn();
    const onContinue = vi.fn();
    render(<FootprintPrompt onLaunch={onLaunch} onContinue={onContinue} />);
    expect(screen.getByRole('dialog', { name: 'Add a custom footprint?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onContinue).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Open footprint tool' }));
    expect(onLaunch).toHaveBeenCalledOnce();
  });

  it('restores a reset drawing with undo and accepts the same model geometry', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<CustomFootprintEditor initialValue={rectangle} onAccept={onAccept} onCancel={vi.fn()} />);
    expect(screen.getByText('2.000')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset footprint' }));
    await user.click(screen.getByRole('button', { name: 'Reset footprint' }));
    expect(screen.getByRole('button', { name: 'Use this footprint' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await user.click(screen.getByRole('button', { name: 'Use this footprint' }));
    expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({
      closed: true,
      units: 'mm',
      segments: rectangle.segments,
    }));
  });

  it('keeps closure aliases connected during keyboard vertex editing and undo/redo', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<CustomFootprintEditor initialValue={rectangle} onAccept={onAccept} onCancel={vi.fn()} />);
    const firstVertex = screen.getByRole('button', { name: /Vertex 1,/ });
    firstVertex.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Use this footprint' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    await user.click(screen.getByRole('button', { name: 'Use this footprint' }));
    const accepted = onAccept.mock.calls[0][0];
    expect(accepted.segments[0].start.x).toBe(25);
    expect(accepted.segments[accepted.segments.length - 1].end.x).toBe(25);
  });
});