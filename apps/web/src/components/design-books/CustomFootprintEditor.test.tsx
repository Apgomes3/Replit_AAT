import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
const openRectangle = { ...rectangle, closed: false, segments: rectangle.segments.slice(0, 3) };
const curved = {
  ...rectangle,
  segments: [
    { type: 'quadratic', start: { x: 0, y: 0 }, control: { x: 1000, y: -400 }, end: { x: 2000, y: 0 } },
    ...rectangle.segments.slice(1),
  ],
};
function pointer(element: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number, clientY: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(element, event);
}

describe('CustomFootprintEditor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads, adjusts, replaces, and removes a session-only reference image', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const urls: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${urls.push('created')}`);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('Image', class {
      onload: null | (() => void) = null;
      set src(_value: string) { this.onload?.(); }
    });
    render(<StrictMode><CustomFootprintEditor initialValue={rectangle} onAccept={onAccept} onCancel={vi.fn()} /></StrictMode>);
    const first = new File(['first'], 'plan-one.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Choose reference image'), first);
    expect(screen.getByText('plan-one.png')).toBeInTheDocument();
    const drawingSurface = screen.getByRole('img', { name: 'Footprint drawing surface' });
    let image = screen.getByTestId('footprint-reference-image');
    expect(image).toHaveAttribute('href', 'blob:test-1');
    expect(image).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
    expect(image).toHaveAttribute('pointer-events', 'none');
    expect(image.nextElementSibling?.tagName.toLowerCase()).toBe('path');
    expect(drawingSurface.firstElementChild).toBe(image);
    await user.click(screen.getByRole('button', { name: 'Use this footprint' }));
    const accepted = onAccept.mock.calls[0][0];
    expect(accepted).toMatchObject({ closed: true, units: 'mm', segments: rectangle.segments });
    expect(accepted).not.toHaveProperty('referenceImage');
    fireEvent.change(screen.getByLabelText('Reference image opacity'), { target: { value: '60' } });
    expect(screen.getByText('Reference image opacity: 60%')).toBeInTheDocument();
    expect(image).toHaveAttribute('opacity', '0.6');
    const second = new File(['second'], 'plan-two.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Replace reference image'), second);
    expect(screen.getByText('plan-two.jpg')).toBeInTheDocument();
    image = screen.getByTestId('footprint-reference-image');
    expect(image).toHaveAttribute('href', 'blob:test-2');
    expect(revoke).toHaveBeenCalledWith('blob:test-1');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByText('plan-two.jpg')).not.toBeInTheDocument();
    expect(screen.queryByTestId('footprint-reference-image')).not.toBeInTheDocument();
    expect(revoke).toHaveBeenCalledWith('blob:test-2');
  });

  it('releases the active reference image when the editor unmounts', async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:active-reference');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('Image', class {
      onload: null | (() => void) = null;
      set src(_value: string) { this.onload?.(); }
    });
    const { unmount } = render(<StrictMode><CustomFootprintEditor initialValue={rectangle} onAccept={vi.fn()} onCancel={vi.fn()} /></StrictMode>);
    await user.upload(screen.getByLabelText('Choose reference image'), new File(['plan'], 'plan.png', { type: 'image/png' }));
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:active-reference');
  });

  it('reports unsupported and unreadable images without removing the current reference', async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('Image', class {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { this.onerror?.(); }
    });
    render(<StrictMode><CustomFootprintEditor initialValue={rectangle} onAccept={vi.fn()} onCancel={vi.fn()} /></StrictMode>);
    await user.upload(screen.getByLabelText('Choose reference image'), new File(['bad'], 'bad.png', { type: 'image/png' }));
    expect(screen.getByRole('alert')).toHaveTextContent('could not be read');
    fireEvent.change(screen.getByLabelText('Choose reference image'), { target: { files: [new File(['text'], 'plan.txt', { type: 'text/plain' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('PNG, JPEG, WebP, or GIF');
  });

  it('announces loading, disables conflicting choices, and ignores a stale decode after unmount', async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pending');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let finishDecode: (() => void) | null = null;
    vi.stubGlobal('Image', class {
      onload: null | (() => void) = null;
      set src(_value: string) { finishDecode = this.onload; }
    });
    const { unmount } = render(<StrictMode><CustomFootprintEditor initialValue={rectangle} onAccept={vi.fn()} onCancel={vi.fn()} /></StrictMode>);

    await user.upload(screen.getByLabelText('Choose reference image'), new File(['plan'], 'pending-plan.png', { type: 'image/png' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading “pending-plan.png”');
    expect(screen.getByLabelText('Choose reference image')).toBeDisabled();
    expect(screen.queryByTestId('footprint-reference-image')).not.toBeInTheDocument();

    unmount();
    finishDecode?.();
    expect(revoke).toHaveBeenCalledWith('blob:pending');
  });

  it('keeps a ready image visible when its replacement fails to decode', async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:ready')
      .mockReturnValueOnce('blob:failed');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const decodes: Array<{ load: () => void; error: () => void }> = [];
    vi.stubGlobal('Image', class {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) {
        decodes.push({ load: () => this.onload?.(), error: () => this.onerror?.() });
      }
    });
    render(<StrictMode><CustomFootprintEditor initialValue={rectangle} onAccept={vi.fn()} onCancel={vi.fn()} /></StrictMode>);

    await user.upload(screen.getByLabelText('Choose reference image'), new File(['one'], 'ready.png', { type: 'image/png' }));
    act(() => decodes[0].load());
    expect(await screen.findByText('“ready.png” is ready to trace.')).toBeInTheDocument();
    await user.upload(screen.getByLabelText('Replace reference image'), new File(['two'], 'broken.png', { type: 'image/png' }));
    expect(screen.getByText('Loading “broken.png”…')).toBeInTheDocument();
    expect(screen.getByTestId('footprint-reference-image')).toHaveAttribute('href', 'blob:ready');
    act(() => decodes[1].error());
    expect(await screen.findByRole('alert')).toHaveTextContent('broken.png');
    expect(screen.getByTestId('footprint-reference-image')).toHaveAttribute('href', 'blob:ready');
    expect(revoke).toHaveBeenCalledWith('blob:failed');
    expect(revoke).not.toHaveBeenCalledWith('blob:ready');
  });

  it('measures two points at the active scale, replaces the result, and keeps accepted geometry isolated', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const scaled = { ...rectangle, calibration: { model_unit: 'mm', mm_per_unit: 2, method: 'ratio', ratio: 2 } };
    render(<CustomFootprintEditor initialValue={scaled} onAccept={onAccept} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Measure two points' }));
    const surface = screen.getByRole('img', { name: 'Footprint drawing surface' });
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}),
    });
    pointer(surface, 'pointerdown', 100, 100);
    pointer(surface, 'pointerdown', 200, 100);
    expect(screen.getByRole('status')).toHaveTextContent('248.0 mm');
    pointer(surface, 'pointerdown', 300, 100);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    pointer(surface, 'pointerdown', 350, 100);
    expect(screen.getByRole('status')).toHaveTextContent('124.0 mm');
    await user.click(screen.getByText('Clear measurement'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Leave measurement mode' }));
    await user.click(screen.getByRole('button', { name: 'Use this footprint' }));
    expect(onAccept).toHaveBeenCalledWith(scaled);
  });
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

  it('closes an open outline from the prominent action without a precise canvas click', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<CustomFootprintEditor initialValue={openRectangle} onAccept={onAccept} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Close outline' }));
    expect(screen.getByText('Closed and measurable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use this footprint' }));
    const accepted = onAccept.mock.calls[0][0];
    expect(accepted.segments).toHaveLength(4);
    expect(accepted.segments[3].end).toEqual(accepted.segments[0].start);
  });

  it('shows snap feedback and closes when the pointer is near the first point', async () => {
    const onAccept = vi.fn();
    render(<CustomFootprintEditor initialValue={openRectangle} onAccept={onAccept} onCancel={vi.fn()} />);
    const surface = screen.getByRole('img', { name: 'Footprint drawing surface' });
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}),
    });
    pointer(surface, 'pointermove', 97, 81);
    expect(screen.getByText('Release to close')).toBeInTheDocument();
    pointer(surface, 'pointerdown', 97, 81);
    expect(screen.queryByText('Closed and measurable')).not.toBeInTheDocument();
    pointer(surface, 'pointerup', 97, 81);
    expect(screen.getByText('Closed and measurable')).toBeInTheDocument();
  });

  it('applies and persists a numeric scale while keeping canonical millimetre geometry', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<CustomFootprintEditor initialValue={rectangle} onAccept={onAccept} onCancel={vi.fn()} />);
    const ratio = screen.getByLabelText('Numeric scale ratio');
    await user.clear(ratio);
    await user.type(ratio, '50');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByLabelText('Active drawing scale')).toHaveTextContent('1 : 50');
    await user.click(screen.getByRole('button', { name: 'Use this footprint' }));
    const accepted = onAccept.mock.calls[0][0];
    expect(accepted.calibration).toMatchObject({ method: 'ratio', ratio: 50, mm_per_unit: 50 });
    expect(accepted.segments[0].end).toEqual({ x: 100000, y: 0 });
  });

  it('reopens saved calibration metadata without re-scaling canonical geometry', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const calibratedRectangle = {
      ...rectangle,
      calibration: { model_unit: 'mm', mm_per_unit: 50, method: 'ratio', ratio: 50 },
    };
    render(<CustomFootprintEditor initialValue={calibratedRectangle} onAccept={onAccept} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('Active drawing scale')).toHaveTextContent('1 : 50');
    expect(screen.getByText('2.000')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use this footprint' }));
    expect(onAccept.mock.calls[0][0].segments).toEqual(rectangle.segments);
  });

  it('calibrates from two selected points and a known real-world distance', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<CustomFootprintEditor initialValue={rectangle} onAccept={onAccept} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Calibrate from two points' }));
    const surface = screen.getByRole('img', { name: 'Footprint drawing surface' });
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}),
    });
    pointer(surface, 'pointerdown', 100, 100, 1);
    pointer(surface, 'pointerdown', 300, 100, 2);
    const known = screen.getByLabelText('Known distance (mm)');
    await user.type(known, '1000');
    await user.click(screen.getByRole('button', { name: 'Calibrate' }));
    await user.click(screen.getByRole('button', { name: 'Use this footprint' }));
    expect(onAccept.mock.calls[0][0].calibration).toMatchObject({
      method: 'two_point',
      known_distance_mm: 1000,
    });
  });

  it('edits segment lengths while preserving the neighboring connection', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<CustomFootprintEditor initialValue={rectangle} onAccept={onAccept} onCancel={vi.fn()} />);
    const length = screen.getByLabelText('Segment 1 real-world length in millimetres');
    await user.clear(length);
    await user.type(length, '2500');
    await user.tab();
    expect(screen.getByText(/Segment 1 updated and connections preserved/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use this footprint' }));
    const accepted = onAccept.mock.calls[0][0];
    expect(accepted.segments[0].end.x).toBeCloseTo(2500);
    expect(accepted.segments[1].start).toEqual(accepted.segments[0].end);
  });

  it('exposes numeric curvature and angle edits for connected curves', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<CustomFootprintEditor initialValue={curved} onAccept={onAccept} onCancel={vi.fn()} />);
    const curvature = screen.getByLabelText('Curve 1 curvature in millimetres');
    await user.clear(curvature);
    await user.type(curvature, '-650');
    await user.tab();
    const angle = screen.getByLabelText('Curve 1 handle angle in degrees');
    await user.clear(angle);
    await user.type(angle, '-80');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Use this footprint' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Use this footprint' }));
    const accepted = onAccept.mock.calls[0][0];
    expect(accepted.segments[0].control).not.toEqual((curved.segments[0] as any).control);
    expect(accepted.segments[1].start).toEqual(accepted.segments[0].end);
  });

  it('can reduce a curve to zero curvature without disconnecting it', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<CustomFootprintEditor initialValue={curved} onAccept={onAccept} onCancel={vi.fn()} />);
    const curvature = screen.getByLabelText('Curve 1 curvature in millimetres');
    await user.clear(curvature);
    await user.type(curvature, '0');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Use this footprint' }));
    const accepted = onAccept.mock.calls[0][0];
    expect(accepted.segments[0].control).toEqual({ x: 1000, y: 0 });
    expect(accepted.segments[1].start).toEqual(accepted.segments[0].end);
  });

  it('adjusts the latest quadratic handle while drawing without appending geometry and undoes the drag', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const openCurve = { ...curved, closed: false, segments: curved.segments.slice(0, 3) };
    render(<CustomFootprintEditor initialValue={openCurve} onAccept={onAccept} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Quadratic curve' }));
    expect(screen.getByText(/drag the yellow handle to adjust the latest curve/i)).toBeInTheDocument();

    const surface = screen.getByRole('img', { name: 'Footprint drawing surface' });
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}),
    });
    const handle = screen.getByLabelText('Drag yellow curve handle 1 to adjust the curve');
    Object.defineProperty(handle, 'setPointerCapture', { value: vi.fn() });
    const originalControl = (openCurve.segments[0] as any).control;
    pointer(handle, 'pointerdown', 500, 125, 7);
    pointer(surface, 'pointermove', 600, 200, 7);
    pointer(screen.getByLabelText('Drag yellow curve handle 1 to adjust the curve'), 'pointerup', 600, 200, 7);

    const adjustedHandleX = screen.getByLabelText('Drag yellow curve handle 1 to adjust the curve').getAttribute('cx');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Drag yellow curve handle 1 to adjust the curve')).not.toHaveAttribute('cx', adjustedHandleX);
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    await user.click(screen.getByRole('button', { name: 'Select and edit' }));
    await user.click(screen.getByRole('button', { name: 'Close outline' }));
    await user.click(screen.getByRole('button', { name: 'Use this footprint' }));
    const adjusted = onAccept.mock.calls[0][0];
    expect(adjusted.segments).toHaveLength(4);
    expect(adjusted.segments[0].control).not.toEqual(originalControl);
  });

  it.each(['0', '180', '179'])('rejects the singular %s degree curve angle and retains valid geometry', async angleValue => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<CustomFootprintEditor initialValue={curved} onAccept={onAccept} onCancel={vi.fn()} />);
    const angle = screen.getByLabelText('Curve 1 handle angle in degrees');
    await user.clear(angle);
    await user.type(angle, angleValue);
    await user.tab();
    expect(screen.getByText(/angle must stay away from 0° and 180°/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use this footprint' }));
    expect(onAccept.mock.calls[0][0].segments[0].control).toEqual((curved.segments[0] as any).control);
  });
});