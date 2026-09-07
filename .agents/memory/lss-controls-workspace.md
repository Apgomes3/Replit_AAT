---
name: LSS controls workspace
description: Durable navigation and evidence rules for Design Book control and field-instrument management.
---

Control and Field Instruments is an independent Design Book-level workspace immediately after Friction Loss. It first presents all Life Support Systems, then drills into one LSS without returning control configuration to the individual LSS detail tabs.

Governed AAT control logic may be copied into a new instrument instance, but the copied value becomes designer-owned evidence and may be edited. When no governed default exists, the designer must provide logic before the instrument can be saved.

**Why:** Control and instrumentation is expected to grow into a substantial area, and issued designs must not change when administrators later edit catalog defaults.

**How to apply:** Keep Design Book URLs addressable to both the main workspace and selected LSS. Freeze saved logic, tags, definition metadata, and product evidence for review, release, and version restore.