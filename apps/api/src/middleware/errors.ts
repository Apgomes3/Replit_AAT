import { Request, Response, NextFunction } from 'express';
import { correlationId, emit, flagDatabaseFailure, isDatabaseError } from '../lib/telemetry';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  const database = isDatabaseError(err);
  if (database) flagDatabaseFailure();
  emit({ event: 'http_error', correlationId: correlationId(), category: database ? 'database' : status >= 500 ? 'application' : 'invalid_client', status });
  res.status(status).json({
    error: {
      code: status >= 500 ? (database ? 'DATABASE_UNAVAILABLE' : 'SERVER_ERROR') : (typeof err?.code === 'string' && /^[A-Z_]{2,40}$/.test(err.code) ? err.code : 'BAD_REQUEST'),
      // Domain routes deliberately forward plain Error(status) with actionable
      // validation/conflict guidance. Parser/library exceptions are not trusted.
      message: status >= 500 ? 'An unexpected error occurred' :
        (err?.constructor === Error && typeof err.message === 'string' ? err.message : 'Invalid request'),
      correlationId: correlationId(),
    }
  });
};

export const notFound = (req: Request, res: Response) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', correlationId: correlationId() } });
};
