import { Request, Response } from 'express';
import pool from '../db';
import { databaseEvent } from '../lib/telemetry';

export function readiness(check: () => Promise<{ rowCount: number | null }> = () => pool.query('SELECT 1')) {
  return async (_req: Request, res: Response) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        check(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('readiness timeout')), 3000); }),
      ]);
      if (!result.rowCount) throw new Error('readiness failed');
      res.json({ status: 'ready', database: 'ok' });
    } catch {
      databaseEvent(0, true);
      res.status(503).json({ status: 'not_ready', database: 'unavailable' });
    } finally {
      clearTimeout(timer);
    }
  };
}