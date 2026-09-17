---
name: Bio/Degas plenum crate sizing
description: Defines the source, capacity, and rounding basis for AAT bio-crate quantities.
---

Each LSS Bio/Degas Plenum derives its bio-crate quantity from that LSS's current Biological Media result. One AAT bio-crate holds approximately 0.238 m³ of media, measures 1040 × 740 × 530 mm (length × width × height), and the required quantity always rounds up to a whole crate. Default to three-high stacks; allow up to four only when the selected tank and tray clearances genuinely permit it.

**Why:** The plenum must hold all calculated biological media; fractional crates cannot be installed.

**How to apply:** Use `ceiling(media volume ÷ 0.238 m³)` for crate count. Optimize complete row/column arrangements rather than area alone, preserve manual layouts when demand changes, and block saving against stale media results. The tank envelope, 800 mm end access, wall thickness, fixed dispersion tray, and 100 mm vertical gap are simultaneous constraints.