---
name: Flow Route fractionator controls
description: Information hierarchy and interaction rules for Foam Fractionator cards in Flow Route.
---

Foam Fractionator presentations must establish hydraulic meaning before sizing: show the parent loop allocation and derived flow first, followed by linked Bio/Degas allocation and derived branch flow when applicable. An unlinked branch must say it is not connected and must not imply a flow.

**Why:** Capacity numbers are ambiguous without their parent hydraulic context, and hidden flip-card controls made engineering review and editing difficult to understand.

**How to apply:** Keep each model summary stable and independently expandable. Details/Hide details only reveals metrics and never changes saved values. Quantity and removal remain directly discoverable in edit mode and absent from read-only or reviewed views.