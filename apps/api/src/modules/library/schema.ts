// Knowledge Library: one master library divided into pools (Engineering, Acrylic, Health & safety…).
// Each pool has an owner, editors and, when restricted, a chosen list of readers (people or teams).
// Articles keep every saved version; readers see the published version, editors the latest.
// Procedures need the pool owner's approval before a new version is published.
// See docs/internal-work-and-knowledge-proposal.md.
export const LIBRARY_SCHEMA = `
CREATE TABLE IF NOT EXISTS knowledge_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(60) UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name VARCHAR(120) NOT NULL CHECK (BTRIM(name) <> ''),
  description TEXT,
  icon VARCHAR(40) NOT NULL DEFAULT 'book',
  restricted BOOLEAN NOT NULL DEFAULT FALSE,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 100,
  archived_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Editors write in the pool; readers matter only for restricted pools. A row names a person or a team.
CREATE TABLE IF NOT EXISTS knowledge_pool_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES knowledge_pools(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL CHECK (role IN ('editor','reader')),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES drafting_teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT knowledge_pool_members_one CHECK ((user_id IS NULL) <> (team_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_pool_members_user ON knowledge_pool_members (pool_id, role, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_pool_members_team ON knowledge_pool_members (pool_id, role, team_id) WHERE team_id IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS knowledge_article_code_seq START 1;

CREATE TABLE IF NOT EXISTS knowledge_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) UNIQUE NOT NULL,
  pool_id UUID NOT NULL REFERENCES knowledge_pools(id),
  kind VARCHAR(20) NOT NULL DEFAULT 'howto' CHECK (kind IN ('howto','procedure','lesson','faq','reference')),
  category VARCHAR(120),
  tags TEXT[] NOT NULL DEFAULT '{}',
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  review_by DATE,
  -- draft: never published; published: readers see published_revision_id; archived: hidden from readers.
  status VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  -- A procedure's newest version waiting for the pool owner (it may differ from the published one).
  in_review BOOLEAN NOT NULL DEFAULT FALSE,
  review_note TEXT,
  latest_revision_id UUID,
  published_revision_id UUID,
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_articles_pool ON knowledge_articles (pool_id, status);

CREATE TABLE IF NOT EXISTS knowledge_article_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  rev_no INT NOT NULL,
  title VARCHAR(255) NOT NULL CHECK (BTRIM(title) <> ''),
  summary TEXT,
  body_html TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (article_id, rev_no)
);
DO $$ BEGIN
  ALTER TABLE knowledge_articles ADD CONSTRAINT knowledge_articles_latest_fk FOREIGN KEY (latest_revision_id) REFERENCES knowledge_article_revisions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE knowledge_articles ADD CONSTRAINT knowledge_articles_published_fk FOREIGN KEY (published_revision_id) REFERENCES knowledge_article_revisions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- What an article is about: a project, initiative, product, client, enquiry or design book.
CREATE TABLE IF NOT EXISTS knowledge_article_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('project','initiative','product','client','enquiry','design_book')),
  entity_id UUID NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (article_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS knowledge_article_links_entity ON knowledge_article_links (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS knowledge_article_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120),
  size_bytes BIGINT NOT NULL DEFAULT 0,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_article_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  action VARCHAR(30) NOT NULL,
  note TEXT,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The eight starting pools. Financial and People & HR are restricted to chosen readers.
INSERT INTO knowledge_pools (slug, name, description, icon, restricted, sort_order) VALUES
  ('engineering', 'Engineering', 'Materials, specifications, design rules, calculations and engineering articles.', 'cog', FALSE, 10),
  ('life-support', 'Life support & biology', 'Water treatment, filtration, animal husbandry and life support know-how.', 'droplets', FALSE, 20),
  ('acrylic', 'Acrylic', 'Bonding, annealing, panel limits and acrylic fabrication.', 'square', FALSE, 30),
  ('installation', 'Installation & site', 'Method statements, checklists and lessons learned on site.', 'hard-hat', FALSE, 40),
  ('drafting', 'Drafting & BIM', 'Drawing standards, templates and BIM practice.', 'pen-tool', FALSE, 50),
  ('health-safety', 'Health & safety', 'Safety procedures, risk assessments and incident lessons.', 'shield', FALSE, 60),
  ('financial', 'Financial', 'Pricing, costing and finance procedures. Restricted.', 'banknote', TRUE, 70),
  ('people-hr', 'People & HR', 'HR policies and people procedures. Restricted.', 'users', TRUE, 80)
ON CONFLICT (slug) DO NOTHING;
`;
// Access to the library as a whole uses the existing 'knowledge' module key; who may read or write
// each pool is decided by the pool (see ./access.ts).
