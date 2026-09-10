---
name: Bio/Degas plenum crate sizing
description: Defines the source, capacity, and rounding basis for AAT bio-crate quantities.
---

Each LSS Bio/Degas Plenum derives its bio-crate quantity from that LSS's Biological Media result. One AAT bio-crate holds approximately 0.238 m³ of media, and the required quantity always rounds up to a whole crate.

**Why:** The plenum must hold all calculated biological media; fractional crates cannot be installed.

**How to apply:** Use `ceiling(media volume ÷ 0.238 m³)` for crate count. Keep spatial arrangement, external crate dimensions, clearances, and chamber footprint as a separate later sizing phase.