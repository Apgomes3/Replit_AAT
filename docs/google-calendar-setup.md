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

## Alternative: a personal Gmail account (for example apgomes.aat@gmail.com)

The Shark OS login and the Google account don't have to match: anyone signed in to Shark OS can
connect any Google account, because the Connect button opens Google's account chooser.
`GOOGLE_CALENDAR_ALLOWED_EMAILS` checks the **Shark OS** login, not the Google account.

A personal Gmail account has no Workspace, so **Internal** isn't available. In Google Cloud Console
(signed in as the Gmail account), the steps change like this:

1. Project and **Google Calendar API**: same as above. There's no organisation to choose.
2. **Google Auth Platform › Branding**: fill in the app name and emails. **Audience: External.**
3. **Audience (Público-alvo) › Test users**: add the Gmail address that will connect.
4. **Data access (Acesso a dados)**: add `.../auth/calendar.readonly`. If it isn't listed, use
   **Manually add scopes**.
5. **Clients (Clientes)**: same as above (web application, same redirect URI).

While the app's publishing status is **Testing**:

- Only the listed test users can connect.
- Google ends the connection after about **7 days**. The card then shows *Connect Google Calendar*
  again, and one click reconnects.
- When connecting, Google shows "Google hasn't verified this app". Click **Advanced**, then
  **Go to Shark OS (unsafe)**, then **Allow**.

To publish (and stop the 7-day reconnect), Branding needs a home page link and a privacy policy
link on a domain you own; `localhost` isn't accepted. Then **Audience › Publish app**. Without
Google's verification, people still see the warning, and the app is limited to 100 users.

## Going live

1. In the OAuth client, add the production redirect URI:
   `https://<host>/api/v1/google-calendar/callback`.
2. In the server's `.env`, set the same five `GOOGLE_*` values, with `GOOGLE_REDIRECT_URI` set to the
   production URI. Leave `GOOGLE_CALENDAR_ALLOWED_EMAILS` empty so everyone can connect.
3. Run `npm run migrate` and restart.

One OAuth client serves everyone. Each person connects their own Google account, and their
connection is stored separately.

## Troubleshooting (Windows)

- `npm.ps1 cannot be loaded because running scripts is disabled`: use `npm.cmd`
  (`npm.cmd run migrate`, `npm.cmd run dev`).
- `Port 5000 is already in use`: an older Shark OS is still running. Stop it before starting again.
- `redirect_uri_mismatch` from Google: the redirect URI in the OAuth client must match
  `GOOGLE_REDIRECT_URI` exactly.
