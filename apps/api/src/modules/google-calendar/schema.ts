// Google Calendar connections: one per Shark OS user, read-only access to their primary calendar.
// Tokens are stored encrypted (AES-256-GCM, key in GOOGLE_TOKEN_KEY) and never sent to the browser.
export const GOOGLE_CALENDAR_SCHEMA = `
CREATE TABLE IF NOT EXISTS google_calendar_connections (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  google_email VARCHAR(255) NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  access_token_enc TEXT,
  access_expires_at TIMESTAMPTZ,
  scope TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
