export type RecentRecord = { path: string; name: string; kind: string; visitedAt: number };

const KEY = 'recent-records';
const MAX = 8;

const KIND_BY_PREFIX: Array<[string, string]> = [
  ['/projects/', 'Project'],
  ['/systems/', 'System'],
  ['/products/components/', 'Component'],
  ['/products/', 'Product'],
  ['/purchase-orders/', 'Purchase order'],
  ['/documents/', 'Document'],
  ['/clients/', 'Client'],
  ['/design-books/', 'Design book'],
  ['/enquiries/', 'Enquiry'],
  ['/initiatives/', 'Initiative'],
  ['/drafting/plans/', 'Drafting plan'],
];

export function loadRecentRecords(): RecentRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Remember a visited record so Home can offer "continue where you left off". Best effort only. */
export function rememberRecord(path: string, name: string) {
  const kind = KIND_BY_PREFIX.find(([prefix]) => path.startsWith(prefix))?.[1] ?? 'Record';
  const next = [{ path, name, kind, visitedAt: Date.now() }, ...loadRecentRecords().filter(r => r.path !== path)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: Home simply shows no recent records.
  }
}
