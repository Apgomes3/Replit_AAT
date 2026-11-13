// HTTP layer for the PIM attribute library (/api/v1/pim). Reading needs PIM access, changes need PIM manage.
import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest, requireModuleAccess, requireModuleManage } from '../../middleware/auth';
import { logAudit } from '../../db/audit';
import * as repo from './repository';
import { isUuid, validateAttributeInput, validateTemplate } from './validation';

const router = Router();
router.use(authenticate, requireModuleAccess('pim'));
const manage = requireModuleManage('pim');

const fail = (res: Response, status: number, code: string, message: string) =>
  res.status(status).json({ error: { code, message } });

function handleDbError(e: any, res: Response, next: NextFunction) {
  if (e instanceof repo.PimRuleError) return fail(res, 400, 'VALIDATION', e.message);
  if (e?.code === '23505') return fail(res, 409, 'CONFLICT', 'An attribute with this code already exists.');
  if (e?.code === '23503') return fail(res, 400, 'VALIDATION', 'The selected group or unit does not exist.');
  if (e?.code === '23514') return fail(res, 400, 'VALIDATION', 'The attribute settings are not consistent (check type, unit and min/max).');
  return next(e);
}

const pid = (req: { params: Record<string, unknown> }) => String(req.params.id);
const badId = (res: Response, id: string) => (isUuid(id) ? null : fail(res, 400, 'VALIDATION', 'id must be a valid id.'));

router.get('/units', async (_req, res, next) => {
  try { res.json({ data: await repo.listUnits() }); } catch (e) { next(e); }
});

router.get('/attribute-groups', async (_req, res, next) => {
  try { res.json({ data: await repo.listGroups() }); } catch (e) { next(e); }
});

// ---------- attributes ----------

router.get('/attributes', async (_req, res, next) => {
  try { res.json({ data: await repo.listAttributes() }); } catch (e) { next(e); }
});

router.post('/attributes', manage, async (req: AuthRequest, res, next) => {
  try {
    const { value, error } = validateAttributeInput(req.body, { creating: true });
    if (error) return fail(res, 400, 'VALIDATION', error);
    const attribute = await repo.createAttribute(value!, req.user!.id);
    await logAudit(req.user!.id, 'pim_attribute', attribute.id, 'CREATE', { code: attribute.code, label: attribute.label });
    res.status(201).json(attribute);
  } catch (e) { handleDbError(e, res, next); }
});

router.patch('/attributes/:id', manage, async (req: AuthRequest, res, next) => {
  try {
    if (badId(res, pid(req))) return;
    const { value, error } = validateAttributeInput(req.body, { creating: false });
    if (error) return fail(res, 400, 'VALIDATION', error);
    const attribute = await repo.updateAttribute(pid(req), value!, req.user!.id);
    if (!attribute) return fail(res, 404, 'NOT_FOUND', 'Attribute not found.');
    await logAudit(req.user!.id, 'pim_attribute', attribute.id, 'UPDATE', { code: attribute.code, fields: Object.keys(value!) });
    res.json(attribute);
  } catch (e) { handleDbError(e, res, next); }
});

router.delete('/attributes/:id', manage, async (req: AuthRequest, res, next) => {
  try {
    if (badId(res, pid(req))) return;
    if ((await repo.deleteAttribute(pid(req))) === 'not_found') return fail(res, 404, 'NOT_FOUND', 'Attribute not found.');
    await logAudit(req.user!.id, 'pim_attribute', pid(req), 'DELETE', {});
    res.status(204).end();
  } catch (e) { handleDbError(e, res, next); }
});

// ---------- family templates ----------

router.get('/families', async (_req, res, next) => {
  try { res.json({ data: await repo.listFamilies() }); } catch (e) { next(e); }
});

router.get('/families/:id/attributes', async (req, res, next) => {
  try {
    if (badId(res, pid(req))) return;
    if (!(await repo.familyExists(pid(req)))) return fail(res, 404, 'NOT_FOUND', 'Family not found.');
    res.json({ data: await repo.getTemplate(pid(req)) });
  } catch (e) { next(e); }
});

router.put('/families/:id/attributes', manage, async (req: AuthRequest, res, next) => {
  try {
    if (badId(res, pid(req))) return;
    const { value, error } = validateTemplate(req.body);
    if (error) return fail(res, 400, 'VALIDATION', error);
    if (!(await repo.familyExists(pid(req)))) return fail(res, 404, 'NOT_FOUND', 'Family not found.');
    const template = await repo.replaceTemplate(pid(req), value!);
    await logAudit(req.user!.id, 'product_family', pid(req), 'UPDATE', {
      summary: 'Family template updated', attributes: value!.length, required: value!.filter(v => v.required).length,
    });
    res.json({ data: template });
  } catch (e) { handleDbError(e, res, next); }
});

// ---------- item values ----------

router.get('/items/:id/attributes', async (req, res, next) => {
  try {
    if (badId(res, pid(req))) return;
    const result = await repo.getItemAttributes(pid(req));
    if (!result) return fail(res, 404, 'NOT_FOUND', 'Product not found.');
    res.json(result);
  } catch (e) { next(e); }
});

router.put('/items/:id/attributes', manage, async (req: AuthRequest, res, next) => {
  try {
    if (badId(res, pid(req))) return;
    const values = req.body?.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) return fail(res, 400, 'VALIDATION', 'values must be an object of attribute id → value.');
    const saved = await repo.saveItemValues(pid(req), values, req.user!.id);
    if (!saved) return fail(res, 404, 'NOT_FOUND', 'Product not found.');
    if (saved.changed.length) {
      await logAudit(req.user!.id, 'product_master', pid(req), 'UPDATE', { summary: 'Attributes updated', fields: saved.changed });
    }
    res.json(saved.result);
  } catch (e) { handleDbError(e, res, next); }
});

export default router;
