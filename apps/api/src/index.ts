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
import { errorHandler, notFound } from './middleware/errors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: true, credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

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
