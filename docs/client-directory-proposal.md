# One client directory for the whole of Shark OS

Status, 16 Nov 2026: **step 1 built** (directory, people, Clients & Contacts in the navigation, client picker
with duplicate warning, enquiries use the picker and link to the client). Steps 2–4 to do.

## What we have today

| Where | How the client is stored | Problem |
|---|---|---|
| Business Development › Clients | `clients` table (code `CL-2026-0001`, name, country, website, address) with `client_contacts` | Only reachable inside Business Development; the routes require the `business_development` module. |
| Enquiries | `enquiries.client_id` → `clients` (good), plus the contact **copied** as text into `contact_details` | The contact is a copy: change their email on the client and the enquiry still has the old one. |
| Projects | `projects.client_name`, free text | Not linked to `clients`. 11 of 27 projects have a name, already with duplicates ("Bass pro" and "Basspro"; "Seaworld" vs the client "Sea World Gold Coast"). |
| Business books | `business_books.client_name` + `client_details` JSON, free text | Same as projects (no rows yet). |
| Design books | Through their project only | Fine once projects are linked. |
| Suppliers | `vendor_options.vendor_name`, `purchase_orders.vendor_name`, free text (22 names, e.g. "GF" and "Georg Fisher") | Same kind of problem, on the buying side. |

Contacts today: name and email are both required, there is no "left the company", and every save deletes and re-creates
all of a client's contacts, so a contact has no lasting identity that a project or enquiry could point to.

Data today: 1 client, 0 contacts, 1 enquiry, 11 project client names. So now is the cheapest moment to fix it.

## The idea

One directory of **companies** with their **people** (contacts), used everywhere a client appears. A project, enquiry,
business book or quote points at the company and, where useful, at the person. Wherever a client name shows, it is a
link to the client page, and the client page shows everything about them.

### Companies (keep the `clients` table, widen it)
- Kinds (one or more): client, consultant, contractor, partner, supplier. A company can be a client on one job and a
  contractor on another.
- Parent company (optional): e.g. "SeaWorld Parks" → "Sea World Gold Coast", "Bass Pro Shops" → its sites.
- Country, city, website, address, notes, active. Code stays `CL-YYYY-NNNN`.
- Duplicate guard: creating "Basspro" when "Bass Pro" exists shows "Did you mean Bass Pro?" (name compared without
  spaces, case and punctuation).

### People (contacts)
- Name required; email **or** phone (not both required); job title, mobile, notes.
- Stable: editing a contact updates it in place. "Left the company" instead of delete, so history keeps the name.

### Links
- Project: one **client** (`client_id`), plus other companies with a role (consultant, contractor, operator) and
  key people with a role (client PM, consultant engineer, site contact).
- Enquiry: company + contact by reference (the text copy stays as a snapshot of what was received).
- Business book: company by reference.
- Suppliers (later step): vendor options and purchase orders point at supplier companies.

### Access
- New module "Clients & contacts": everyone can **view**; Business Development, project managers and admin can
  **manage**. It no longer needs Business Development access.

### Screens
- **Clients** in the left navigation, top level (not under Business Development).
- Client page: Overview, People, Projects, Enquiries & quotes, Design books, Activity.
- A client picker (search, with "add new" and the duplicate guard) in: new/edit project, enquiry, business book.
- Client chip (name → client page) on project headers, project list, enquiry pages, design books.

## Moving the current data

Project client names become companies like this (confirmed 16 Nov 2026):

| Projects | Text today | Becomes |
|---|---|---|
| 001-034, 001-132 | Bass pro / Basspro | **Bass Pro Shops** (written as three words) |
| 061-300 | Seaworld (Australia) | the existing **Sea World Gold Coast** |
| 001-033 | AAT | **Aquarium of Guam** |
| 001-250, 052-001, 052-300, 091-006, 095-001, 886-006, PRJ-TY-001 | Coral Vita, Pairi Daiza, Acuario de Michin, Aishwarya, Motama, NRH, Taoyuan City Government | one company each, country from the project |

The 16 projects without a client stay without one until someone picks it.

## Steps

1. **Directory** — module access, company kinds and parent, stable contacts (email optional, "left"), Clients in the
   navigation, client page with People, the picker with the duplicate guard.
2. **Projects** — `client_id` on projects, move the 11 names (after your confirmation), picker in project create/edit,
   client chip on project pages and list, Projects tab on the client page. Free-text `client_name` kept read-only for a
   while as a fallback, then removed.
3. **People on work** — project companies and people with roles; enquiries and business books point at the contact;
   Enquiries and Design books tabs on the client page.
4. **Suppliers** (later) — vendor names become supplier companies with their people; vendor options and purchase
   orders point at them.

Each step: tests, back-up of the real database before migrating, its own commit.
