---
name: Exhibit tank replacement
description: Defines the safe interaction and identity rules for replacing an exhibit's in-use tank.
---

When an exhibit already has a tank, keep assignment and creation tools hidden behind an explicit “Add a New Tank” action. Completing that flow replaces the current tank; Cancel or Escape returns without changing it.

Replacement must preserve the existing project-tank identity while replacing its definition or assignment.

**Why:** Design Book calculations and related records may already reference the project tank. Preserving its identity avoids orphaning or silently disconnecting downstream exhibit data.

**How to apply:** Use an explicit confirmation before replacement. Manual creation updates the current project tank in place, PIM selection uses the protected PIM replacement workflow, and selecting another project tank swaps exhibit assignments atomically.