# Shark OS roadmap — planning, people and PIM

Status on 16 Nov 2026, and the plan from here. Each step ends in its own commit with tests (`npm run check`).
Items marked **You** need a decision or data from the business before (or while) they are built.

## Where we are

| Area | State |
|---|---|
| Drafting plans | List and Gantt views, task links (FS/SS/FF/SF with lag), Planner import (83 links). |
| Planning engine | Working calendars with holidays, automatic scheduling on working days with Undo, progress, milestones, baseline, critical path. |
| Company resources | Teams by department (a person can be in several teams), Resources page (company workload by team, teams, people, calendars). Drafting shows only its own teams. |
| Calendars | China office (2026–27, Mon–Fri 9 h, Sat 8 h), Australia, New Zealand, Philippines, United States (2026–27). |
| People and access | 80 users. Access roles: admin, manager, user (manager and user edit like the old engineer role). Job position and "reports to" on each user. |
| My Work | On everyone's Home page: their week (booked vs available), every plan task assigned to them, their own tasks (with or without a project), regular commitments (meetings, share of time). |
| PIM | Attribute library, units, family templates (only Drum Filters has one), Attributes tab; product routes now in `modules/pim/products/`. |
| Exchange rates | All 13 currencies set. SGD 1.288, CAD 1.426, JPY 159.7, TWD 32.90 per USD (market, 13 Nov 2026). |

## Step 1 — finish the set-up (now, mostly **You**)

- **You:** check the teams and their managers in Resources › Teams.
- **You:** finish people's calendars in Resources › People (the ones not yet placed are on China office).
- **You:** set "Reports to" for each person in Admin › Users (direct line manager, independent of teams), one by one
  or offline: **Export** the list, fill `reports_to_email` (or `reports_to_name`) and `job_title`, save as CSV UTF-8,
  then **Update reporting** to preview and save the changes.
- **You:** decide module access for the `user` role in Admin › Roles (today it can manage every module), and
  fix `viewer`, which has manage access on most modules.
- **You:** fill in the 16 projects created by the Planner import (client, country/city, status, project manager)
  and give `064-XXX NZ Underwater UV` and `001-XXX Pond Fishing Pool` their real numbers (open the project › Edit ›
  Project Code; codes already issued from the old number, such as BOM release numbers, keep it).

## Step 2 — who sees what (next build)

Uses "reports to" from step 1.

- Everyone sees their own work. A manager sees the people who report to them (directly and further down) and the
  members of teams they manage. Chosen roles (admin, Resources view) see the whole company.
- Workload, People and My Work for others follow the same rule; leave shows as "away" without the reason.
- Managers can add tasks and commitments for their people from Resources (today only for yourself).
- "My team" view on Home for managers: their people's week at a glance.

## Step 3 — calendar sync (per user)

Yes, per user: each person connects their own calendar once, and only they can disconnect it.

- **Microsoft 365 first** (company mail and OneDrive are Microsoft). Read-only access (`Calendars.Read`) through
  Microsoft Graph; meetings in their working hours count as booked time in My Work and the workload, shown as
  "Calendar" items. Private meetings show as "Busy" without a title.
- Needs: an app registration in the company's Microsoft Entra (Azure AD) tenant by IT, admin consent, and Shark OS
  running on its hosted address (HTTPS callback). So this comes **after hosting** (step 5).
- Later: Google Calendar for anyone outside Microsoft 365; Outlook "out of office" as leave.

## Step 4 — PIM family templates (**You**: confirm, then I load them)

A family template says which attributes every product in the family should have (**required**) and which ones
distinguish its variants (**variant axis**). Completeness warnings and the Attributes tab follow it. To build them I
need, per family, a yes/no on the draft below and any attribute that is missing. Draft from the 34 attributes we have:

| Family (products) | Required | Variant axis | Missing attributes to add? |
|---|---|---|---|
| UV Sterilizers (57) | lamp power, UV lamp count, max flow, max pressure, voltage, inlet DN, outlet DN | lamp power | UV dose, lamp life, housing material |
| Pumps (45) | design flow, design head, rated power, voltage, phases, frequency, suction DN, discharge DN | rated power | efficiency, impeller/body material |
| Ozone Generators (31) | ozone output, rated power, voltage, frequency | ozone output | feed gas (air/O₂), concentration |
| Sand Filters (26) | diameter, design flow, max pressure, sand media per filter, inlet DN, outlet DN | diameter | filtration rate, media grade |
| Instrumentation (24) | voltage | — | measured parameter, range, output signal |
| Electrical Control Panels (20) | voltage, phases, frequency, rated power | — | IP rating, number of outputs |
| Sumps & Break Tanks (18) | length, width, height, gross volume, operating volume | gross volume | material |
| Heat Exchangers (15) | max flow, max pressure, max temperature, inlet DN, outlet DN | — | heat duty (kW), plate/shell type, material |
| Heat Pumps & Chillers (14) | rated power, voltage, phases | — | heating capacity, cooling capacity, refrigerant |
| Foam Fractionators (11) | design flow, venturi flow, diameter, height | design flow | contact time, material |
| Drum Filters (7) | design flow, voltage *(voltage already set)* | design flow | screen mesh (µm) |
| Others (pipes, air, LSS units, bag filters, lights) | weight | — | decide later |

## Step 5 — go live (hosting)

- Email sending (SMTP or Microsoft 365) so invites and password resets work.
- Host in Hong Kong as planned (Alibaba Cloud, Caddy, systemd, PostgreSQL); copy the local database across
  (users, teams, calendars, plans) instead of re-running the one-off imports.
- Then send invites, team by team, starting with Drafting.

## Step 6 — later

- Gantt extras: group summary bars, date limits on tasks, export to PDF/Excel, Board view.
- Workload "% of day" set automatically from task effort instead of by hand.
- PIM step 2 onwards (`docs/pim-redesign-proposal.md` §6): compatibility view, then family by family.
- Remove the unused `engineer` role once nothing depends on it.
