---
name: Biological media compatibility options
description: Controlled water and reactor labels used to make media-profile compatibility deterministic.
---

Biological media profiles and Design Book media cases must use the same controlled reactor labels. Profile water compatibility may cover multiple controlled values; treat Marine, Seawater, Salt Water, and Saltwater as the same saltwater category when matching historical data.

**Why:** Free-text values and water-type aliases can hide compatible profiles or allow values that cannot be matched reliably.

**How to apply:** Reuse the controlled option lists in every biological-media editor or selector, preserve unknown historical values visibly, and normalize water aliases at both UI filtering and API validation boundaries.