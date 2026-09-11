---
name: Custom tank footprints
description: Measurement and lifecycle rules for optional Custom project-tank outlines.
---

Custom tank footprints are optional, but when present their normalized geometry is the authoritative source for plan area, perimeter, and derived water volumes. Gross volume is footprint area × full tank height; operating volume is footprint area × operating water level; net volume subtracts substrate and decoration displacement from operating volume. Without stored custom geometry, Thermal uses clearly labelled rectangular defaults: length × width for free surface and `2 × (length + width) × water height` for exposed vertical wall area. A reviewed exposed-wall value is an explicit override; clearing it returns the calculation to the default.

Drawing calibration is editor metadata only: persisted segments remain canonical millimetres, and changing calibration rescales the current model geometry so the visible drawing stays fixed while newly drawn points use the active scale. Ratio metadata is derived from the ratio; two-point metadata is derived from known distance divided by the selected drawing span.

Reference images and ad-hoc distance measurements are session-only editor aids. They must never enter geometry history, accepted footprint documents, snapshots, or reopen state; measured spans use the active drawing scale only for their temporary millimetre display.

The tracing viewport is an interaction frame, not a geometry-derived preview: freeze it when editing begins, map pointers through the SVG's rendered `meet` content area, and ignore its letterbox bars. Geometry commits and handle drags must never reframe the drawing or reference image.

**Why:** Designers may intentionally defer drawing an irregular outline. A labelled rectangular Thermal default keeps calculations usable without presenting the approximation as measured geometry, while an explicit reviewed override supports known irregular wall areas.

**Why:** Keeping calibration separate from model-space geometry lets existing footprints reopen consistently without storing viewport pixels, while deriving one authoritative scale prevents contradictory metadata from changing future measurements.

**Why:** Tracing sources may be sensitive or disposable, and temporary measurement marks are drafting context rather than governed tank geometry.

**Why:** Recomputing framing from edited geometry moves the coordinate basis under the pointer, causing later clicks and drags to land somewhere other than the designer indicated.

**How to apply:** Preserve accepted geometry and server-derived area through duplication and Design Book snapshots. Prefer stored/custom area over rectangular fallbacks and recalculate gross, operating, and net volumes when footprint, height, water level, substrate, or decoration changes. Clear custom geometry when shape changes away from Custom. Keep tracing and measuring state outside document commits, undo/redo, accept, and persistence. Keep cursor guides and keyboard markers anchored in that same frozen display coordinate frame.