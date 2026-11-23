// Knowledge Library API (/api/v1/library): pools, articles with versions and approval, links,
// attachments. Anyone with the Knowledge module sees the open pools; who may read a restricted pool
// or write in any pool is decided per pool (./rules.ts poolRights).
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { NextFunction, Response, Router } from 'express';
import { authenticate, AuthRequest, requireModuleAccess } from '../../middleware/auth';
import { query, withTransaction } from '../../db';
import { emitNotification } from '../../db/notifications';
import {
  ARTICLE_KINDS, ArticleKind, htmlToText, isUuid, KIND_LABELS, LINK_TYPES, poolRights, PoolRights, saveOutcome, validateArticle,
} from './rules';

const router = Router();
router.use(authenticate, requireModuleAccess('knowledge'));

const filesDir = path.join(__dirname, '../../../private-uploads/knowledge');
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { fs.mkdirSync(filesDir, { recursive: true }); cb(null, filesDir); },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.originalname).slice(0, 12)}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

class HttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const notFound = () => new HttpError(404, 'NOT_FOUND', 'Not found, or you do not have access to it.');
const forbidden = (m = 'You cannot change this pool.') => new HttpError(403, 'FORBIDDEN', m);
const bad = (m: string) => new HttpError(400, 'VALIDATION', m);
function handle(res: Response, next: NextFunction, e: any) {
  if (e instanceof HttpError) return res.status(e.status).json({ error: { code: e.code, message: e.message } });
  if (e?.code === '23503') return res.status(400).json({ error: { code: 'VALIDATION', message: 'The chosen person or team no longer exists.' } });
  if (e?.code === '23505') return res.status(409).json({ error: { code: 'CONFLICT', message: 'That already exists.' } });
  return next(e);
}
const wrap = (fn: (req: AuthRequest, res: Response) => Promise<unknown>) =>
  (req: AuthRequest, res: Response, next: NextFunction) => fn(req, res).catch(e => handle(res, next, e));

const NAME = (a: string) => `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ${a}.first_name, ${a}.last_name)), ''), ${a}.email)`;
const isAdmin = (req: AuthRequest) => req.user!.role === 'admin';

/** Pool columns plus what the person ($1) is to the pool. */
const POOL_SELECT = `
  SELECT p.id, p.slug, p.name, p.description, p.icon, p.restricted, p.owner_user_id, p.sort_order, p.archived_at,
    ${NAME('o')} AS owner_name,
    (p.owner_user_id = $1::uuid) AS is_owner,
    EXISTS (SELECT 1 FROM knowledge_pool_members m WHERE m.pool_id = p.id AND m.role = 'editor'
      AND (m.user_id = $1::uuid OR m.team_id IN (SELECT team_id FROM drafting_team_members WHERE user_id = $1::uuid))) AS is_editor,
    EXISTS (SELECT 1 FROM knowledge_pool_members m WHERE m.pool_id = p.id AND m.role = 'reader'
      AND (m.user_id = $1::uuid OR m.team_id IN (SELECT team_id FROM drafting_team_members WHERE user_id = $1::uuid))) AS is_reader
  FROM knowledge_pools p LEFT JOIN users o ON o.id = p.owner_user_id`;

type PoolRow = { id: string; slug: string; name: string; restricted: boolean; owner_user_id: string | null; archived_at: string | null;
  is_owner: boolean; is_editor: boolean; is_reader: boolean; [k: string]: any };
type Pool = PoolRow & { rights: PoolRights };

const withRights = (req: AuthRequest, p: PoolRow): Pool => ({
  ...p,
  rights: poolRights({ isAdmin: isAdmin(req), isOwner: p.is_owner, isEditor: p.is_editor, isReader: p.is_reader, restricted: p.restricted }),
});

async function pools(req: AuthRequest, includeArchived = false): Promise<Pool[]> {
  const rows = (await query(`${POOL_SELECT} ${includeArchived ? '' : 'WHERE p.archived_at IS NULL'} ORDER BY p.sort_order, p.name`, [req.user!.id])).rows;
  return rows.map(r => withRights(req, r)).filter(p => p.rights.read);
}

/** A pool by slug or id that the person may read (404 otherwise, so restricted pools stay unseen). */
async function poolFor(req: AuthRequest, key: string): Promise<Pool> {
  const row = (await query(`${POOL_SELECT} WHERE ${isUuid(key) ? 'p.id = $2::uuid' : 'p.slug = $2'}`, [req.user!.id, key])).rows[0];
  const pool = row && withRights(req, row);
  if (!pool?.rights.read) throw notFound();
  return pool;
}

const ARTICLE_COLUMNS = `a.id, a.code, a.pool_id, a.kind, a.category, a.tags, a.status, a.in_review, a.review_note,
  to_char(a.review_by, 'YYYY-MM-DD') AS review_by, a.owner_user_id, ${NAME('ao')} AS owner_name,
  a.latest_revision_id, a.published_revision_id, a.published_at, a.created_at, a.updated_at,
  (a.latest_revision_id IS DISTINCT FROM a.published_revision_id AND a.published_revision_id IS NOT NULL) AS has_unpublished_changes`;

/** An article the person may see, with its pool (404 when not). */
async function articleFor(req: AuthRequest, id: string) {
  if (!isUuid(id)) throw notFound();
  const a = (await query(`SELECT ${ARTICLE_COLUMNS} FROM knowledge_articles a LEFT JOIN users ao ON ao.id = a.owner_user_id WHERE a.id = $1`, [id])).rows[0];
  if (!a) throw notFound();
  const pool = await poolFor(req, a.pool_id);
  if (!pool.rights.write && a.status !== 'published') throw notFound();
  return { a, pool };
}

async function event(db: any, articleId: string, action: string, actor: string, note: string | null = null) {
  await db.query(`INSERT INTO knowledge_article_events (article_id, action, note, actor_id) VALUES ($1, $2, $3, $4)`, [articleId, action, note, actor]);
}

// ---------- pools ----------

router.get('/pools', wrap(async (req, res) => {
  const list = await pools(req, req.query.archived === '1' && isAdmin(req));
  if (!list.length) return res.json({ data: [] });
  const ids = list.map(p => p.id);
  const writable = list.filter(p => p.rights.write).map(p => p.id);
  const counts = (await query(
    `SELECT pool_id, COUNT(*) FILTER (WHERE status = 'published')::int AS published,
       COUNT(*) FILTER (WHERE status = 'draft' AND pool_id = ANY($2::uuid[]))::int AS drafts,
       COUNT(*) FILTER (WHERE in_review AND pool_id = ANY($2::uuid[]))::int AS in_review,
       COUNT(*) FILTER (WHERE status = 'published' AND review_by < CURRENT_DATE AND pool_id = ANY($2::uuid[]))::int AS overdue_review,
       MAX(updated_at) FILTER (WHERE status = 'published') AS last_update
     FROM knowledge_articles WHERE pool_id = ANY($1::uuid[]) GROUP BY pool_id`, [ids, writable],
  )).rows;
  const structured = list.some(p => p.slug === 'engineering') ? (await query(
    `SELECT (SELECT COUNT(*) FROM materials)::int AS materials, (SELECT COUNT(*) FROM specifications)::int AS specifications,
       (SELECT COUNT(*) FROM design_rules)::int AS design_rules, (SELECT COUNT(*) FROM calculation_templates)::int AS calculation_templates`,
  )).rows[0] : null;
  res.json({ data: list.map(p => ({
    ...p,
    counts: counts.find(c => c.pool_id === p.id) ?? { published: 0, drafts: 0, in_review: 0, overdue_review: 0, last_update: null },
    structured: p.slug === 'engineering' ? structured : null,
  })) });
}));

router.get('/pools/:key', wrap(async (req, res) => {
  const pool = await poolFor(req, String(req.params.key));
  // Editors are shown to everyone who can read the pool; the reader list only to whoever manages it.
  const members = (await query(
    `SELECT m.id, m.role, m.user_id, m.team_id, ${NAME('u')} AS user_name, u.job_title, t.name AS team_name
     FROM knowledge_pool_members m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN drafting_teams t ON t.id = m.team_id
     WHERE m.pool_id = $1 ${pool.rights.members ? '' : "AND m.role = 'editor'"} ORDER BY m.role, t.name NULLS LAST, user_name`, [pool.id],
  )).rows;
  const categories = (await query(
    `SELECT category, COUNT(*)::int AS count FROM knowledge_articles
     WHERE pool_id = $1 AND category IS NOT NULL AND (status = 'published' OR $2::boolean) GROUP BY category ORDER BY category`,
    [pool.id, pool.rights.write],
  )).rows;
  res.json({ ...pool, members, categories });
}));

router.post('/pools', wrap(async (req, res) => {
  if (!isAdmin(req)) throw forbidden('Only admins add pools.');
  const name = String(req.body?.name ?? '').trim();
  if (!name) throw bad('Give the pool a name');
  const slug = (String(req.body?.slug ?? '').trim() || name).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  if (!slug) throw bad('The pool needs a short name made of letters or numbers');
  const row = (await query(
    `INSERT INTO knowledge_pools (slug, name, description, restricted, owner_user_id, sort_order, created_by)
     VALUES ($1, $2, $3, $4, $5, COALESCE((SELECT MAX(sort_order) + 10 FROM knowledge_pools), 10), $6) RETURNING id`,
    [slug, name, req.body?.description || null, !!req.body?.restricted, isUuid(req.body?.owner_user_id) ? req.body.owner_user_id : null, req.user!.id],
  )).rows[0];
  res.status(201).json(await poolFor(req, row.id));
}));

router.patch('/pools/:key', wrap(async (req, res) => {
  const pool = await poolFor(req, String(req.params.key));
  const b = req.body ?? {};
  const set: string[] = []; const vals: unknown[] = [pool.id];
  const put = (col: string, v: unknown) => { vals.push(v); set.push(`${col} = $${vals.length}`); };
  if (b.description !== undefined) {
    if (!pool.rights.members) throw forbidden();
    put('description', typeof b.description === 'string' && b.description.trim() ? b.description.trim() : null);
  }
  for (const k of ['name', 'restricted', 'owner_user_id', 'archived', 'sort_order']) {
    if (b[k] === undefined) continue;
    if (!pool.rights.settings) throw forbidden('Only admins change a pool\'s name, owner or restriction.');
    if (k === 'name') { if (!String(b.name).trim()) throw bad('Give the pool a name'); put('name', String(b.name).trim()); }
    if (k === 'restricted') put('restricted', !!b.restricted);
    if (k === 'owner_user_id') { if (b.owner_user_id && !isUuid(b.owner_user_id)) throw bad('Choose the owner from the list'); put('owner_user_id', b.owner_user_id || null); }
    if (k === 'archived') set.push(b.archived ? 'archived_at = COALESCE(archived_at, NOW())' : 'archived_at = NULL');
    if (k === 'sort_order') put('sort_order', Number(b.sort_order) || 100);
  }
  if (!set.length) throw bad('Nothing to change');
  await query(`UPDATE knowledge_pools SET ${set.join(', ')}, updated_at = NOW() WHERE id = $1`, vals);
  res.json(await poolFor(req, pool.id));
}));

/** Replaces the pool's editors and readers: { editors: [{user_id}|{team_id}], readers: [...] }. */
router.put('/pools/:key/members', wrap(async (req, res) => {
  const pool = await poolFor(req, String(req.params.key));
  if (!pool.rights.members) throw forbidden('Only the pool owner or an admin chooses editors and readers.');
  const rows: Array<[role: string, user: string | null, team: string | null]> = [];
  for (const role of ['editor', 'reader'] as const) {
    const list = req.body?.[`${role}s`];
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw bad(`${role}s must be a list`);
    for (const m of list) {
      if (isUuid(m?.user_id)) rows.push([role, m.user_id, null]);
      else if (isUuid(m?.team_id)) rows.push([role, null, m.team_id]);
      else throw bad('Each member is a person or a team from the list');
    }
  }
  await withTransaction(async db => {
    for (const role of ['editor', 'reader']) {
      if (req.body?.[`${role}s`] === undefined) continue;
      await db.query(`DELETE FROM knowledge_pool_members WHERE pool_id = $1 AND role = $2`, [pool.id, role]);
    }
    for (const [role, user, team] of rows) {
      await db.query(`INSERT INTO knowledge_pool_members (pool_id, role, user_id, team_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [pool.id, role, user, team]);
    }
  });
  res.json({ ok: true });
}));

// ---------- articles ----------

/**
 * Articles the person may see. In pools they write in they see drafts and the newest version;
 * elsewhere only published articles, as published. Filters: pool, kind, category, tag, q, status,
 * due (review date within 30 days), mine.
 */
router.get('/articles', wrap(async (req, res) => {
  const readable = await pools(req);
  const poolFilter = req.query.pool ? readable.find(p => p.slug === req.query.pool || p.id === req.query.pool) : null;
  if (req.query.pool && !poolFilter) throw notFound();
  const scope = poolFilter ? [poolFilter] : readable;
  if (!scope.length) return res.json({ data: [] });
  const vals: unknown[] = [scope.map(p => p.id), scope.filter(p => p.rights.write).map(p => p.id)];
  const where = [`a.pool_id = ANY($1::uuid[])`, `(a.pool_id = ANY($2::uuid[]) OR a.status = 'published')`];
  const add = (sql: (n: number) => string, v: unknown) => { vals.push(v); where.push(sql(vals.length)); };
  if (req.query.kind) add(n => `a.kind = $${n}`, String(req.query.kind));
  if (req.query.category) add(n => `a.category = $${n}`, String(req.query.category));
  if (req.query.tag) add(n => `$${n} = ANY(a.tags)`, String(req.query.tag).toLowerCase());
  const status = String(req.query.status ?? '');
  if (status === 'in_review') where.push('a.in_review');
  else if (['draft', 'published', 'archived'].includes(status)) add(n => `a.status = $${n}`, status);
  else where.push(`a.status <> 'archived'`);
  if (req.query.due === '1') where.push(`a.status = 'published' AND a.review_by <= CURRENT_DATE + 30`);
  if (req.query.mine === '1') add(n => `(a.owner_user_id = $${n}::uuid OR a.created_by = $${n}::uuid)`, req.user!.id);
  const words = String(req.query.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
  for (const w of words) add(n => `(r.title ILIKE $${n} OR r.summary ILIKE $${n} OR r.body_text ILIKE $${n} OR a.code ILIKE $${n} OR a.category ILIKE $${n} OR array_to_string(a.tags, ' ') ILIKE $${n})`, `%${w}%`);
  const rows = (await query(
    `SELECT ${ARTICLE_COLUMNS}, r.title, r.summary, p.slug AS pool_slug, p.name AS pool_name, p.restricted AS pool_restricted,
       LEFT(r.body_text, 240) AS excerpt
     FROM knowledge_articles a
     JOIN knowledge_pools p ON p.id = a.pool_id
     JOIN knowledge_article_revisions r ON r.id = CASE WHEN a.pool_id = ANY($2::uuid[]) THEN a.latest_revision_id ELSE a.published_revision_id END
     LEFT JOIN users ao ON ao.id = a.owner_user_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.updated_at DESC LIMIT 300`, vals,
  )).rows;
  res.json({ data: rows });
}));

const REVISION = (alias: string) => `${alias}.id, ${alias}.rev_no, ${alias}.title, ${alias}.summary, ${alias}.body_html, ${alias}.note, ${alias}.created_at, ${NAME('ru')} AS created_by_name`;

router.get('/articles/:id', wrap(async (req, res) => {
  const { a, pool } = await articleFor(req, String(req.params.id));
  const revId = pool.rights.write ? a.latest_revision_id : a.published_revision_id;
  const shown = (await query(`SELECT ${REVISION('r')} FROM knowledge_article_revisions r LEFT JOIN users ru ON ru.id = r.created_by WHERE r.id = $1`, [revId])).rows[0];
  const [links, files, revisions, events] = await Promise.all([
    linksOf(a.id),
    query(`SELECT f.id, f.file_name, f.mime_type, f.size_bytes, f.created_at, ${NAME('u')} AS uploaded_by_name
      FROM knowledge_article_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.article_id = $1 ORDER BY f.created_at`, [a.id]),
    pool.rights.write ? query(`SELECT r.id, r.rev_no, r.title, r.note, r.created_at, ${NAME('ru')} AS created_by_name
      FROM knowledge_article_revisions r LEFT JOIN users ru ON ru.id = r.created_by WHERE r.article_id = $1 ORDER BY r.rev_no DESC`, [a.id]) : { rows: [] },
    pool.rights.write ? query(`SELECT e.action, e.note, e.created_at, ${NAME('u')} AS actor_name
      FROM knowledge_article_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.article_id = $1 ORDER BY e.created_at DESC LIMIT 50`, [a.id]) : { rows: [] },
  ]);
  res.json({
    ...a, kind_label: KIND_LABELS[a.kind as ArticleKind],
    pool: { id: pool.id, slug: pool.slug, name: pool.name, restricted: pool.restricted, owner_name: pool.owner_name },
    rights: { write: pool.rights.write, approve: pool.rights.approve },
    revision: shown, links, files: files.rows, revisions: revisions.rows, events: events.rows,
  });
}));

router.get('/articles/:id/revisions/:revId', wrap(async (req, res) => {
  const { a, pool } = await articleFor(req, String(req.params.id));
  if (!pool.rights.write || !isUuid(req.params.revId)) throw notFound();
  const r = (await query(`SELECT ${REVISION('r')} FROM knowledge_article_revisions r LEFT JOIN users ru ON ru.id = r.created_by
    WHERE r.id = $1 AND r.article_id = $2`, [req.params.revId, a.id])).rows[0];
  if (!r) throw notFound();
  res.json(r);
}));

async function notifyOwner(db: any, pool: Pool, articleId: string, title: string, actor: string, revNo: number) {
  const recipients = pool.owner_user_id && pool.owner_user_id !== actor ? [pool.owner_user_id] : [];
  if (!recipients.length) return;
  await emitNotification(db, {
    eventKey: `knowledge-review:${articleId}:${revNo}`, type: 'knowledge_review', title: `Procedure to approve: ${title}`,
    body: `${pool.name} pool`, entityType: 'knowledge_article', entityId: articleId, actorId: actor, recipientIds: recipients,
    actionRequired: false, href: `/knowledge/articles/${articleId}`,
  });
}

/** Applies a save's outcome (publish now, send for approval, or keep as draft) inside the transaction. */
async function applyOutcome(db: any, req: AuthRequest, pool: Pool, articleId: string, kind: ArticleKind, publish: boolean, title: string, revNo: number) {
  const outcome = saveOutcome(kind, publish, pool.rights.approve);
  if (outcome === 'publish') {
    await db.query(`UPDATE knowledge_articles SET status = 'published', published_revision_id = latest_revision_id, published_at = NOW(),
      published_by = $2, in_review = FALSE, review_note = NULL WHERE id = $1`, [articleId, req.user!.id]);
    await event(db, articleId, 'published', req.user!.id);
  } else if (outcome === 'review') {
    await db.query(`UPDATE knowledge_articles SET in_review = TRUE, review_note = NULL WHERE id = $1`, [articleId]);
    await event(db, articleId, 'submitted', req.user!.id);
    await notifyOwner(db, pool, articleId, title, req.user!.id, revNo);
  }
  return outcome;
}

router.post('/articles', wrap(async (req, res) => {
  const pool = await poolFor(req, String(req.body?.pool ?? ''));
  if (!pool.rights.write) throw forbidden('Only the pool\'s owner and editors write articles here.');
  const v = validateArticle(req.body ?? {}, true);
  if ('error' in v) throw bad(v.error);
  const f = v.value; const kind = f.kind ?? 'howto';
  const result = await withTransaction(async db => {
    const a = (await db.query(
      `INSERT INTO knowledge_articles (code, pool_id, kind, category, tags, owner_user_id, review_by, created_by, updated_by)
       VALUES ('KA-' || LPAD(nextval('knowledge_article_code_seq')::text, 4, '0'), $1, $2, $3, $4, $5, $6, $7, $7) RETURNING id, code`,
      [pool.id, kind, f.category ?? null, f.tags ?? [], f.owner_user_id ?? req.user!.id, f.review_by ?? null, req.user!.id],
    )).rows[0];
    const html = f.body_html ?? '';
    const r = (await db.query(
      `INSERT INTO knowledge_article_revisions (article_id, rev_no, title, summary, body_html, body_text, note, created_by)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [a.id, f.title, f.summary ?? null, html, htmlToText(html), req.body?.note || null, req.user!.id],
    )).rows[0];
    await db.query(`UPDATE knowledge_articles SET latest_revision_id = $2 WHERE id = $1`, [a.id, r.id]);
    await event(db, a.id, 'created', req.user!.id);
    const outcome = await applyOutcome(db, req, pool, a.id, kind, !!req.body?.publish, f.title!, 1);
    return { id: a.id, code: a.code, outcome };
  });
  res.status(201).json(result);
}));

/** Saves changes: content changes make a new version; `publish` publishes it (or sends a procedure for approval). */
router.put('/articles/:id', wrap(async (req, res) => {
  const { a, pool } = await articleFor(req, String(req.params.id));
  if (!pool.rights.write) throw forbidden('Only the pool\'s owner and editors change articles here.');
  const v = validateArticle(req.body ?? {}, false);
  if ('error' in v) throw bad(v.error);
  const f = v.value;
  let target = pool;
  if (req.body?.pool && req.body.pool !== pool.slug && req.body.pool !== pool.id) {
    target = await poolFor(req, String(req.body.pool));
    if (!target.rights.write) throw forbidden('You cannot write in that pool.');
  }
  const result = await withTransaction(async db => {
    const latest = (await db.query(`SELECT rev_no, title, summary, body_html FROM knowledge_article_revisions WHERE id = $1`, [a.latest_revision_id])).rows[0];
    const next = { title: f.title ?? latest.title, summary: f.summary !== undefined ? f.summary : latest.summary, body_html: f.body_html ?? latest.body_html };
    let revNo = latest.rev_no;
    if (next.title !== latest.title || (next.summary ?? null) !== (latest.summary ?? null) || next.body_html !== latest.body_html) {
      revNo += 1;
      const r = (await db.query(
        `INSERT INTO knowledge_article_revisions (article_id, rev_no, title, summary, body_html, body_text, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [a.id, revNo, next.title, next.summary ?? null, next.body_html, htmlToText(next.body_html), req.body?.note || null, req.user!.id],
      )).rows[0];
      await db.query(`UPDATE knowledge_articles SET latest_revision_id = $2 WHERE id = $1`, [a.id, r.id]);
      await event(db, a.id, 'edited', req.user!.id, req.body?.note || null);
    }
    const set: string[] = []; const vals: unknown[] = [a.id];
    const put = (col: string, val: unknown) => { vals.push(val); set.push(`${col} = $${vals.length}`); };
    if (f.kind !== undefined) put('kind', f.kind);
    if (f.category !== undefined) put('category', f.category);
    if (f.tags !== undefined) put('tags', f.tags);
    if (f.review_by !== undefined) put('review_by', f.review_by);
    if (f.owner_user_id !== undefined) put('owner_user_id', f.owner_user_id);
    if (target.id !== pool.id) { put('pool_id', target.id); await event(db, a.id, 'moved', req.user!.id, `${pool.name} → ${target.name}`); }
    put('updated_by', req.user!.id);
    await db.query(`UPDATE knowledge_articles SET ${set.join(', ')}, updated_at = NOW() WHERE id = $1`, vals);
    const outcome = req.body?.publish ? await applyOutcome(db, req, target, a.id, f.kind ?? a.kind, true, next.title, revNo) : 'saved';
    return { id: a.id, outcome };
  });
  res.json(result);
}));

router.post('/articles/:id/approve', wrap(async (req, res) => {
  const { a, pool } = await articleFor(req, String(req.params.id));
  if (!pool.rights.approve) throw forbidden('Only the pool owner or an admin approves procedures.');
  if (!a.in_review) throw bad('This article is not waiting for approval.');
  await withTransaction(async db => {
    await db.query(`UPDATE knowledge_articles SET status = 'published', published_revision_id = latest_revision_id, published_at = NOW(),
      published_by = $2, in_review = FALSE, review_note = NULL, updated_at = NOW() WHERE id = $1`, [a.id, req.user!.id]);
    await event(db, a.id, 'approved', req.user!.id, req.body?.note || null);
  });
  res.json({ ok: true });
}));

router.post('/articles/:id/send-back', wrap(async (req, res) => {
  const { a, pool } = await articleFor(req, String(req.params.id));
  if (!pool.rights.approve) throw forbidden('Only the pool owner or an admin reviews procedures.');
  const note = String(req.body?.note ?? '').trim();
  if (!note) throw bad('Say what needs changing');
  if (!a.in_review) throw bad('This article is not waiting for approval.');
  await withTransaction(async db => {
    await db.query(`UPDATE knowledge_articles SET in_review = FALSE, review_note = $2, updated_at = NOW() WHERE id = $1`, [a.id, note]);
    await event(db, a.id, 'sent_back', req.user!.id, note);
  });
  res.json({ ok: true });
}));

router.post('/articles/:id/archive', wrap(async (req, res) => {
  const { a, pool } = await articleFor(req, String(req.params.id));
  if (!pool.rights.write) throw forbidden();
  await withTransaction(async db => {
    await db.query(`UPDATE knowledge_articles SET status = 'archived', in_review = FALSE, updated_at = NOW() WHERE id = $1`, [a.id]);
    await event(db, a.id, 'archived', req.user!.id);
  });
  res.json({ ok: true });
}));

router.post('/articles/:id/restore', wrap(async (req, res) => {
  const { a, pool } = await articleFor(req, String(req.params.id));
  if (!pool.rights.write) throw forbidden();
  await withTransaction(async db => {
    await db.query(`UPDATE knowledge_articles SET status = CASE WHEN published_revision_id IS NULL THEN 'draft' ELSE 'published' END, updated_at = NOW() WHERE id = $1`, [a.id]);
    await event(db, a.id, 'restored', req.user!.id);
  });
  res.json({ ok: true });
}));

/** A draft that was never published can be deleted by its pool's writers. */
router.delete('/articles/:id', wrap(async (req, res) => {
  const { a, pool } = await articleFor(req, String(req.params.id));
  if (!pool.rights.write) throw forbidden();
  if (a.published_revision_id) throw bad('A published article is archived, not deleted.');
  const files = (await query(`SELECT stored_name FROM knowledge_article_files WHERE article_id = $1`, [a.id])).rows;
  await query(`DELETE FROM knowledge_articles WHERE id = $1`, [a.id]);
  for (const f of files) fs.rm(path.join(filesDir, path.basename(f.stored_name)), { force: true }, () => undefined);
  res.json({ ok: true });
}));

// ---------- links ----------

const LINK_LABEL = `COALESCE(
  CASE l.entity_type WHEN 'project' THEN (SELECT CONCAT_WS(' · ', project_code, project_name) FROM projects WHERE id = l.entity_id) END,
  CASE l.entity_type WHEN 'initiative' THEN (SELECT CONCAT_WS(' · ', code, title) FROM initiatives WHERE id = l.entity_id) END,
  CASE l.entity_type WHEN 'product' THEN (SELECT CONCAT_WS(' · ', product_code, product_name) FROM product_masters WHERE id = l.entity_id) END,
  CASE l.entity_type WHEN 'client' THEN (SELECT name FROM clients WHERE id = l.entity_id) END,
  CASE l.entity_type WHEN 'enquiry' THEN (SELECT CONCAT_WS(' · ', enquiry_number, title) FROM enquiries WHERE id = l.entity_id) END,
  CASE l.entity_type WHEN 'design_book' THEN (SELECT CONCAT_WS(' · ', book_code, book_title) FROM design_books WHERE id = l.entity_id) END,
  '(removed)')`;

async function linksOf(articleId: string) {
  return (await query(`SELECT l.entity_type, l.entity_id, ${LINK_LABEL} AS label FROM knowledge_article_links l
    WHERE l.article_id = $1 ORDER BY l.entity_type, label`, [articleId])).rows;
}

router.put('/articles/:id/links', wrap(async (req, res) => {
  const { a, pool } = await articleFor(req, String(req.params.id));
  if (!pool.rights.write) throw forbidden();
  const list = req.body?.links;
  if (!Array.isArray(list) || list.some((l: any) => !LINK_TYPES.includes(l?.entity_type) || !isUuid(l?.entity_id))) throw bad('Each link needs a type and a record');
  await withTransaction(async db => {
    await db.query(`DELETE FROM knowledge_article_links WHERE article_id = $1`, [a.id]);
    for (const l of list) {
      await db.query(`INSERT INTO knowledge_article_links (article_id, entity_type, entity_id, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [a.id, l.entity_type, l.entity_id, req.user!.id]);
    }
  });
  res.json({ links: await linksOf(a.id) });
}));

/** Published articles about a record (for its page), limited to pools the person may read. */
router.get('/linked', wrap(async (req, res) => {
  const type = String(req.query.entity_type ?? ''), id = String(req.query.entity_id ?? '');
  if (!LINK_TYPES.includes(type as any) || !isUuid(id)) throw bad('entity_type and entity_id are required');
  const readable = (await pools(req)).map(p => p.id);
  const rows = (await query(
    `SELECT a.id, a.code, a.kind, r.title, r.summary, p.name AS pool_name, p.slug AS pool_slug, a.updated_at
     FROM knowledge_article_links l JOIN knowledge_articles a ON a.id = l.article_id
     JOIN knowledge_pools p ON p.id = a.pool_id JOIN knowledge_article_revisions r ON r.id = a.published_revision_id
     WHERE l.entity_type = $1 AND l.entity_id = $2 AND a.status = 'published' AND a.pool_id = ANY($3::uuid[])
     ORDER BY a.updated_at DESC`, [type, id, readable],
  )).rows;
  res.json({ data: rows });
}));

// ---------- attachments ----------

router.post('/articles/:id/files', upload.single('file'), wrap(async (req, res) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  try {
    const { a, pool } = await articleFor(req, String(req.params.id));
    if (!pool.rights.write) throw forbidden();
    if (!file) throw bad('Choose a file');
    const row = (await query(
      `INSERT INTO knowledge_article_files (article_id, file_name, stored_name, mime_type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, file_name, mime_type, size_bytes, created_at`,
      [a.id, file.originalname.slice(0, 255), file.filename, file.mimetype, file.size, req.user!.id],
    )).rows[0];
    await query(`INSERT INTO knowledge_article_events (article_id, action, note, actor_id) VALUES ($1, 'file_added', $2, $3)`, [a.id, row.file_name, req.user!.id]);
    res.status(201).json(row);
  } catch (e) {
    if (file) fs.rm(file.path, { force: true }, () => undefined);
    throw e;
  }
}));

async function fileFor(req: AuthRequest, fileId: string) {
  if (!isUuid(fileId)) throw notFound();
  const f = (await query(`SELECT * FROM knowledge_article_files WHERE id = $1`, [fileId])).rows[0];
  if (!f) throw notFound();
  const { pool } = await articleFor(req, f.article_id);
  return { f, pool };
}

router.get('/files/:fileId', wrap(async (req, res) => {
  const { f } = await fileFor(req, String(req.params.fileId));
  const full = path.join(filesDir, path.basename(f.stored_name));
  if (!fs.existsSync(full)) throw notFound();
  res.download(full, f.file_name);
}));

router.delete('/files/:fileId', wrap(async (req, res) => {
  const { f, pool } = await fileFor(req, String(req.params.fileId));
  if (!pool.rights.write) throw forbidden();
  await query(`DELETE FROM knowledge_article_files WHERE id = $1`, [f.id]);
  fs.rm(path.join(filesDir, path.basename(f.stored_name)), { force: true }, () => undefined);
  res.json({ ok: true });
}));

// ---------- library home ----------

/** Procedures waiting for me, articles due for review in pools I write in, and the latest published articles. */
router.get('/overview', wrap(async (req, res) => {
  const list = await pools(req);
  const approve = list.filter(p => p.rights.approve).map(p => p.id);
  const write = list.filter(p => p.rights.write).map(p => p.id);
  const read = list.map(p => p.id);
  const pick = `a.id, a.code, a.kind, a.status, a.in_review, to_char(a.review_by, 'YYYY-MM-DD') AS review_by, a.updated_at,
    p.name AS pool_name, p.slug AS pool_slug`;
  const [awaiting, due, recent] = await Promise.all([
    query(`SELECT ${pick}, r.title, ${NAME('u')} AS submitted_by FROM knowledge_articles a JOIN knowledge_pools p ON p.id = a.pool_id
      JOIN knowledge_article_revisions r ON r.id = a.latest_revision_id LEFT JOIN users u ON u.id = r.created_by
      WHERE a.in_review AND a.pool_id = ANY($1::uuid[]) ORDER BY a.updated_at`, [approve]),
    query(`SELECT ${pick}, r.title FROM knowledge_articles a JOIN knowledge_pools p ON p.id = a.pool_id
      JOIN knowledge_article_revisions r ON r.id = a.published_revision_id
      WHERE a.status = 'published' AND a.review_by <= CURRENT_DATE + 30 AND a.pool_id = ANY($1::uuid[]) ORDER BY a.review_by LIMIT 20`, [write]),
    query(`SELECT ${pick}, r.title, r.summary FROM knowledge_articles a JOIN knowledge_pools p ON p.id = a.pool_id
      JOIN knowledge_article_revisions r ON r.id = a.published_revision_id
      WHERE a.status = 'published' AND a.pool_id = ANY($1::uuid[]) ORDER BY a.published_at DESC NULLS LAST LIMIT 8`, [read]),
  ]);
  res.json({ awaiting_approval: awaiting.rows, due_for_review: due.rows, recent: recent.rows, kinds: ARTICLE_KINDS.map(k => ({ value: k, label: KIND_LABELS[k] })) });
}));

export default router;
