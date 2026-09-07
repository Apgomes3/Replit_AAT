---
name: Ozone treatment flow
description: Governs the flow evidence and unit handling for LSS ozone dose calculations.
---

Ozone treatment flow is the sum of governed FFSP flow and only those FFVP flows whose individual circuits are explicitly configured to draw directly from the plenum. The default target is 0.05 mg/L.

**Why:** An FFVP recirculating through the fractionator does not introduce additional plenum water to ozone treatment and must not double-count flow. Unit selection is presentation only.

**How to apply:** Calculate mg/h as concentration in mg/L × treatment flow in m³/h × 1,000 L/m³. Freeze source pump lines and direct-plenum choices; derive g/h and lb/h from the same mg/h result.