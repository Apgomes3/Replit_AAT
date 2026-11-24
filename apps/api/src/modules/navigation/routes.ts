// Admin -> Menus: mounted at /api/v1/admin/menus. Admins only.
import { Router, Response } from 'express';
import { query } from '../../db';
import { logAudit } from '../../db/audit';
import { authenticate, AuthRequest, requireRole } from '../../middleware/auth';
import { MODULE_ACCESS_KEYS, MODULE_ACCESS_LABELS } from '../../lib/moduleAccess';
import { getModuleAccess } from '../../routes/auth';
import { deleteMenu, getMenu, listMenus, MENU_ICONS, MenuError, menusForUser, reorderMenus, saveMenu, validateMenuInput } from './menus';

const router = Router();
router.use(authenticate, requireRole('admin'));

const fail = (res: Response, err: unknown) => {
  if (!(err instanceof MenuError)) throw err;
  res.status(err.status).json({ error: { code: err.status === 404 ? 'NOT_FOUND' : err.status === 409 ? 'CONFLICT' : 'INVALID_REQUEST', message: err.message } });
};
const invalid = (res: Response, message: string) => res.status(400).json({ error: { code: 'INVALID_REQUEST', message } });

router.get('/', async (_req, res: Response) => {
  const people = (await query(
    `SELECT id, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), email) AS name, department
     FROM users WHERE is_active IS NOT FALSE ORDER BY first_name, last_name, email`,
  )).rows;
  const departments = (await query(`SELECT key, name, parent_id, id, is_active FROM departments ORDER BY LOWER(name)`)).rows;
  res.json({
    data: await listMenus(), people, departments, icons: MENU_ICONS,
    modules: MODULE_ACCESS_KEYS.map(key => ({ key, label: MODULE_ACCESS_LABELS[key] })),
  });
});

router.get('/preview/:userId', async (req, res: Response) => {
  const id = String(req.params.userId);
  const person = /^[0-9a-f-]{36}$/i.test(id) ? (await query(`SELECT role FROM users WHERE id = $1`, [id])).rows[0] : null;
  const menus = person ? await menusForUser(id) : null;
  if (!menus) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Person not found.' } });
  res.json({ data: menus, role: person.role, module_access: await getModuleAccess(person.role) });
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const { value, error } = validateMenuInput(req.body);
  if (error) return invalid(res, error);
  const menu = await saveMenu(value!);
  await logAudit(req.user!.id, 'nav_menu', menu.id, 'CREATE', { label: menu.label, visibility: menu.visibility });
  res.status(201).json({ data: menu });
});

router.put('/reorder', async (req: AuthRequest, res: Response) => {
  try { await reorderMenus(req.body?.ids); } catch (err) { return fail(res, err); }
  await logAudit(req.user!.id, 'nav_menu', 'order', 'UPDATE', { ids: req.body.ids });
  res.json({ data: await listMenus() });
});

router.put('/:id', async (req: AuthRequest, res: Response) => {
  const before = await getMenu(String(req.params.id));
  if (!before) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Menu not found.' } });
  const { value, error } = validateMenuInput(req.body, before.is_system);
  if (error) return invalid(res, error);
  try {
    const menu = await saveMenu(value!, before.id);
    await logAudit(req.user!.id, 'nav_menu', menu.id, 'UPDATE', {
      label: menu.label, before: { visibility: before.visibility, outside: before.outside, is_active: before.is_active },
      after: { visibility: menu.visibility, outside: menu.outside, is_active: menu.is_active },
    });
    res.json({ data: menu });
  } catch (err) { fail(res, err); }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const menu = await deleteMenu(String(req.params.id));
    await logAudit(req.user!.id, 'nav_menu', menu.id, 'DELETE', { label: menu.label });
    res.json({ data: { id: menu.id } });
  } catch (err) { fail(res, err); }
});

export default router;
