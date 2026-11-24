// Left-menu menus: definitions, who sees each one, and the menu list a person gets at sign-in.
// See ./schema.ts for the rule model. Menus only decide what shows; module access (from the
// person's role) still hides pages inside a menu, so a menu never grants access to data.
import { query, withTransaction } from '../../db';
import { MODULE_ACCESS_KEYS } from '../../lib/moduleAccess';

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** The code-defined areas (pages in apps/web LeftNav), in their starting order. */
export const SYSTEM_MENUS = [
  { key: 'business-development', label: 'Business Development' },
  { key: 'procurement', label: 'Procurement' },
  { key: 'engineering', label: 'Engineering' },
  { key: 'management', label: 'Management' },
  { key: 'logistics', label: 'Logistics' },
  { key: 'factory', label: 'Factory' },
] as const;

/** Icon names the web app can draw for custom menus and links. */
export const MENU_ICONS = ['link', 'folder', 'file', 'book', 'chart', 'users', 'box', 'wrench', 'calendar', 'globe', 'clipboard', 'truck', 'factory', 'lightbulb'] as const;

export type Visibility = 'everyone' | 'departments' | 'people';
export type Outside = 'hide' | 'fold';
export type MenuItem = { id?: string; label: string; path: string; icon: string | null; module_key: string | null };
export type MenuOverride = { user_id: string; mode: 'show' | 'hide'; name?: string };
export type Menu = {
  id: string; key: string; label: string; icon: string | null; sort_order: number; is_system: boolean; is_active: boolean;
  visibility: Visibility; department_keys: string[]; user_ids: string[]; include_unassigned: boolean; outside: Outside;
  items: MenuItem[]; overrides: MenuOverride[];
};
/** One menu as a person gets it: open or folded by default; `member` = in the rule by department, name or exception. */
export type ResolvedMenu = {
  key: string; label: string; icon: string | null; is_system: boolean; state: 'open' | 'folded'; member: boolean;
  items: Array<Omit<MenuItem, 'id'>>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MenuError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * Adds the system menus that are missing. A newly added one takes its rule from the departments'
 * old nav_areas: departments that opened it (or opened every area) and people without a
 * department see it open; everyone else sees it folded. Returns the keys added.
 */
export async function seedMenus(db: Db = { query }): Promise<string[]> {
  const added: string[] = [];
  for (const [i, m] of SYSTEM_MENUS.entries()) {
    const keys = (await db.query(
      `SELECT key FROM departments WHERE nav_areas IS NULL OR $1 = ANY(nav_areas) ORDER BY key`, [m.key],
    )).rows.map(r => r.key);
    const row = (await db.query(
      `INSERT INTO nav_menus (key, label, sort_order, is_system, visibility, department_keys, include_unassigned, outside)
       VALUES ($1, $2, $3, TRUE, 'departments', $4, TRUE, 'fold') ON CONFLICT (key) DO NOTHING RETURNING key`,
      [m.key, m.label, (i + 1) * 10, keys],
    )).rows[0];
    if (row) added.push(row.key);
  }
  return added;
}

const str = (v: unknown) => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';

function validPath(p: string): boolean {
  if (p.length > 500 || /\s/.test(p)) return false;
  return (p.startsWith('/') && !p.startsWith('//')) || /^https?:\/\/[^/]/i.test(p);
}

export type MenuInput = Omit<Menu, 'id' | 'key' | 'is_system' | 'sort_order' | 'overrides'> & { overrides: MenuOverride[] };

/** Checks a menu from Admin -> Menus. System menus keep their code-defined pages (items are ignored). */
export function validateMenuInput(body: any, isSystem = false): { value?: MenuInput; error?: string } {
  if (!body || typeof body !== 'object') return { error: 'Body must be a JSON object.' };
  const label = str(body.label);
  if (!label || label.length > 80) return { error: 'label is required (at most 80 characters).' };
  const icon = body.icon == null || body.icon === '' ? null : body.icon;
  if (icon !== null && !(MENU_ICONS as readonly unknown[]).includes(icon)) return { error: `icon must be one of: ${MENU_ICONS.join(', ')}.` };
  const visibility = body.visibility ?? 'everyone';
  if (!['everyone', 'departments', 'people'].includes(visibility)) return { error: 'visibility must be everyone, departments or people.' };
  const outside = body.outside ?? 'hide';
  if (!['hide', 'fold'].includes(outside)) return { error: 'outside must be hide or fold.' };
  const department_keys = body.department_keys ?? [];
  if (!Array.isArray(department_keys) || department_keys.some((k: unknown) => typeof k !== 'string' || !k)) return { error: 'department_keys must be a list of department keys.' };
  const user_ids = body.user_ids ?? [];
  if (!Array.isArray(user_ids) || user_ids.some((u: unknown) => typeof u !== 'string' || !UUID.test(u))) return { error: 'user_ids must be a list of person ids.' };
  if (visibility === 'departments' && !department_keys.length && !body.include_unassigned) return { error: 'Pick at least one department.' };
  if (visibility === 'people' && !user_ids.length) return { error: 'Pick at least one person.' };
  if (body.is_active != null && typeof body.is_active !== 'boolean') return { error: 'is_active must be true or false.' };

  const items: MenuItem[] = [];
  if (!isSystem) {
    if (body.items != null && !Array.isArray(body.items)) return { error: 'items must be a list.' };
    for (const [i, it] of (body.items ?? []).entries()) {
      const itemLabel = str(it?.label);
      const path = typeof it?.path === 'string' ? it.path.trim() : '';
      if (!itemLabel || itemLabel.length > 80) return { error: `Link ${i + 1}: label is required (at most 80 characters).` };
      if (!validPath(path)) return { error: `Link ${i + 1}: path must be a Shark OS path starting with / or a full http(s) address.` };
      const itemIcon = it.icon == null || it.icon === '' ? null : it.icon;
      if (itemIcon !== null && !(MENU_ICONS as readonly unknown[]).includes(itemIcon)) return { error: `Link ${i + 1}: unknown icon.` };
      const module_key = it.module_key == null || it.module_key === '' ? null : it.module_key;
      if (module_key !== null && !(MODULE_ACCESS_KEYS as readonly unknown[]).includes(module_key)) return { error: `Link ${i + 1}: unknown module.` };
      items.push({ label: itemLabel, path, icon: itemIcon, module_key });
    }
  }

  const overrides: MenuOverride[] = [];
  if (body.overrides != null && !Array.isArray(body.overrides)) return { error: 'overrides must be a list.' };
  for (const o of body.overrides ?? []) {
    if (typeof o?.user_id !== 'string' || !UUID.test(o.user_id) || !['show', 'hide'].includes(o.mode)) return { error: 'Each exception needs a person and show or hide.' };
    if (overrides.some(x => x.user_id === o.user_id)) return { error: 'A person can have only one exception per menu.' };
    overrides.push({ user_id: o.user_id, mode: o.mode });
  }

  return { value: {
    label, icon, visibility, outside, is_active: body.is_active ?? true,
    department_keys: [...new Set<string>(department_keys)], user_ids: [...new Set<string>(user_ids)],
    include_unassigned: visibility === 'departments' && !!body.include_unassigned, items, overrides,
  } };
}

type RuleMenu = Pick<Menu, 'id' | 'is_active' | 'visibility' | 'department_keys' | 'user_ids' | 'include_unassigned' | 'outside'>;
/** The person: id, and their department with its parent departments (empty = no department). */
export type MenuViewer = { id: string; departments: string[] };

/** Whether and how one person sees one menu (null = hidden). */
export function menuStateFor(menu: RuleMenu, viewer: MenuViewer, override?: 'show' | 'hide'): { state: 'open' | 'folded'; member: boolean } | null {
  if (!menu.is_active || override === 'hide') return null;
  const byDepartment = menu.visibility === 'departments' && viewer.departments.some(d => menu.department_keys.includes(d));
  const byName = menu.visibility === 'people' && menu.user_ids.includes(viewer.id);
  const member = override === 'show' || byDepartment || byName;
  const inRule = member || menu.visibility === 'everyone' || (menu.visibility === 'departments' && menu.include_unassigned && !viewer.departments.length);
  if (inRule) return { state: 'open', member };
  return menu.outside === 'fold' ? { state: 'folded', member: false } : null;
}

async function loadMenus(where = '', params: unknown[] = []): Promise<Menu[]> {
  return (await query(
    `SELECT m.id, m.key, m.label, m.icon, m.sort_order, m.is_system, m.is_active, m.visibility, m.department_keys,
       m.user_ids::text[] AS user_ids, m.include_unassigned, m.outside,
       COALESCE((SELECT json_agg(json_build_object('id', i.id, 'label', i.label, 'path', i.path, 'icon', i.icon, 'module_key', i.module_key) ORDER BY i.sort_order)
         FROM nav_menu_items i WHERE i.menu_id = m.id), '[]'::json) AS items,
       COALESCE((SELECT json_agg(json_build_object('user_id', o.user_id, 'mode', o.mode,
           'name', COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email)) ORDER BY u.first_name, u.last_name)
         FROM nav_menu_overrides o JOIN users u ON u.id = o.user_id WHERE o.menu_id = m.id), '[]'::json) AS overrides
     FROM nav_menus m ${where} ORDER BY m.sort_order, LOWER(m.label)`, params,
  )).rows;
}

export const listMenus = () => loadMenus();
export const getMenu = async (id: string) => UUID.test(id) ? (await loadMenus('WHERE m.id = $1', [id]))[0] ?? null : null;

/** The person's department and the departments above it, nearest first. */
async function departmentChain(userId: string): Promise<string[] | null> {
  const user = (await query(`SELECT department FROM users WHERE id = $1`, [userId])).rows[0];
  if (!user) return null;
  if (!user.department) return [];
  return (await query(
    `WITH RECURSIVE chain AS (
       SELECT id, key, parent_id, 0 AS depth FROM departments WHERE key = $1
       UNION ALL SELECT d.id, d.key, d.parent_id, c.depth + 1 FROM departments d JOIN chain c ON d.id = c.parent_id WHERE c.depth < 20
     ) SELECT key FROM chain ORDER BY depth`, [user.department],
  )).rows.map(r => r.key);
}

/** The menus this person sees, in order (null = no such person). */
export async function menusForUser(userId: string): Promise<ResolvedMenu[] | null> {
  const departments = await departmentChain(userId);
  if (departments === null) return null;
  const overrides = new Map<string, 'show' | 'hide'>(
    (await query(`SELECT menu_id, mode FROM nav_menu_overrides WHERE user_id = $1`, [userId])).rows.map(r => [r.menu_id, r.mode]),
  );
  const out: ResolvedMenu[] = [];
  for (const m of await loadMenus('WHERE m.is_active')) {
    const seen = menuStateFor(m, { id: userId, departments }, overrides.get(m.id));
    if (!seen) continue;
    out.push({ key: m.key, label: m.label, icon: m.icon, is_system: m.is_system, ...seen,
      items: m.items.map(({ label, path, icon, module_key }) => ({ label, path, icon, module_key })) });
  }
  return out;
}

function customKey(label: string): string {
  const slug = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'menu';
  return `custom-${slug}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Creates a custom menu (no id) or updates one. A system menu keeps its key and pages. */
export async function saveMenu(input: MenuInput, id?: string): Promise<Menu> {
  const savedId = await withTransaction(async client => {
    let menuId = id;
    if (menuId) {
      const found = (await client.query(`SELECT is_system FROM nav_menus WHERE id = $1 FOR UPDATE`, [menuId])).rows[0];
      if (!found) throw new MenuError(404, 'Menu not found.');
      await client.query(
        `UPDATE nav_menus SET label=$2, icon=$3, is_active=$4, visibility=$5, department_keys=$6, user_ids=$7, include_unassigned=$8, outside=$9, updated_at=NOW() WHERE id=$1`,
        [menuId, input.label, input.icon, input.is_active, input.visibility, input.department_keys, input.user_ids, input.include_unassigned, input.outside],
      );
      if (!found.is_system) await client.query(`DELETE FROM nav_menu_items WHERE menu_id = $1`, [menuId]);
    } else {
      const next = (await client.query(`SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM nav_menus`)).rows[0].n;
      menuId = (await client.query(
        `INSERT INTO nav_menus (key, label, icon, sort_order, is_active, visibility, department_keys, user_ids, include_unassigned, outside)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [customKey(input.label), input.label, input.icon, next, input.is_active, input.visibility, input.department_keys, input.user_ids, input.include_unassigned, input.outside],
      )).rows[0].id as string;
    }
    for (const [i, it] of input.items.entries()) {
      await client.query(`INSERT INTO nav_menu_items (menu_id, label, path, icon, module_key, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`,
        [menuId, it.label, it.path, it.icon, it.module_key, i]);
    }
    await client.query(`DELETE FROM nav_menu_overrides WHERE menu_id = $1`, [menuId]);
    for (const o of input.overrides) {
      await client.query(`INSERT INTO nav_menu_overrides (menu_id, user_id, mode) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [menuId, o.user_id, o.mode]);
    }
    return menuId;
  });
  return (await getMenu(savedId))!;
}

/** Removes a custom menu. System menus can only be switched off. */
export async function deleteMenu(id: string): Promise<Menu> {
  const menu = await getMenu(id);
  if (!menu) throw new MenuError(404, 'Menu not found.');
  if (menu.is_system) throw new MenuError(409, 'Built-in menus cannot be removed; switch them off instead.');
  await query(`DELETE FROM nav_menus WHERE id = $1`, [id]);
  return menu;
}

/** Sets the order of the menus listed (ids first to last); others keep their place after them. */
export async function reorderMenus(ids: unknown): Promise<void> {
  if (!Array.isArray(ids) || ids.some(i => typeof i !== 'string' || !UUID.test(i))) throw new MenuError(400, 'ids must be a list of menu ids.');
  await withTransaction(async client => {
    for (const [i, id] of ids.entries()) await client.query(`UPDATE nav_menus SET sort_order = $2 WHERE id = $1`, [id, (i + 1) * 10]);
  });
}
