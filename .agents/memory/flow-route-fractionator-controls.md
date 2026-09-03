---
name: Flow Route fractionator controls
description: Information hierarchy and interaction rules for Foam Fractionator cards in Flow Route.
---

Foam Fractionator presentations must establish hydraulic meaning before sizing: show the parent loop allocation and derived flow first, followed by linked Bio/Degas allocation and derived branch flow when applicable. An unlinked branch must say it is not connected and must not imply a flow.

**Why:** Capacity numbers are ambiguous without their parent hydraulic context, and hidden flip-card controls made engineering review and editing difficult to understand.

**How to apply:** Keep each model summary stable and independently expandable. Show FF required flow and Sand Filter loop flow as read-only percentages of total system flow; these shares never become saved inputs or change sizing. In List view, use a dedicated equipment-share column and do not repeat raw loop allocation wording beneath Loop Flow. Details/Hide details only reveals metrics and never changes saved values.