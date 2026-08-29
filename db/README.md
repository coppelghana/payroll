# Database changes

Apply migrations in filename order. `20260829_role_access_hardening.sql` is additive and introduces role scoping, employee self-service linkage, effective-dated employee history, secure payroll transitions, payment reconciliation, and approval notifications.

Run `db/tests/role_workflow.sql` only on an isolated Neon branch. It creates synthetic role and payroll records to exercise the complete approval workflow.
