---
name: Bio/Degas plenum crate sizing
description: Defines the source, capacity, and rounding basis for AAT bio-crate quantities.
---

Each LSS Bio/Degas Plenum derives its bio-crate quantity from that LSS's Biological Media result. One AAT bio-crate holds approximately 0.238 m³ of media, measures 1040 × 740 × 530 mm (length × width × height), and the required quantity always rounds up to a whole crate. Stack no more than four crates vertically.

**Why:** The plenum must hold all calculated biological media; fractional crates cannot be installed.

**How to apply:** Use `ceiling(media volume ÷ 0.238 m³)` for crate count and `ceiling(crate count ÷ 4)` for minimum stack positions. Crate-only footprint is stack positions × 1.040 m × 0.740 m. Keep row/column arrangement, access, wall, pipework, and freeboard allowances separate.