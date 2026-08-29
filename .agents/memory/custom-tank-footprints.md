---
name: Custom tank footprints
description: Measurement and lifecycle rules for optional Custom project-tank outlines.
---

Custom tank footprints are optional, but when present their normalized geometry is the authoritative source for plan area and perimeter. A Custom tank without a footprint must not silently use rectangular length × width assumptions; its manual volume remains independent.

**Why:** Designers may intentionally defer drawing an irregular outline. Fabricating rectangular plan measurements in that state makes create, edit, duplicate, and review results inconsistent and can misstate engineering inputs.

**How to apply:** Preserve accepted geometry and server-derived area through duplication and Design Book snapshots. Clear it when shape changes away from Custom, and keep project-tank identity and explicitly entered volume independent of the 2D outline.