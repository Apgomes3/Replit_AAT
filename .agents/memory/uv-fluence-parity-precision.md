---
name: UV fluence parity precision
description: Precision basis for reproducing the contractual UV fluence parity cases.
---

Use the workbook's full-precision UV flow when checking the seven contractual fluence parity results. The specification table displays flow in L/s to four decimal places, and those displayed values do not reproduce several expected results within the stated 0.0001 mJ/cm² tolerance.

**Why:** Recomputing from the displayed flow introduces an error larger than the acceptance tolerance in multiple cases even though the formula and units are correct.

**How to apply:** Keep full-precision m³/h inputs in parity fixtures and calculation snapshots. Treat the four-decimal L/s figures as display values only; round fluence only for presentation after compliance checks.