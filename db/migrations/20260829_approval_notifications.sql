CREATE TABLE IF NOT EXISTS approval_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_event_id uuid NOT NULL REFERENCES approval_events(id) ON DELETE RESTRICT,
  period_id uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT,
  recipient_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  recipient_email text NOT NULL,
  recipient_role text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  action_url text NOT NULL DEFAULT '/approvals',
  read_at timestamptz,
  email_status text NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending','sending','sent','failed')),
  email_attempts integer NOT NULL DEFAULT 0 CHECK (email_attempts >= 0),
  email_attempted_at timestamptz,
  email_sent_at timestamptz,
  email_message_id text,
  email_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (approval_event_id, recipient_profile_id)
);

CREATE INDEX IF NOT EXISTS approval_notifications_recipient_idx
  ON approval_notifications(recipient_profile_id, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS approval_notifications_email_queue_idx
  ON approval_notifications(email_status, created_at)
  WHERE email_status IN ('pending','failed');

CREATE OR REPLACE FUNCTION payroll_transition_notify(
  p_period_id uuid,
  p_action text,
  p_actor_auth_id text,
  p_actor_name text,
  p_actor_role text,
  p_comment text DEFAULT NULL,
  p_payment_ref text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_event_id uuid;
  v_period_code text;
  v_roles text[];
  v_title text;
  v_message text;
BEGIN
  v_status := payroll_transition(
    p_period_id,
    p_action,
    p_actor_auth_id,
    p_actor_name,
    p_actor_role,
    p_comment,
    p_payment_ref
  );

  SELECT e.id,p.period_code
  INTO v_event_id,v_period_code
  FROM approval_events e
  JOIN payroll_periods p ON p.id=e.period_id
  WHERE e.period_id=p_period_id
    AND e.action=p_action
    AND e.actor_auth_id=p_actor_auth_id
    AND e.to_status=v_status
  ORDER BY e.created_at DESC
  LIMIT 1;

  CASE
    WHEN p_action='submit' THEN
      v_roles := ARRAY['Head of Department'];
      v_title := 'Department review required';
      v_message := format('%s is ready for department verification.',v_period_code);
    WHEN p_action='hod_verify' THEN
      v_roles := ARRAY['General Manager'];
      v_title := 'General Manager approval required';
      v_message := format('%s has completed department verification and awaits General Manager approval.',v_period_code);
    WHEN p_action='gm_approve' AND v_status='Awaiting CEO Approval' THEN
      v_roles := ARRAY['CEO'];
      v_title := 'CEO approval required';
      v_message := format('%s exceeds the configured escalation threshold and requires CEO approval.',v_period_code);
    WHEN p_action IN ('gm_approve','ceo_approve') AND v_status='Approved' THEN
      v_roles := ARRAY['Payment Officer'];
      v_title := 'Payroll approved — payment pending';
      v_message := format('%s is approved and requires payment confirmation.',v_period_code);
    WHEN p_action='return' THEN
      v_roles := ARRAY['Payroll Officer'];
      v_title := 'Payroll returned for correction';
      v_message := format('%s was returned by %s. Review the approval comments before resubmitting.',v_period_code,p_actor_role);
    WHEN p_action='record_payment' THEN
      v_roles := ARRAY['Payroll Officer','System Administrator'];
      v_title := 'Payroll paid and locked';
      v_message := format('Payment for %s has been recorded and the payroll is now locked.',v_period_code);
    ELSE
      v_roles := ARRAY[]::text[];
  END CASE;

  IF v_event_id IS NOT NULL AND cardinality(v_roles)>0 THEN
    INSERT INTO approval_notifications(
      approval_event_id,period_id,recipient_profile_id,recipient_email,recipient_role,title,message
    )
    SELECT v_event_id,p_period_id,u.id,u.email,u.role,v_title,v_message
    FROM user_profiles u
    WHERE u.active=true AND u.role=ANY(v_roles)
    ON CONFLICT (approval_event_id,recipient_profile_id) DO NOTHING;
  END IF;

  RETURN v_status;
END;
$$;
