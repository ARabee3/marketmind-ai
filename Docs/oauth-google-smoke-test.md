# Google OAuth Sandbox Smoke Test

This guide verifies the Google OAuth backend integration in a local sandbox.

## Prerequisites

- A Google account.
- Access to [Google Cloud Console](https://console.cloud.google.com/).
- Local services running:
  - PostgreSQL
  - Redis
  - MarketMind API (`npm run start:dev -w @marketmind/api`)

## 1. Create OAuth 2.0 Credentials

1. Go to **APIs & Services > Credentials**.
2. Click **Create Credentials > OAuth client ID**.
3. Configure the consent screen if prompted:
   - User Type: **External**
   - App name: `MarketMind AI Local`
   - User support email: your email
   - Developer contact: your email
   - Scopes: add `openid`, `email`, `profile`
4. Create an OAuth client ID:
   - Application type: **Web application**
   - Name: `MarketMind Web Local`
   - Authorized redirect URI: `http://localhost:3001/api/v1/auth/google/callback`
5. Copy the **Client ID** and **Client secret**.

## 2. Configure the API

Update `apps/api/.env`:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3001/api/v1/auth/google/callback
WEB_ORIGIN=http://localhost:3000
```

Restart the API.

## 3. Initiate the Flow

Open the following URL in a browser:

```
http://localhost:3001/api/v1/auth/google
```

Expected result: a 302 redirect to Google with `client_id`, `redirect_uri`, `scope=openid email profile`, and a `state` parameter.

## 4. Complete Sign-In

1. Sign in with a Google account that is **not** already registered with a password in MarketMind.
2. Approve the consent screen.

Expected result: Google redirects to:

```
http://localhost:3000/oauth/callback?status=success
```

The response includes an HttpOnly `refreshToken` cookie.

## 5. Verify the Session

Use the refresh cookie to obtain an access token:

```bash
curl -X POST http://localhost:3001/api/v1/auth/refresh \
  -H "Cookie: refreshToken=<value_from_browser>" \
  -c cookies.txt -b cookies.txt
```

Expected result: a JSON response with `accessToken`.

## 6. Same-Email Conflict Test

1. Register a password account with the same email as the Google account:

   ```bash
   curl -X POST http://localhost:3001/api/v1/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email":"<google_email>","password":"Password123!","fullName":"Conflict Test"}'
   ```

2. Try Google sign-in again with the same Google account.

Expected result: redirect to:

```
http://localhost:3000/oauth/callback?error=OAUTH_EMAIL_ALREADY_USED_PASSWORD&message=...
```

No session cookie is created.

## 7. Invalid State Test

Visit a callback URL with a made-up state:

```
http://localhost:3001/api/v1/auth/google/callback?state=fake-state&code=abc
```

Expected result: redirect to:

```
http://localhost:3000/oauth/callback?error=OAUTH_STATE_MISMATCH&message=...
```

## 8. Cancellation Test

Visit the callback URL with a Google error:

```
http://localhost:3001/api/v1/auth/google/callback?error=access_denied
```

Expected result: redirect to:

```
http://localhost:3000/oauth/callback?error=OAUTH_PROVIDER_ERROR&message=...
```

## Notes

- Do **not** commit real Google credentials to the repository.
- For CI and automated tests, the `GoogleOAuthClient` is mocked; no real Google calls are made.
- The `refreshToken` cookie is `HttpOnly`, `Secure` in production, `SameSite=Lax`, and scoped to path `/`.
