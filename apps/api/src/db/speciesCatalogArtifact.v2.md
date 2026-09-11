# Species catalog v2–v4 review summary

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

Version 3 is the next additive expansion and adds 29 reviewed marine pelagic
fish: 12 Carangidae trevallies, jacks, amberjacks, and pompano, plus 17
Scombridae tunas, tuna relatives, bonito, mackerels, Spanish mackerels, and
wahoo. The scope favors species useful for public-aquarium education or large
pelagic planning discussions without claiming to cover every species in either
family.

All v3 records use `Marine` as their planning water type. Size and mass are
explicitly provisional adult-scale planning references and are not husbandry
limits, legal/conservation assessments, or final engineering design values.
Engineers must verify each value against institution-approved references before
design use.

Version 4 is an additive collection of 20 commonly planned freshwater lake
fish. It includes koi and other carp, largemouth and smallmouth bass, white
bass, brown/rainbow/lake trout, northern pike and muskellunge, European and
yellow perch, bluegill and pumpkinseed sunfish, walleye, black and white
crappie, channel catfish, and brown bullhead. This is a representative planning
collection rather than an attempt to catalog every freshwater or lake species.

Scientific names and family placement use accepted species identities from the
GBIF Backbone Taxonomy, with common names reviewed against freshwater fisheries
and public-aquarium reference usage. All v4 records use `Freshwater` as their
planning classification. Their positive size and mass values are provisional
adult-scale planning references, not final engineering limits or husbandry,
welfare, conservation, or legal guidance. Institution-approved references must
be checked before design use.

## Import and history policy

`speciesCatalogArtifact.v2.json`, `speciesCatalogArtifact.v3.json`, and
`speciesCatalogArtifact.v4.json` are additive, reviewed artifacts layered on
the immutable v1 artifact. Normal setup loads all four artifacts without a
network request. Inserts use conflict-ignore
semantics, so repeat setup is idempotent; existing catalog rows and
snapshot-backed exhibit allocations are not updated or deleted. Corrections
remain available through the existing catalog maintenance workflow and do not
rewrite captured allocation values. The unique case-insensitive scientific-name
index prevents duplicate identities across artifact versions.

Coverage: 19 penguins and 29 sharks in v2, 29 pelagic fish in v3, and 20
freshwater lake fish in v4, for 97 reviewed expansion records. The composed
catalog therefore contains 617 records when loaded with v1.