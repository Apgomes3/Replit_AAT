# Google Calendar connection (read-only)

People can connect their Google account and see their Google Calendar events for the week in
**My work** (Home). Shark OS only asks for `calendar.readonly`, so it can't change anything in the calendar.

- API: `apps/api/src/modules/google-calendar/` (`/api/v1/google-calendar`)
- Web: `apps/web/src/pages/my-work/GoogleCalendarCard.tsx`
- Tokens: stored in `google_calendar_connections`, encrypted with AES-256-GCM using `GOOGLE_TOKEN_KEY`.
  They're never sent to the browser. Disconnecting revokes the token at Google and deletes the row.
- Who can connect: `GOOGLE_CALENDAR_ALLOWED_EMAILS` (comma-separated). Leave it empty to let everyone connect.

## One-time setup in Google Cloud Console (done by a Workspace admin, not by code)

1. Go to <https://console.cloud.google.com/> and create a project (for example "Shark OS").
2. **APIs & Services › Library**: enable **Google Calendar API**.
3. **APIs & Services › OAuth consent screen**:
   - User type **Internal**. This limits it to advanced-aquariums.com accounts and needs no Google verification.
   - App name "Shark OS", with a support email.
   - Scopes: add `.../auth/calendar.readonly`.
4. **APIs & Services › Credentials › Create credentials › OAuth client ID**:
   - Application type **Web application**.
   - Authorised redirect URI: `http://localhost:5000/api/v1/google-calendar/callback`.
     Add the production URL later, for example `https://<host>/api/v1/google-calendar/callback`.
5. Copy the client ID and client secret into `.env` (never into git):

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:5000/api/v1/google-calendar/callback
GOOGLE_TOKEN_KEY=<output of: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
GOOGLE_CALENDAR_ALLOWED_EMAILS=antonio@advanced-aquariums.com
```

6. Run `npm run migrate` and restart `npm run dev`. Then open Home and click
   **Connect Google Calendar** under "My work".

If you change `GOOGLE_TOKEN_KEY`, the stored tokens can no longer be read, so everyone has to reconnect.
