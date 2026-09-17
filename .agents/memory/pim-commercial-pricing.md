---
name: PIM commercial pricing
description: Durable pricing authority for vendor offers, components, and BOM-derived product cost.
---

Vendor prices belong to a vendor option for one product and retain their own currency. Components are independently saleable records with cost, sell price, and currency.

Product cost uses the latest BOM total by default: quantity multiplied by each component or sub-product cost, converted into the product currency through governed exchange rates. A user-entered product cost is an explicit override; clearing it requires the dedicated return-to-BOM action.

**Why:** Commercial values have different authorities. Vendor quotations must not overwrite product or component pricing, while product assembly cost should track its BOM unless a user deliberately takes control.

**How to apply:** Recalculate non-overridden product costs after BOM or component-cost changes. Preserve overrides. Never add unlike currencies directly or silently invent missing prices.