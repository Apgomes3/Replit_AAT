# Internal work and the knowledge library — proposal

16 Nov 2026. Nothing built yet; decisions needed are marked **You**.

## 1. Internal work ("initiatives")

### The problem
Client projects carry a lot of structure: client, scopes (LSS, Tanks, Acrylic…), systems, design books,
purchase orders, equipment. Internal work — a new product, a better process, an IT tool, training, a
standard — has none of that, so today it either isn't recorded or is squeezed into a catch-all project
(the Planner import already created `AAT-GEN`).

### Suggestion: a light "Initiative" record, separate from projects, sharing the planning engine
| Field | Example |
|---|---|
| Code | `INT-2026-001` (own numbering, never mixed with project codes) |
| Title, goal | "Compact UV skid range — cut assembly time 30 %" |
| Type | Product development · Process improvement · Standards & knowledge · IT & tools · Training · Facility · Sales & marketing |
| Owner, sponsor | Owner does the work; sponsor (a manager) approves it |
| Department / team | Engineering, Acrylic, Drafting… (the teams we already have) |
| Stage | Idea → Approved → In progress → On hold → Done / Dropped |
| Priority, target date, effort estimate | High · Mar 2027 · ~120 h |
| Outcome links | the products it created (PIM), the documents or knowledge articles it produced |

What it reuses, so it costs little and fits in:
- **Plans and tasks**: a drafting/planning plan can belong to an initiative instead of a project, so the Gantt,
  dependencies, auto-scheduling, workload and My Work all work unchanged.
- **My Work**: own tasks can be tied to an initiative as well as a project; hours count in the workload.
- **Search, person card, notifications** pick it up like any other record.

New screens: an **Initiatives** board (cards by stage, filter by type/department/owner), an initiative page
(goal, stage history, plan, tasks, outcomes), and "Propose an idea" for anyone — the sponsor approves or drops it.

Product development is the main case worth a little extra: when the initiative is approved it can open a draft
product family or product in PIM, and when it finishes the product becomes Released.

**You:** the list of types; who may approve an idea (any manager, or a named group); whether initiatives need
budget/cost tracking or hours only; what to do with `AAT-GEN` (turn its tasks into initiatives, or keep it).

## 2. Knowledge library with pools

### Today
"Engineering Knowledge" holds three structured record types — Materials (18), Specifications (4), Design rules
(6) — and the Document register (8 files) sits beside it. Everything is open to everyone.

### Suggestion: one master library, divided into pools
```
Knowledge Library
├── Engineering        (materials, specifications, design rules, calculations, articles)
├── Life support & biology
├── Acrylic            (bonding, annealing, panel limits, articles)
├── Installation & site (method statements, checklists, lessons learned)
├── Drafting & BIM     (standards, templates)
├── Health & safety
├── Financial          (restricted)
└── People & HR        (restricted)
```
Each pool has:
- an **owner** (keeps it current) and **editors**; **readers**: everyone, or chosen roles/teams (Financial and HR
  restricted);
- **articles**: written pages (how-to, procedure, lesson learned, FAQ) with headings, images and attachments,
  revision history and a "review by" date so stale knowledge is flagged;
- the **structured types** where they exist (Materials, Specifications, Design rules stay as they are, inside
  Engineering) and **files** from the Document register;
- **categories and tags** inside the pool, and links to projects, initiatives, products and clients
  ("lesson learned on 001-132 Bass Pro").

Search covers every pool the person may read. Existing records move into **Engineering** unchanged.

Possible later: article approval (draft → reviewed → published) for procedures; "ask the library" AI answers
quoting articles.

**You:** the list of pools and their owners; which pools are restricted and to whom; whether procedures need
approval before publishing.

## Suggested order
1. Initiatives (internal work) — it changes daily planning and workload the most.
2. Knowledge pools — library structure, then articles, then moving the existing records in.
3. Roadmap step 2 "who sees what" can run in between, now that every person has a manager.
