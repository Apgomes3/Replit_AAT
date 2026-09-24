import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import dotenv from 'dotenv';
import { createProxyMiddleware } from 'http-proxy-middleware';

dotenv.config();

import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import productRoutes from './routes/products';
import knowledgeRoutes from './routes/knowledge';
import documentRoutes from './routes/documents';
import graphRoutes from './routes/graph';
import searchRoutes from './routes/search';
import importRoutes from './routes/import';
import adminRoutes from './routes/admin';
import purchaseOrderRoutes from './routes/purchaseOrders';
import notificationRoutes from './routes/notifications';
import designBookRoutes from './routes/designBooks';
import lssCompactUnitRoutes from './routes/lssCompactUnits';
import speciesCatalogRoutes from './routes/speciesCatalog';
import biologicalMediaRoutes from './routes/biologicalMedia';
import pumpSelectionRoutes from './routes/pumpSelections';
import lssControlRoutes from './routes/lssControls';
import frictionLossRoutes from './routes/frictionLoss';
import equipmentBreakdownRoutes from './routes/equipmentBreakdown';
import ozoneCalculationRoutes from './routes/ozoneCalculations';
import clientRoutes from './routes/clients';
import enquiryRoutes from './routes/enquiries';
import uvEngineeringRoutes, { uvEngineeringConsumerRoutes } from './routes/uvEngineering';
import { errorHandler, notFound } from './middleware/errors';
import { observe, summary } from './lib/telemetry';
import { authenticate, requireRole } from './middleware/auth';
import { readiness } from './middleware/readiness';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));
app.use(cors({ origin: true, credentials: true }));
app.use(observe);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1', projectRoutes);
app.use('/api/v1', productRoutes);
app.use('/api/v1', knowledgeRoutes);
app.use('/api/v1', documentRoutes);
app.use('/api/v1/graph', graphRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/import', importRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/admin/uv-engineering', uvEngineeringRoutes);
app.use('/api/v1', uvEngineeringConsumerRoutes);
app.use('/api/v1', purchaseOrderRoutes);
app.use('/api/v1', notificationRoutes);
app.use('/api/v1', designBookRoutes);
app.use('/api/v1', lssCompactUnitRoutes);
app.use('/api/v1', speciesCatalogRoutes);
app.use('/api/v1', biologicalMediaRoutes);
app.use('/api/v1', pumpSelectionRoutes);
app.use('/api/v1', lssControlRoutes);
app.use('/api/v1', frictionLossRoutes);
app.use('/api/v1', equipmentBreakdownRoutes);
app.use('/api/v1', ozoneCalculationRoutes);
app.use('/api/v1/clients', clientRoutes);
app.use('/api/v1/enquiries', enquiryRoutes);

app.get('/api/live', (_, res) => res.json({ status: 'alive' }));
app.get('/api/health', readiness());
app.get('/api/ready', readiness());
app.get('/api/v1/admin/operations', authenticate, requireRole('admin'), (req, res) => {
  const minutes = Number(req.query.minutes ?? 15);
  if (![5, 15, 60].includes(minutes)) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Choose 5, 15 or 60 minutes' } });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ windowMinutes: minutes, endpoints: summary(minutes) });
});

// Unknown API paths must not be proxied to the frontend.
app.use('/api', notFound);
app.use(errorHandler);

app.use('/', createProxyMiddleware({
  target: 'http://localhost:5000',
  changeOrigin: true,
  ws: true,
}));

app.listen(PORT, () => {
  console.log(`EDP API running on port ${PORT}`);
});

export default app;
