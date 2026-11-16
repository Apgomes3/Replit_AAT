# PIM redesign proposal

*November 2026 · study of Plytix, AtroPIM, UnoPim and Pimcore, applied to Shark OS*

## 1. The short version

Plytix, AtroPIM, UnoPim and Pimcore are built to **publish product content** to shops and marketplaces
(channels, languages, images, marketing copy). Shark OS's PIM has a different job: it is an
**engineering master catalogue** that feeds calculations (pump selection, UV, ozone, thermal, sand filters),
bills of materials, equipment breakdowns, quotes, purchase orders and technical data sheets.

So we should **borrow their structure, not their features**:

1. **One item catalogue** instead of separate products / components / tank catalogues.
2. **Families as templates** that decide which attributes an item has (AtroPIM "classifications", UnoPim/Plytix "families").
3. **An attribute library with units** — every technical value is a defined attribute with a unit, range and group.
4. **Variants with inheritance** — a parent item and its variants (e.g. the GPO and PLC skid versions of one UV unit).
5. **Typed relationships** — accessory, spare part, replaces, compatible with, made of (BOM).
6. **Supplier offers with price history** — the price list import writes offers; cost comes from the preferred offer.
7. **Completeness and lifecycle** — each family says what is required before an item can be released.

…while keeping the ~25 values the engineering calculators depend on as **typed, queryable fields**
(Pimcore's lesson: a pure key/value store is flexible but bad for anything you calculate or filter on).

## 2. What we have today

| | Today | Problem |
|---|---|---|
| `product_masters` | **52 columns**: generic fields **plus** tank-only fields, UV lamp count, ozone g/h, control/signal types, bio-degas plenum snapshots | Every product carries every discipline's fields; adding a product type means altering the table |
| Technical data | Fixed side tables: dimensions, electrical, hydraulic, thermal, pneumatic | Good idea, but fixed per discipline; pneumatic has 0 rows |
| Flexible attributes | `family_classifiers` + `product_classifier_values` | Started, never adopted (1 template, 0 values) |
| Catalogues | `product_masters`, `components`, `tank_families` (+ `product_families`) | Same concepts twice (manufacturer, model, cost, sell price, currency on both) |
| Variants | `product_variants`, `product_configurations` | 0 rows; configurations only exist in the migration — dead |
| Duplicates | Dimensions on the product **and** in `product_dimensions`; category as text **and** via family; `cost` **and** `cost_price` | Values can disagree; nobody knows which is right |
| Suppliers / cost | `vendor_options` (no date, no history); cost rolled up from BOM unless overridden | No price history; "where did this cost come from?" is hard to answer |
| Dependencies | `design_flow_m3h` 229 code references, product category 121, tank fields 109, UV `lamp_count` 66 | Any change must keep these working during migration |

## 3. What the four systems teach

| System | Model in one line | Borrow | Avoid / not relevant |
|---|---|---|---|
| **Plytix** (SaaS) | Products → families → attributes; parent / variant / sub-variant with per-attribute inheritance | Choosing per attribute whether variants **inherit** or **override**; "resync" an overridden value back to the parent; completeness attributes | E-commerce channel/feeds focus; limited depth for complex technical data |
| **AtroPIM** (open source, PHP) | Everything is an entity; **classifications** are templates that attach attributes; attributes are standalone with **measures/units**, groups, panels, min/max, required, protected | **Classifications as templates**; **attribute library with measures & unit conversion**; attribute groups; optional **ETIM** standard classification for technical products; "only allow attributes via classification" governance switch | Generic everything-is-an-entity UI can feel heavy |
| **UnoPim** (open source, Laravel, MIT) | Attribute families, attribute groups, configurable products with **variant axes**, channels/locales, **measurement families**, completeness, history, AI agents | **Variant axes** (UV: power × housing × panel type); **completeness per family**; **field-level history with rollback**; AI-assisted enrichment as an *optional, review-first* helper | Locale/channel scoping on every attribute (we don't publish to shops) |
| **Pimcore** (open source, enterprise MDM) | Data-object classes with inheritance & variants; **object bricks** (optional typed field groups) vs **classification store** (sparse key/value, runtime-extensible) | The **hybrid rule**: typed fields/bricks for the attributes you query and calculate with; sparse store for the long tail. Pimcore's own guidance: bricks for a manageable number of categories, classification store beyond ~30 categories with many attributes | Its complexity and developer-heavy setup |

## 4. Proposed structure

```
Item  (one catalogue: equipment, component, consumable, spare part, tank, skid)
 ├─ family            → template: attribute groups, required attributes, variant axes, code pattern
 ├─ parent item       → variants inherit values unless overridden
 ├─ core fields       → code, name, kind, status/lifecycle, manufacturer, model, description
 ├─ engineering facts → typed, unit-checked values the calculators use (design flow, power, head, ozone g/h, lamp count …)
 ├─ attribute values  → everything else, sparse: (item, attribute, value, unit)
 ├─ relationships     → accessory_of, spare_part_of, replaces, compatible_with, requires, BOM line (component of)
 ├─ supplier offers   → supplier, supplier code, price, currency, valid from/to, lead time, MOQ, preferred
 ├─ pricing           → cost (preferred offer | BOM roll-up | manual), markup rule, sell price
 ├─ documents/assets  → datasheet, drawing (DWG), image, TDS, certificate — typed links to the document register
 └─ history           → who changed which field when (from the audit log), revisions on release
```

### 4.1 One item catalogue
Merge products and components into **items** with an `item_kind` (equipment, component, consumable, spare part,
tank, skid assembly). A BOM line then always points to an item. Components keep their own list screen
(filtered by kind) so nothing changes for users who think in "components".
*Why:* the ASW import already showed the overlap — filter socks, media and skid parts are "components" today but
have exactly the same supplier/price/manufacturer data as products.

### 4.2 Families become templates
A family (tree: *Filtration › Sand Filters*) defines: attribute groups shown on the item page, which attributes are
**required for release**, variant axes, and a code pattern (e.g. `SF-{diameter}`). Product categories become the
top level of this tree instead of a separate text field. `tank_families` folds into the same tree.

### 4.3 Attribute library with units
Each attribute: code, label, type (number, range, text, list, boolean, link), **measure** (flow, power, pressure,
length, mass, volume, temperature…) with a default unit and conversions (m³/h ↔ l/s, kW ↔ HP, bar ↔ m head), min/max,
group (Hydraulic, Electrical, Dimensions, Thermal, Water quality, Commercial…).
Values are stored in the default unit and shown/entered in any unit of the measure. This removes the
"l/s in the description, m³/h in the field" problem visible in the price list (`36.0l/s 11kW @ 18m`).

### 4.4 Hybrid storage (the Pimcore rule)
- **Engineering facts** (~25 attributes the calculators and design books read: design flow, min/max flow, head,
  pressure, rated power, ozone output, UV lamp count/power, dimensions, volume, weight, sand media mass…) stay as
  **typed columns** in discipline tables (hydraulic, electrical, thermal, dimensions — which we already have).
  They are registered in the attribute library too, so they look and behave like any other attribute in the UI.
- **Everything else** goes to a sparse `item_attribute_values` table. New product types then need no schema change.
- The 52-column `product_masters` shrinks to the core; tank, UV, ozone, control and plenum fields move to their
  discipline tables or attributes.

### 4.5 Variants with inheritance
Parent item + variants along the family's axes (UV: power × housing material × panel GPO/PLC; pumps: size × motor).
Each attribute is either **inherited** (description, family data, datasheet) or **variant-level** (code, price,
panel type), with "reset to parent" for overridden values.
*Immediate payoff:* the 19 "several rows resemble one product" cases from the ASW import are exactly
GPO/PLC variants of one parent.

### 4.6 Typed relationships
Replace ad-hoc links with one relationship table and a type list: accessory of, spare part of, replaces /
superseded by, compatible with, requires, alternative to. Spare parts from the "LSS Spare Parts" sheet become
`spare_part_of` the UV units (with "quantity per unit" — already in the price list's *Notes 2*).

### 4.7 Supplier offers and cost authority
`vendor_options` → **supplier offers** with valid-from date, so every price-list import adds a dated price instead of
overwriting it (price history for free). Cost source per item is explicit: *preferred offer*, *BOM roll-up* or
*manual* — replacing the `cost_is_override` flag, which today silently decides whether a cost survives.
Markup can be a family rule (the price list has markup per row; we dropped it for now).

### 4.8 Completeness and lifecycle
Item lifecycle **Draft → Released → Obsolete** (with *Superseded by*), mirroring Design Books. Missing required
attributes show as a **completeness %** on lists and as a "what's missing" panel (UnoPim/Plytix); release warns
when an item is incomplete, and a family can be switched to block release once its data is clean (decision 4). A data-quality page lists incomplete, unpriced, and duplicate-looking items.

### 4.9 Documents and history
Datasheets, drawings, images and generated TDS are linked from the document register with a link type, instead of
`image_url` and scattered file fields. A **History** tab on each item reads the audit log field by field.

### 4.10 Optional, later
- **ETIM classification** (AtroPIM/Pimcore support it): standard classes for pumps, valves, UV — useful if AAT
  exchanges data with suppliers or customers who use ETIM. Not needed to start.
- **AI enrichment** (UnoPim-style), review-first only: e.g. extract specifications from a supplier PDF into the
  attribute form for a human to confirm.
- **Multilingual names/descriptions** (EN + 中文) if the China team or factories should see the catalogue in Chinese.

## 5. What to delete or merge

| Remove / merge | Reason |
|---|---|
| `product_configurations` | 0 rows, only exists in the migration |
| `product_variants` | 0 rows; replaced by parent/variant items (4.5) |
| `product_pneumatic` | 0 rows; becomes attributes |
| `family_classifiers`, `product_classifier_values` | Superseded by the attribute library (1 template, 0 values today) |
| `product_masters.cost_price` | Empty; `cost` is the real field |
| `product_masters.product_category` (text) | Derive from the family tree |
| Dimension columns on `product_masters` | Duplicate of `product_dimensions` |
| Tank / UV / ozone / control / plenum columns on `product_masters` | Move to discipline tables or attributes |
| `tank_families` | Fold into the family tree |
| `vendor_options` | Becomes supplier offers (with dates) |

## 6. How to get there without breaking anything

The calculators read these fields hundreds of times, so this is a **strangler** migration, family by family:

1. **Foundation** — attribute library + measures/units, family templates, `item_attribute_values`, PIM code moved
   into `apps/api/src/modules/pim/` (the current `products.ts` is 2,169 lines). Nothing removed yet.
2. **Compatibility view** — a `product_masters` view (or kept columns) so existing calculator queries keep working
   while data moves.
3. **One family at a time** — start with a simple, high-value family (e.g. Sand Filters or Heat Exchangers): move
   its fields, add required attributes, check calculators and TDS output, then the next family. UV and pumps last
   (most calculation coupling).
4. **Supplier offers + price history**, then re-run the ASW import into offers.
5. **Variants**, then **relationships** (spare parts), then **completeness/lifecycle**.
6. **Delete** the dead tables/columns from §5 once nothing reads them.

Each step is its own commit with tests (`npm run check`), like Phase 0.

**Progress**
- *Step 1, 2026-11-13:* attribute library in `apps/api/src/modules/pim/` — measures and units with conversion
  (`units.ts`), the 34 engineering facts registered as typed attributes (`engineeringAttributes.ts`, read from their
  existing columns), attribute groups, family templates (required / variant axis), sparse item values stored in base
  units, and warn-only completeness. Screens: PIM › Attributes (library, family templates, units) and an
  Attributes tab on each product. The old Drum Filters "Voltage" classifier was carried over to its template.
- *Step 1 finished, 2026-11-16:* the product routes moved out of `routes/products.ts` into
  `apps/api/src/modules/pim/products/` — `familyRoutes`, `productMasterRoutes`, `bomAndSourcingRoutes`,
  `componentRoutes`, `engineeringDataRoutes` and `shared` helpers, mounted in the original order by `index.ts`.
  Same 63 endpoints, same paths; no behaviour change.

## 7. Decisions (agreed 2026-11-13)

| # | Question | Decision |
|---|---|---|
| 1 | One item catalogue, or keep products and components apart? | **One catalogue** (§4.1). Components keep their own filtered list screen. |
| 2 | GPO/PLC skid versions: variants of one UV item? | **Yes, variants** of one parent (§4.5). |
| 3 | Keep every price-list price as a dated supplier offer? | **Yes, price history** (§4.7). |
| 4 | Does "Released" require completeness? | **Warn only, for now.** Release is allowed with a visible "incomplete" warning and the completeness %. Each family gets a switch to make it blocking later, once its data is clean (expected first for items used in quotes and TDS). |
| 5 | Languages | **English only now; full translation later.** Translatable text (names, descriptions, attribute and family labels) is kept in one place so a translations table can be added later without remodelling. Numbers and units need no translation. |
| 6 | ETIM / eCl@ss | **Not now.** Revisit if a supplier sends ETIM/BMEcat data or a customer's procurement asks for eCl@ss codes. The attribute library (§4.3) uses units and measures that would map onto either standard. |
| 7 | Timing of the ASW import | **Done** into today's structure (2026-11-12); it migrates with everything else. |

## Sources

- Plytix: [product families](https://help.plytix.com/en/how-to-create-and-manage-product-families),
  [Product Families iteration 2](https://help.plytix.com/en/getting-started-with-product-families-iteration-2),
  [variant inheritance playbook](https://www.plytix.com/playbooks/product-variant-management-inheritance/),
  [automatic inheritance release note](https://www.plytix.com/release-notes/automatic-inheritance),
  [glossary](https://help.plytix.com/en/plytix-glossary)
- AtroPIM / AtroCore: [classifications](https://help.atrocore.com/latest/pim/classifications),
  [attributes](https://help.atrocore.com/atrocore/administration/attribute-management/attributes),
  [measure units](https://help.atrocore.com/atrocore/measure-units),
  [understanding AtroPIM](https://help.atrocore.com/pim/getting-started/understanding-atropim),
  [ETIM extension](https://store.atrocore.com/en/etim-classification/10067)
- UnoPim: [repository](https://github.com/unopim/unopim), [field guide](https://skills.tenten.co/original-html/unopim-guide-en.html)
- Pimcore: [object bricks vs classification store](https://docs.pimcore.com/platform/Pimcore/Best_Practice/Object_Bricks_vs_Classification_Store),
  [classification store](https://docs.pimcore.com/platform/Pimcore/Objects/Object_Classes/Data_Types/Classification_Store/),
  [data object classes](https://docs.pimcore.com/platform/Pimcore/Objects/Object_Classes/),
  [ETIM with the classification store](https://pimcore.com/en/resources/blog/etim-classification-with-pimcore-s-classification-store-at-jAger-direkt-gmbh-co.kg_a127883)
