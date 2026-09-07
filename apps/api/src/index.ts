import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
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
import frictionLossRoutes from './routes/frictionLoss';
import ozoneCalculationRoutes from './routes/ozoneCalculations';
import uvEngineeringRoutes, { uvEngineeringConsumerRoutes } from './routes/uvEngineering';
import { errorHandler, notFound } from './middleware/errors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));
app.use(cors({ origin: true, credentials: true }));
app.use(morgan('dev'));
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
app.use('/api/v1', frictionLossRoutes);
app.use('/api/v1', ozoneCalculationRoutes);

app.get('/api/health', (_, res) => res.json({ status: 'ok', timestamp: new Date() }));

app.use('/', createProxyMiddleware({
  target: 'http://localhost:5000',
  changeOrigin: true,
  ws: true,
}));

app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`EDP API running on port ${PORT}`);
});

export default app;
