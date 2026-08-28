# Coppel Payroll

Secure payroll operations for Coppel Company Limited, Ghana.

## Architecture

- Next.js App Router on Vercel
- Neon PostgreSQL with pooled serverless connections
- Neon Managed Better Auth
- Server Actions with role-based authorization
- Database-enforced payroll transitions and maker-checker validation
- Append-only audit log

## Required environment variables

Copy `.env.example` to `.env.local` and provide:

- `DATABASE_URL`
- `NEON_AUTH_BASE_URL`
- `NEON_AUTH_COOKIE_SECRET`
- `BOOTSTRAP_ADMIN_TOKEN`

Never commit actual values.

## Local development

```bash
npm install
npm run typecheck
npm run dev
```

## First administrator

1. Create an account from `/auth/sign-up`.
2. Open `/setup`.
3. Enter the one-time `BOOTSTRAP_ADMIN_TOKEN`.
4. Invite other users from Settings using their exact work email and assigned role.

Only the first authenticated user can claim the initial administrator role.

## Security controls

- Users cannot select or change their own role.
- Payroll transitions are checked in PostgreSQL.
- The preparer cannot approve their own payroll.
- Approved payroll is immutable after payment locking.
- Audit entries reject update and delete operations.
- Sensitive environment values remain outside source control.

Before real payroll use, complete the Neon Auth production checklist, verify Ghana statutory settings with a qualified accountant, move Neon from the free plan, configure backups, and conduct an independent security review.
