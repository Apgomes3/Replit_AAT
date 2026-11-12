---
name: Business Development enquiries
description: Governing Client, Enquiry, Project-link, and quote snapshot rules for Business Development.
---

A Client is reusable master data. An Enquiry is the primary commercial record and belongs to one Client.

**Why:** Commercial requests can arrive before engineering creates a Project, while the same Client may make many unrelated requests over time.

**How to apply:** Let an Enquiry remain standalone, link it to an existing Project, or create a new Project from it. Project and Design Book references require access to those modules. Do not reintroduce Business Books or Opportunities.

A Client represents an organization, not a person. Employee contacts belong underneath the Client as separate records, and the organization itself has no operational contact email.

**Why:** One company may have several people involved in different enquiries, so storing one email on the company loses the relationship between a person and their contact details.

**How to apply:** Store employee name, email, phone, job title, and optional primary status as Client contacts. Use the controlled country list for the organization. Preserve Enquiry contact details as snapshots rather than live references.

Quote lines imported from a linked Design Book Equipment Breakdown are point-in-time snapshots. They may be replaced only while the quote is a draft.

**Why:** Engineering and pricing continue to change, but issued customer commitments must remain reproducible.

**How to apply:** Preserve source identity and snapshot data on each imported line. Allow only forward quote lifecycle transitions; never roll an issued or terminal quote back to draft to refresh it.

PIM product quotations do not require a Project or Design Book. Engineering re-imports must preserve independently selected PIM lines.

**Why:** The user needs to prepare an Enquiry quotation directly from the PIM catalogue before engineering work exists.

**How to apply:** Capture product identity and catalogue evidence at selection time. Prefill only the PIM selling price in the quote currency; missing or differently denominated prices require an explicit selling price, never a cost fallback or assumed conversion. Freeze issued quotations and do not relabel existing line prices by changing currency.

Enquiry quotes also need non-PIM lines for installation fees, freight, and similar commercial charges.

**Why:** The user needs these costs included in the offer without creating catalogue products for them.

**How to apply:** Allow custom descriptions, quantities, units, and explicit selling prices in the quote currency. These lines need Commercial manage access, not PIM access, and must survive engineering re-imports. Apply the same draft-only editing and issued immutability rules as product lines.

Draft quote mutations must refresh the authoritative quote revision before enabling another line action.

**Why:** A successful edit followed immediately by removal can otherwise capture the pre-save revision and falsely conflict with the edit that just succeeded.

**How to apply:** Keep the workspace busy through its post-save refresh. Capture edit/delete revision tokens when those interactions start, rather than replacing their baseline during background refreshes.

Client, Enquiry, and Quote numbers are controlled and generated transactionally. Each quote has its own selling currency.

**Why:** Commercial records need stable identities and flexibility for client-facing currencies.

**How to apply:** Allocate numbers server-side and never combine unlike currencies into one total without governed conversion. Preserve legacy Business Book data through an idempotent backfill into Clients and Enquiries.