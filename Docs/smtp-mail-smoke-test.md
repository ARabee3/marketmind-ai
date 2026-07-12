# SMTP transactional mail setup and smoke test

This runbook configures MarketMind to send verification and password-reset
emails through a standard SMTP server. Any SMTP host works locally and in
production (Gmail with an app password, Mailgun, SES, etc.).

## 1. Configure the API environment

Copy `apps/api/.env.example` to `apps/api/.env` if the local file does not
already exist. Set the transactional-mail values:

```dotenv
MAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-sender@gmail.com
SMTP_PASS=your-app-password
MAIL_FROM=no-reply@example.com
APP_URL=http://localhost:3000
```

Notes:

- For Gmail, enable 2-Step Verification and generate an **App Password**
  (Google Account → Security → 2-Step Verification → App passwords). Use
  that 16-character app password as `SMTP_PASS` — never your account login
  password. Some Gmail accounts also require `SMTP_FROM` to equal
  `SMTP_USER`; if so, set `MAIL_FROM` to the same Gmail address.
- For Mailgun, SES, or Postmark, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  and `SMTP_PASS` to the provider's SMTP credentials and `MAIL_FROM` to a
  sender address verified in the provider dashboard.
- To return to local mock delivery (no email sent), use `MAIL_PROVIDER=mock`
  and leave the SMTP fields blank.

Restart the API after changing environment variables.

## 2. Test verification delivery

Start the project, then register with an inbox the team can access:

```bash
curl --request POST http://localhost:3001/api/v1/auth/register \
  --header 'Content-Type: application/json' \
  --data '{"email":"replace-with-a-real-inbox@example.com","password":"StrongPass123!","fullName":"MVP Test Owner"}'
```

Confirm that:

- the message arrives at the recipient inbox;
- the sender shown in the message is the configured `MAIL_FROM` address;
- the verification link points to `<APP_URL>/verify-email?token=...`.

The frontend `/verify-email` page reads the `token` query parameter and POSTs
it to `/api/v1/auth/verify-email`. To verify directly without the UI:

```bash
curl --request POST http://localhost:3001/api/v1/auth/verify-email \
  --header 'Content-Type: application/json' \
  --data '{"token":"paste-the-verification-token"}'
```

## 3. Test password-reset delivery

Request a password reset:

```bash
curl --request POST http://localhost:3001/api/v1/auth/forgot-password \
  --header 'Content-Type: application/json' \
  --data '{"email":"replace-with-the-registered-inbox@example.com"}'
```

Confirm the reset message arrives. The frontend `/reset-password` page reads
the `token` query parameter and POSTs the new password to
`/api/v1/auth/reset-password`. To reset directly without the UI:

```bash
curl --request POST http://localhost:3001/api/v1/auth/reset-password \
  --header 'Content-Type: application/json' \
  --data '{"token":"paste-the-reset-token","newPassword":"NewStrongPass456!"}'
```

Finally, confirm that the old password no longer works and the new password
does. The account must be email-verified before login succeeds.

## Troubleshooting

- **Startup rejects the environment:** check `MAIL_PROVIDER`, `SMTP_HOST`,
  `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM`. SMTP mode deliberately has no
  silent mock fallback.
- **Gmail rejects authentication:** confirm `SMTP_PASS` is an app password,
  not the account login password, and that 2-Step Verification is enabled.
- **Sender address rejected:** set `MAIL_FROM` to an address the SMTP
  provider allows you to send from. For Gmail, this typically means
  `MAIL_FROM` must equal `SMTP_USER`.
- **Email is accepted but not in the inbox:** inspect the recipient spam
  folder and the provider's delivery logs.
- **The link opens a 404:** use the API commands above until the frontend
  verification and reset pages are wired into your environment.