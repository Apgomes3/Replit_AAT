---
name: Flow Route matched circulation
description: Authority, compatibility, and validation rules for non-allocating matched circulation loops.
---

Matched circulation is an explicit mode available to Break Tank and Plenum Tank loops. It is a live reference to another configured loop’s resolved flow, does not enter the shared 100% allocation, and remains a distinct circuit. Missing targets, self-reference, cycles, invalid sources, and unconfigured targets must resolve as unavailable rather than retaining or inventing flow. Records without an explicit matched mode remain percentage-allocated for backward compatibility, regardless of source label.

**Why:** Flow must stay consistent across filtration, UV, pumps, calculations, release checks, and frozen review data without silently changing legacy records or combining hydraulic circuits.

**How to apply:** Route every engineering consumer through the canonical match resolver, persist mode and target in snapshots, and clear the match relationship whenever an editor changes away from a circulation source.