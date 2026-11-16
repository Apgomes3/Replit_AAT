// PIM product API (/api/v1): families, product masters, BOMs and sourcing, components, and
// engineering data. Split from the former routes/products.ts; the order of the files below is the
// order the routes were registered in, which Express relies on for overlapping paths.
import { Router } from 'express';
import { authenticate, requireModuleAccess } from '../../../middleware/auth';
import routes0 from './familyRoutes';
import routes1 from './productMasterRoutes';
import routes2 from './bomAndSourcingRoutes';
import routes3 from './componentRoutes';
import routes4 from './engineeringDataRoutes';

const router = Router();
router.use(authenticate, requireModuleAccess('pim'));
router.use(routes0);
router.use(routes1);
router.use(routes2);
router.use(routes3);
router.use(routes4);

export default router;
