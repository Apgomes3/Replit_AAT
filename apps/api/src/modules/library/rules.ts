// Pure rules for the Knowledge Library: who may do what in a pool, what an article save does, and
// cleaning article HTML. Database access lives in ./routes.ts.
import sanitizeHtml from 'sanitize-html';

export const ARTICLE_KINDS = ['howto', 'procedure', 'lesson', 'faq', 'reference'] as const;
export type ArticleKind = typeof ARTICLE_KINDS[number];
export const KIND_LABELS: Record<ArticleKind, string> = {
  howto: 'How-to', procedure: 'Procedure', lesson: 'Lesson learned', faq: 'FAQ', reference: 'Reference',
};
export const LINK_TYPES = ['project', 'initiative', 'product', 'client', 'enquiry', 'design_book'] as const;
export type LinkType = typeof LINK_TYPES[number];

/** What one person is to a pool. */
export type PoolStanding = { isAdmin: boolean; isOwner: boolean; isEditor: boolean; isReader: boolean; restricted: boolean };
export type PoolRights = {
  read: boolean;      // see published articles
  write: boolean;     // write and edit articles, see drafts
  approve: boolean;   // publish procedures
  members: boolean;   // choose editors and readers
  settings: boolean;  // name, owner, restricted, archive
};

/**
 * Admins do everything. The owner reads, writes, approves procedures and picks editors and readers.
 * Editors read and write. Readers of a restricted pool read. Open pools are readable by everyone
 * with the library; restricted pools only by the people above.
 */
export function poolRights(s: PoolStanding): PoolRights {
  if (s.isAdmin) return { read: true, write: true, approve: true, members: true, settings: true };
  const write = s.isOwner || s.isEditor;
  return {
    read: write || s.isReader || !s.restricted,
    write,
    approve: s.isOwner,
    members: s.isOwner,
    settings: false,
  };
}

/** Saving an article: whether it publishes now, waits for approval, or stays a draft. */
export function saveOutcome(kind: ArticleKind, publish: boolean, canApprove: boolean): 'draft' | 'publish' | 'review' {
  if (!publish) return 'draft';
  // A procedure goes to the pool owner first, unless the owner (or an admin) is the one publishing it.
  if (kind === 'procedure' && !canApprove) return 'review';
  return 'publish';
}

const IMAGE_DATA = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/;

/** Keeps the formatting the editor makes (headings, lists, tables, links, images) and nothing else. */
export function cleanHtml(html: string): string {
  return sanitizeHtml(html ?? '', {
    allowedTags: ['p', 'h1', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
      'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'colgroup', 'col', 'hr', 'br', 'mark'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      th: ['colspan', 'rowspan', 'colwidth'],
      td: ['colspan', 'rowspan', 'colwidth'],
      col: ['style'],
      ol: ['start'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowedStyles: { col: { 'min-width': [/^\d+px$/], width: [/^\d+px$/] } },
    exclusiveFilter: frame => frame.tag === 'img' && (frame.attribs.src ?? '').startsWith('data:') && !IMAGE_DATA.test(frame.attribs.src ?? ''),
    transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }) },
  });
}

/** Plain text of an article, for search. */
export function htmlToText(html: string): string {
  return sanitizeHtml((html ?? '').replace(/<(\/p|\/h[1-4]|br|\/li|\/tr|\/td|\/th)>/gi, ' $&'), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

export type ArticleInput = {
  title?: string; summary?: string | null; body_html?: string; kind?: ArticleKind; category?: string | null;
  tags?: string[]; review_by?: string | null; owner_user_id?: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const MAX_BODY = 15 * 1024 * 1024; // images are stored inside the article

/** Checks and tidies article fields; `creating` makes the title required. */
export function validateArticle(body: any, creating: boolean): { value: ArticleInput } | { error: string } {
  const v: ArticleInput = {};
  if (body.title !== undefined || creating) {
    const t = typeof body.title === 'string' ? body.title.trim() : '';
    if (!t) return { error: 'Give the article a title' };
    if (t.length > 255) return { error: 'The title is too long (255 characters at most)' };
    v.title = t;
  }
  if (body.summary !== undefined) v.summary = typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim().slice(0, 1000) : null;
  if (body.body_html !== undefined) {
    if (typeof body.body_html !== 'string') return { error: 'The article text is not valid' };
    if (body.body_html.length > MAX_BODY) return { error: 'The article is too large (15 MB at most, including pasted images)' };
    v.body_html = cleanHtml(body.body_html);
  }
  if (body.kind !== undefined) {
    if (!ARTICLE_KINDS.includes(body.kind)) return { error: 'Unknown article type' };
    v.kind = body.kind;
  }
  if (body.category !== undefined) v.category = typeof body.category === 'string' && body.category.trim() ? body.category.trim().slice(0, 120) : null;
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) return { error: 'Tags must be a list' };
    v.tags = [...new Set(body.tags.map((t: unknown) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20) as string[];
  }
  if (body.review_by !== undefined) {
    if (body.review_by === null || body.review_by === '') v.review_by = null;
    else if (typeof body.review_by === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.review_by)) v.review_by = body.review_by;
    else return { error: 'The review date must be a date (YYYY-MM-DD)' };
  }
  if (body.owner_user_id !== undefined) {
    if (body.owner_user_id === null || body.owner_user_id === '') v.owner_user_id = null;
    else if (isUuid(body.owner_user_id)) v.owner_user_id = body.owner_user_id;
    else return { error: 'Choose the article owner from the list' };
  }
  return { value: v };
}
