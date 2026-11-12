---
name: Exhibit lighting snapshots
description: Governing rule for PIM-linked exhibit lighting power and Design Book history.
---

PIM-linked exhibit lights retain the source identity, copied description, and normalized physical kW load captured when selected. Changing between W and kW changes only the displayed value, not the physical load. A different PIM selection explicitly creates a new captured basis.

**Why:** Ordinary quantity edits or later Product Master changes must not silently rewrite the electrical load or evidence already owned by the Design Book.

**How to apply:** Treat PIM-linked power as read-only except for unit display conversion. Preserve lighting rows in review/release packages, revisions, and version restores; if a referenced PIM record is later deleted, keep the captured values and restore with a null live link.