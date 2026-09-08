---
name: Friction Loss tank boundaries
description: Governs static-head and pump draw-point treatment for tank-to-tank hydraulic calculations.
---

Calculate static head from the receiving free-surface elevation minus the starting free-surface elevation, including any vessel gauge-pressure head difference. Both tanks default to open atmosphere, and the starting tank base defaults to FL0.

**Why:** In an open tank, hydrostatic pressure at a submerged intake offsets the intake elevation, so using the pump draw point as the static-head origin would double-count that elevation effect.

**How to apply:** Preserve the pump draw-point height as suction/NPSH evidence. Do not add it separately to total dynamic head; use it only when calculating suction conditions or NPSH available.