ALTER TABLE statutory_settings
  ADD COLUMN IF NOT EXISTS confirmed_by text,
  ADD COLUMN IF NOT EXISTS confirmed_by_name text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_note text;

COMMENT ON COLUMN statutory_settings.confirmed_by IS 'Authenticated user ID of the Accounts reviewer';
COMMENT ON COLUMN statutory_settings.confirmed_by_name IS 'Snapshot of the Accounts reviewer name';
COMMENT ON COLUMN statutory_settings.confirmed_at IS 'Time the active rate was confirmed against official sources';
COMMENT ON COLUMN statutory_settings.confirmation_note IS 'Accounts verification reference or note';
