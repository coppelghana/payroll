# Database migrations

The initial production schema was applied to the Neon project on 28 August 2026.

It creates the following controlled records:

- `departments`
- `user_profiles`
- `employees`
- `salary_history`
- `statutory_settings`
- `payroll_periods`
- `payroll_entries`
- `approval_events`
- `audit_log`

It also creates:

- `prevent_audit_mutation()` to enforce append-only audit records
- `payroll_transition(...)` to enforce roles, stages, maker-checker separation, CEO escalation, payment confirmation and locking

All future schema changes must be added as numbered migrations and tested on a Neon branch before production.
