# Species catalog v2 review summary

## Reviewed scope

Version 2 is an additive expansion of the v1 public-aquarium planning catalog. It
includes a broad set of 19 extant penguin taxa accepted by the GBIF Backbone
Taxonomy across the six living penguin genera, plus 29 sharks selected for
public-aquarium relevance. The reviewed penguin scope includes accepted splits
such as eastern rockhopper and royal penguins rather than asserting one
universally agreed species total:

- 4 Carcharhinidae
- 3 Ginglymostomatidae
- 5 Hemiscylliidae
- 3 Heterodontidae
- 3 Orectolobidae
- 1 Stegostomatidae
- 3 Scyliorhinidae
- 2 Triakidae
- 1 Rhincodontidae
- 1 Odontaspididae
- 2 Sphyrnidae
- 1 Hexanchidae

Penguins are represented by Spheniscidae. Sharks are intentionally a reviewed
subset rather than an attempt to import every known species. Selection favors
species already familiar in public-aquarium displays, education programs, or
aquarium planning references and includes a range of body plans and exhibit
scales.

## Provenance and assumptions

- Scientific names and family placement use accepted-name records from the GBIF
  Backbone Taxonomy as the taxonomy provenance baseline. Common names were
  reviewed against public-aquarium reference usage; a missing common name is
  acceptable in the catalog.
- `Marine` is the default planning classification for marine penguins and sharks.
  `Carcharhinus leucas` is marked `Brackish` because its euryhaline biology makes
  an estuarine/brackish planning classification useful. This is a planning
  category, not a husbandry protocol or final salinity limit.
- Size and mass are clearly labeled provisional planning references in every
  v2 record. They are representative adult-scale values for early sizing,
  biomass, and search workflows, not guaranteed maxima, minimums, or welfare
  limits. Engineers must verify the values against the institution's approved
  references before design use.
- The artifact does not encode husbandry protocols, welfare guidance, legal or
  conservation status, or engineering design limits.

## Import and history policy

`speciesCatalogArtifact.v2.json` is an additive, reviewed artifact layered on
the immutable v1 artifact. Normal setup loads both artifacts without a network
request. Inserts use conflict-ignore semantics, so repeat setup is idempotent;
existing catalog rows and snapshot-backed exhibit allocations are not updated or
deleted. Corrections remain available through the existing catalog maintenance
workflow and do not rewrite captured allocation values.

Coverage: 19 penguins and 29 sharks, 48 new records total. The composed catalog
therefore contains 568 records when loaded with v1.