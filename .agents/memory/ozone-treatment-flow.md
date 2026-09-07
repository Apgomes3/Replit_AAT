---
name: Ozone treatment flow
description: Governs flow evidence, unit handling, and PIM generator selection for LSS ozone calculations.
---

Ozone treatment flow is the sum of governed FFSP flow and only those FFVP flows whose individual circuits are explicitly configured to draw directly from the plenum. The default target is 0.05 mg/L.

**Why:** An FFVP recirculating through the fractionator does not introduce additional plenum water to ozone treatment and must not double-count flow. Unit selection is presentation only.

**How to apply:** Calculate mg/h as concentration in mg/L × treatment flow in m³/h × 1,000 L/m³. Freeze source pump lines and direct-plenum choices; derive g/h and lb/h from the same mg/h result.

Generator capacity comes from the dedicated numeric PIM g/h value, never by parsing the model name. Select one model and the required integer quantity that gives the closest installed capacity at or above demand; use fewer units to break equal-capacity ties. Capacity above 30% remains valid and receives an advisory note rather than a warning; missing capacity is FAIL. Freeze the selected product evidence and validation with the Design Book calculation.

**Why:** Product names are not controlled calculation data, and later PIM edits must not silently rewrite reviewed equipment evidence.

**How to apply:** Recalculate live drafts from active PIM products, perform validation on the server, and retain the saved allocation snapshot for review and release.