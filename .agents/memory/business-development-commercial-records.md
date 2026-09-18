---
name: Business Development enquiries
description: Governing Client, Enquiry, Project-link, and quote snapshot rules for Business Development.
---

A Client is reusable master data. An Enquiry is the primary commercial record and belongs to one Client.

**Why:** Commercial requests can arrive before engineering creates a Project, while the same Client may make many unrelated requests over time.

**How to apply:** Let an Enquiry remain standalone, link it to an existing Project, or create a new Project from it. Project and Design Book references require access to those modules. Do not reintroduce Business Books or Opportunities.

Quote lines imported from a linked Design Book Equipment Breakdown are point-in-time snapshots. They may be replaced only while the quote is a draft.

**Why:** Engineering and pricing continue to change, but issued customer commitments must remain reproducible.

**How to apply:** Preserve source identity and snapshot data on each imported line. Allow only forward quote lifecycle transitions; never roll an issued or terminal quote back to draft to refresh it.

Client, Enquiry, and Quote numbers are controlled and generated transactionally. Each quote has its own selling currency.

**Why:** Commercial records need stable identities and flexibility for client-facing currencies.

**How to apply:** Allocate numbers server-side and never combine unlike currencies into one total without governed conversion. Preserve legacy Business Book data through an idempotent backfill into Clients and Enquiries.