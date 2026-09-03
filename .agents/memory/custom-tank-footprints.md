---
name: Custom tank footprints
description: Measurement and lifecycle rules for optional Custom project-tank outlines.
---

Custom tank footprints are optional, but when present their normalized geometry is the authoritative source for plan area and perimeter. Without stored custom geometry, Thermal uses clearly labelled rectangular defaults: length × width for free surface and `2 × (length + width) × water height` for exposed vertical wall area. A reviewed exposed-wall value is an explicit override; clearing it returns the calculation to the default. Manual volume remains independent.

Drawing calibration is editor metadata only: persisted segments remain canonical millimetres, and changing calibration rescales the current model geometry so the visible drawing stays fixed while newly drawn points use the active scale. Ratio metadata is derived from the ratio; two-point metadata is derived from known distance divided by the selected drawing span.

**Why:** Designers may intentionally defer drawing an irregular outline. A labelled rectangular Thermal default keeps calculations usable without presenting the approximation as measured geometry, while an explicit reviewed override supports known irregular wall areas.

**Why:** Keeping calibration separate from model-space geometry lets existing footprints reopen consistently without storing viewport pixels, while deriving one authoritative scale prevents contradictory metadata from changing future measurements.

**How to apply:** Preserve accepted geometry and server-derived area through duplication and Design Book snapshots. Prefer stored/custom area over rectangular fallbacks; otherwise show the calculated default beside an optional override and recalculate after the override changes. Clear custom geometry when shape changes away from Custom, and keep project-tank identity and explicitly entered volume independent of the 2D outline.