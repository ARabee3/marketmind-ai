# Brevo transactional mail setup and smoke test

This runbook configures MarketMind to send verification and password-reset
emails through Brevo without requiring a custom domain. Use a sender email
address controlled by the team.

## 1. Verify a sender in Brevo

1. Sign in to the team Brevo account.
2. Open **Settings**, then the **Senders & IP** or **Senders, Domains &
   Dedicated IPs** section shown by the current Brevo dashboard.
3. Add a sender using a team-controlled email address.
4. Open the verification message Brevo sends to that address and confirm it.
5. Wait until Brevo shows the sender as verified.

For the MVP, verifying this one sender address is sufficient. Domain
authentication remains deferred until the team owns a production domain.

## 2. Create an API key

1. Open **SMTP & API** in the Brevo account settings.
2. Select **API Keys**. Do not use an SMTP key with the MarketMind Brevo API
   adapter.
3. Generate a new API key named for the environment, such as
   `marketmind-local-mvp` or `marketmind-staging`.
4. Copy the key immediately and store it in the environment secret store. Do
   not commit it or paste it into issues, pull requests, screenshots, or logs.

## 3. Configure the API environment

Copy `apps/api/.env.example` to `apps/api/.env` if the local file does not
already exist. Set these values:

```dotenv
MAIL_PROVIDER=brevo
BREVO_API_KEY=replace-with-your-brevo-api-key
MAIL_FROM=the-exact-verified-sender@example.com
APP_URL=http://localhost:3000
```

`MAIL_FROM` must exactly match the sender verified in Brevo. Set `APP_URL` to
the deployed web origin in a hosted environment. Keep the existing database,
JWT, Redis, Google OAuth, and web-origin variables in the same `.env` file.

To return to local mock delivery, use:

```dotenv
MAIL_PROVIDER=mock
BREVO_API_KEY=
MAIL_FROM=
APP_URL=http://localhost:3000
```

Restart the API after changing environment variables.

## 4. Test verification delivery

Start the project, then register with an inbox the team can access:

```bash
curl --request POST http://localhost:3001/api/v1/auth/register \
  --header 'Content-Type: application/json' \
  --data '{"email":"replace-with-a-real-inbox@example.com","password":"StrongPass123!","fullName":"MVP Test Owner"}'
```

Confirm that:

- the message arrives at the recipient inbox;
- Brevo's transactional log shows the message;
- the sender shown in the message is the verified `MAIL_FROM` address.

The frontend `/verify-email` page is not implemented yet. Copy the `token`
query parameter from the email link and verify it directly:

```bash
curl --request POST http://localhost:3001/api/v1/auth/verify-email \
  --header 'Content-Type: application/json' \
  --data '{"token":"paste-the-verification-token"}'
```

## 5. Test password-reset delivery

Request a password reset:

```bash
curl --request POST http://localhost:3001/api/v1/auth/forgot-password \
  --header 'Content-Type: application/json' \
  --data '{"email":"replace-with-the-registered-inbox@example.com"}'
```

Confirm the reset message arrives and appears in Brevo's transactional log.
The frontend `/reset-password` page is also not implemented yet, so copy the
token from the email link and submit it directly:

```bash
curl --request POST http://localhost:3001/api/v1/auth/reset-password \
  --header 'Content-Type: application/json' \
  --data '{"token":"paste-the-reset-token","newPassword":"NewStrongPass456!"}'
```

Finally, confirm that the old password no longer works and the new password
does. The account must be email-verified before login succeeds.

## Troubleshooting

- **Startup rejects the environment:** check `MAIL_PROVIDER`, `BREVO_API_KEY`,
  and `MAIL_FROM`. Brevo mode deliberately has no silent mock fallback.
- **Brevo rejects the sender:** make `MAIL_FROM` exactly match the verified
  sender address in the Brevo dashboard.
- **Email is accepted but not in the inbox:** inspect the Brevo transactional
  log and the recipient spam folder.
- **The link opens a 404:** use the API commands above until the separate
  frontend verification and reset pages are implemented.
