// All SQL for Google Calendar connections. Token columns hold ciphertext only.
import { query } from '../../db';

export type ConnectionRow = {
  user_id: string; google_email: string; refresh_token_enc: string; access_token_enc: string | null;
  access_expires_at: Date | null; scope: string; connected_at: Date;
};

export async function getConnection(userId: string): Promise<ConnectionRow | null> {
  const r = await query('SELECT * FROM google_calendar_connections WHERE user_id=$1', [userId]);
  return r.rows[0] ?? null;
}

export async function saveConnection(c: {
  userId: string; googleEmail: string; refreshTokenEnc: string; accessTokenEnc: string; accessExpiresAt: Date; scope: string;
}) {
  await query(
    `INSERT INTO google_calendar_connections (user_id, google_email, refresh_token_enc, access_token_enc, access_expires_at, scope)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id) DO UPDATE SET google_email=EXCLUDED.google_email, refresh_token_enc=EXCLUDED.refresh_token_enc,
       access_token_enc=EXCLUDED.access_token_enc, access_expires_at=EXCLUDED.access_expires_at, scope=EXCLUDED.scope,
       connected_at=NOW(), updated_at=NOW()`,
    [c.userId, c.googleEmail, c.refreshTokenEnc, c.accessTokenEnc, c.accessExpiresAt, c.scope],
  );
}

export async function saveAccessToken(userId: string, accessTokenEnc: string, expiresAt: Date) {
  await query('UPDATE google_calendar_connections SET access_token_enc=$2, access_expires_at=$3, updated_at=NOW() WHERE user_id=$1',
    [userId, accessTokenEnc, expiresAt]);
}

export async function deleteConnection(userId: string): Promise<boolean> {
  const r: any = await query('DELETE FROM google_calendar_connections WHERE user_id=$1', [userId]);
  return (r.rowCount ?? 0) > 0;
}
