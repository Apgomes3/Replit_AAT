import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CustomFootprintEditor from '../../src/components/design-books/CustomFootprintEditor';
import '../../src/index.css';

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CustomFootprintEditor initialValue={rectangle} onAccept={() => {}} onCancel={() => {}} />
  </StrictMode>,
);