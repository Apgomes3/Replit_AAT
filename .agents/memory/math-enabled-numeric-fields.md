---
name: Math-enabled numeric fields
description: Reliable architecture and interaction constraints for arithmetic in numeric form controls.
---

All literal numeric JSX inputs are transformed to the shared math-number component. The field remains a normal number input when idle, switches to component-owned text editing while focused, and resolves arithmetic through its existing controlled `onChange` contract on blur.

**Why:** Mutating native number inputs through document-level focus/input events makes React controlled fields reset their caret, causing values such as `51` to become `15`, and can restore native operator filtering mid-entry.

**How to apply:** Keep arithmetic behavior inside the shared component and centralized JSX transform. Do not reintroduce global DOM event mutation. Cover plain digit order, operator entry, blur resolution, and invalid-expression retention.