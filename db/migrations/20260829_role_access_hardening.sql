BEGIN;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employees(id) ON DELETE RESTRICT;

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check CHECK (role = ANY (ARRAY[
  'Payroll Officer'::text,
  'Head of Department'::text,
  'General Manager'::text,
  'CEO'::text,
  'Payment Officer'::text,
  'HR / Administrator'::text,
  'System Administrator'::text,
  'Employee'::text
]));
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_hod_department_check
  CHECK (role <> 'Head of Department' OR department_id IS NOT NULL);
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_employee_link_check
  CHECK (role <> 'Employee' OR employee_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_employee_id_key
  ON user_profiles(employee_id) WHERE employee_id IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_last_system_administrator() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role='System Administrator' AND OLD.active=true
     AND (NEW.role<>'System Administrator' OR NEW.active=false)
     AND (SELECT count(*) FROM user_profiles WHERE role='System Administrator' AND active=true)<=1 THEN
    RAISE EXCEPTION 'The last active System Administrator cannot be removed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS user_profiles_last_admin_guard ON user_profiles;
CREATE TRIGGER user_profiles_last_admin_guard BEFORE UPDATE OF role,active ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION protect_last_system_administrator();

ALTER TABLE approval_events
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id) ON DELETE RESTRICT;

ALTER TABLE payroll_periods
  ADD COLUMN IF NOT EXISTS paid_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS ceo_exception_reason text;

CREATE TABLE IF NOT EXISTS employee_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  changed_by_auth_id text NOT NULL,
  changed_by_name text NOT NULL,
  changed_by_role text NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) >= 5),
  effective_date date NOT NULL,
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_change_history_employee_created_idx
  ON employee_change_history(employee_id,created_at DESC);

CREATE TABLE IF NOT EXISTS payroll_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL UNIQUE REFERENCES payroll_periods(id) ON DELETE RESTRICT,
  payment_reference text NOT NULL UNIQUE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  recorded_by_auth_id text NOT NULL,
  recorded_by_name text NOT NULL,
  recorded_by_role text NOT NULL,
  comment text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION payroll_transition_secure(
  p_period_id uuid,
  p_action text,
  p_actor_auth_id text,
  p_comment text DEFAULT NULL,
  p_payment_ref text DEFAULT NULL,
  p_payment_amount numeric DEFAULT NULL
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_period payroll_periods%ROWTYPE;
  v_actor user_profiles%ROWTYPE;
  v_new_status text;
  v_new_stage smallint;
  v_gross numeric;
  v_net numeric;
  v_previous_gross numeric;
  v_threshold numeric;
  v_increase_threshold numeric;
  v_bonus_threshold numeric;
  v_reopened_required numeric;
  v_max_bonus numeric;
  v_hod_updated integer;
  v_exception_reasons text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v_actor
  FROM user_profiles
  WHERE active=true AND auth_user_id=p_actor_auth_id
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active payroll profile not found'; END IF;

  SELECT * INTO v_period FROM payroll_periods WHERE id=p_period_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll period not found'; END IF;
  IF v_period.locked_at IS NOT NULL THEN RAISE EXCEPTION 'Locked payroll cannot be changed'; END IF;

  IF p_action IN ('hod_verify','gm_approve','ceo_approve','return')
     AND NULLIF(trim(COALESCE(p_comment,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A decision comment is required';
  END IF;

  IF v_period.created_by_id=p_actor_auth_id
     AND p_action IN ('gm_approve','ceo_approve','record_payment') THEN
    RAISE EXCEPTION 'Payroll cannot be approved or paid by the user who prepared it.';
  END IF;

  IF p_action='record_payment' AND EXISTS (
    SELECT 1 FROM approval_events
    WHERE period_id=p_period_id
      AND actor_auth_id=p_actor_auth_id
      AND action IN ('gm_approve','ceo_approve')
  ) THEN
    RAISE EXCEPTION 'A payroll approver cannot record its payment.';
  END IF;

  SELECT COALESCE(sum(gross_pay),0),COALESCE(sum(net_pay),0),COALESCE(max(bonus),0)
  INTO v_gross,v_net,v_max_bonus
  FROM payroll_entries WHERE period_id=p_period_id;

  CASE p_action
    WHEN 'submit' THEN
      IF v_actor.role <> 'Payroll Officer' OR v_period.stage <> 0 THEN
        RAISE EXCEPTION 'Invalid submit action';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM payroll_entries WHERE period_id=p_period_id) THEN
        RAISE EXCEPTION 'Payroll has no employee entries';
      END IF;
      IF EXISTS (SELECT 1 FROM payroll_entries WHERE period_id=p_period_id AND net_pay<0) THEN
        RAISE EXCEPTION 'Payroll contains negative net pay';
      END IF;
      IF EXISTS (
        SELECT 1 FROM payroll_entries pe JOIN employees e ON e.id=pe.employee_id
        WHERE pe.period_id=p_period_id AND (
          NULLIF(trim(e.bank_name),'') IS NULL OR NULLIF(trim(e.account_name),'') IS NULL OR NULLIF(trim(e.account_number),'') IS NULL OR
          (e.ssnit_applicable=true AND NULLIF(trim(e.ssnit_number),'') IS NULL)
        )
      ) THEN
        RAISE EXCEPTION 'Employee bank or statutory information is incomplete';
      END IF;
      IF EXISTS (
        SELECT 1 FROM statutory_settings s
        WHERE s.category IN ('PAYE','Pension')
          AND s.effective_date<=COALESCE(v_period.payment_date,current_date)
          AND (s.end_date IS NULL OR s.end_date>=COALESCE(v_period.payment_date,current_date))
          AND s.confirmed_at IS NULL
      ) THEN
        RAISE EXCEPTION 'Applicable statutory settings require Accounts confirmation';
      END IF;
      UPDATE payroll_entries SET hod_verified=false,updated_at=now() WHERE period_id=p_period_id;
      v_new_status='Department Review';
      v_new_stage=1;

    WHEN 'hod_verify' THEN
      IF v_actor.role <> 'Head of Department' OR v_period.stage <> 1 OR v_actor.department_id IS NULL THEN
        RAISE EXCEPTION 'Invalid HOD verification';
      END IF;
      UPDATE payroll_entries pe
      SET hod_verified=true,updated_at=now()
      FROM employees e
      WHERE pe.period_id=p_period_id
        AND pe.employee_id=e.id
        AND e.department_id=v_actor.department_id
        AND pe.hod_verified=false;
      GET DIAGNOSTICS v_hod_updated = ROW_COUNT;
      IF v_hod_updated=0 AND NOT EXISTS (
        SELECT 1 FROM payroll_entries pe JOIN employees e ON e.id=pe.employee_id
        WHERE pe.period_id=p_period_id AND e.department_id=v_actor.department_id
      ) THEN
        RAISE EXCEPTION 'No payroll entries belong to the assigned department';
      END IF;
      IF EXISTS (SELECT 1 FROM payroll_entries WHERE period_id=p_period_id AND hod_verified=false) THEN
        v_new_status='Department Review';
        v_new_stage=1;
      ELSE
        v_new_status='Awaiting GM Approval';
        v_new_stage=2;
      END IF;

    WHEN 'gm_approve' THEN
      IF v_actor.role <> 'General Manager' OR v_period.stage <> 2 THEN
        RAISE EXCEPTION 'Invalid GM approval';
      END IF;
      IF EXISTS (SELECT 1 FROM payroll_entries WHERE period_id=p_period_id AND hod_verified=false) THEN
        RAISE EXCEPTION 'Department verification incomplete';
      END IF;

      SELECT rate INTO v_threshold FROM statutory_settings
      WHERE setting_name='CEO_PAYROLL_THRESHOLD'
        AND effective_date<=COALESCE(v_period.payment_date,current_date)
        AND (end_date IS NULL OR end_date>=COALESCE(v_period.payment_date,current_date))
      ORDER BY effective_date DESC LIMIT 1;
      IF v_threshold IS NOT NULL AND v_gross>v_threshold THEN
        v_exception_reasons:=array_append(v_exception_reasons,'Total payroll exceeds the configured CEO threshold');
      END IF;

      SELECT COALESCE(sum(pe.gross_pay),0) INTO v_previous_gross
      FROM payroll_periods pp JOIN payroll_entries pe ON pe.period_id=pp.id
      WHERE (pp.year,pp.month)<(v_period.year,v_period.month)
        AND pp.locked_at IS NOT NULL
        AND pp.id=(SELECT id FROM payroll_periods p2
          WHERE (p2.year,p2.month)<(v_period.year,v_period.month) AND p2.locked_at IS NOT NULL
          ORDER BY p2.year DESC,p2.month DESC LIMIT 1);
      SELECT rate INTO v_increase_threshold FROM statutory_settings
      WHERE setting_name='CEO_PAYROLL_INCREASE_PERCENT' AND active=true
      ORDER BY effective_date DESC LIMIT 1;
      IF v_previous_gross>0 AND v_increase_threshold IS NOT NULL
         AND ((v_gross-v_previous_gross)/v_previous_gross*100)>v_increase_threshold THEN
        v_exception_reasons:=array_append(v_exception_reasons,'Payroll increase exceeds the configured CEO percentage');
      END IF;

      SELECT rate INTO v_bonus_threshold FROM statutory_settings
      WHERE setting_name='CEO_BONUS_THRESHOLD' AND active=true
      ORDER BY effective_date DESC LIMIT 1;
      IF v_bonus_threshold IS NOT NULL AND v_max_bonus>v_bonus_threshold THEN
        v_exception_reasons:=array_append(v_exception_reasons,'A bonus exceeds the configured CEO threshold');
      END IF;

      SELECT rate INTO v_reopened_required FROM statutory_settings
      WHERE setting_name='CEO_REOPENED_PAYROLL_REQUIRED' AND active=true
      ORDER BY effective_date DESC LIMIT 1;
      IF COALESCE(v_reopened_required,0)>=1 AND EXISTS (
        SELECT 1 FROM approval_events WHERE period_id=p_period_id AND action='return'
      ) THEN
        v_exception_reasons:=array_append(v_exception_reasons,'The payroll was previously returned for correction');
      END IF;

      IF cardinality(v_exception_reasons)>0 THEN
        v_new_status='Awaiting CEO Approval';
        v_new_stage=3;
      ELSE
        v_new_status='Approved';
        v_new_stage=4;
      END IF;

    WHEN 'ceo_approve' THEN
      IF v_actor.role <> 'CEO' OR v_period.stage <> 3 THEN
        RAISE EXCEPTION 'Invalid CEO approval';
      END IF;
      v_new_status='Approved';
      v_new_stage=4;

    WHEN 'record_payment' THEN
      IF v_actor.role <> 'Payment Officer' OR v_period.stage <> 4
         OR NULLIF(trim(COALESCE(p_payment_ref,'')),'') IS NULL
         OR p_payment_amount IS NULL OR p_payment_amount<=0 THEN
        RAISE EXCEPTION 'Invalid payment confirmation';
      END IF;
      IF round(p_payment_amount,2)<>round(v_net,2) THEN
        RAISE EXCEPTION 'Payment amount must equal the approved net payroll';
      END IF;
      INSERT INTO payroll_payments(period_id,payment_reference,amount,recorded_by_auth_id,recorded_by_name,recorded_by_role,comment)
      VALUES(p_period_id,trim(p_payment_ref),round(p_payment_amount,2),v_actor.auth_user_id,v_actor.full_name,v_actor.role,p_comment);
      v_new_status='Locked';
      v_new_stage=5;

    WHEN 'return' THEN
      IF NOT (
        (v_actor.role='Head of Department' AND v_period.stage=1) OR
        (v_actor.role='General Manager' AND v_period.stage=2) OR
        (v_actor.role='CEO' AND v_period.stage=3)
      ) THEN
        RAISE EXCEPTION 'Invalid return action';
      END IF;
      UPDATE payroll_entries SET hod_verified=false,updated_at=now() WHERE period_id=p_period_id;
      v_new_status='Reopened';
      v_new_stage=0;

    ELSE
      RAISE EXCEPTION 'Unsupported payroll action';
  END CASE;

  UPDATE payroll_periods SET
    status=v_new_status,
    stage=v_new_stage,
    updated_at=now(),
    paid_reference=CASE WHEN p_action='record_payment' THEN trim(p_payment_ref) ELSE paid_reference END,
    paid_amount=CASE WHEN p_action='record_payment' THEN round(p_payment_amount,2) ELSE paid_amount END,
    paid_at=CASE WHEN p_action='record_payment' THEN now() ELSE paid_at END,
    locked_at=CASE WHEN p_action='record_payment' THEN now() ELSE locked_at END,
    ceo_exception_reason=CASE WHEN p_action='gm_approve' THEN NULLIF(array_to_string(v_exception_reasons,'; '),'') ELSE ceo_exception_reason END,
    version=version+1
  WHERE id=p_period_id;

  INSERT INTO approval_events(period_id,action,from_status,to_status,actor_auth_id,actor_name,actor_role,comment,department_id)
  VALUES(p_period_id,p_action,v_period.status,v_new_status,v_actor.auth_user_id,v_actor.full_name,v_actor.role,p_comment,
    CASE WHEN v_actor.role='Head of Department' THEN v_actor.department_id ELSE NULL END);

  INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description,metadata)
  VALUES('PAYROLL_TRANSITION','payroll_period',p_period_id::text,v_actor.auth_user_id,v_actor.full_name,v_actor.role,
    format('Payroll moved from %s to %s',v_period.status,v_new_status),
    jsonb_build_object('action',p_action,'version',v_period.version+1,'department_id',v_actor.department_id,
      'payment_amount',CASE WHEN p_action='record_payment' THEN round(p_payment_amount,2) ELSE NULL END));

  RETURN v_new_status;
END;
$$;

CREATE OR REPLACE FUNCTION payroll_transition_notify_secure(
  p_period_id uuid,
  p_action text,
  p_actor_auth_id text,
  p_comment text DEFAULT NULL,
  p_payment_ref text DEFAULT NULL,
  p_payment_amount numeric DEFAULT NULL
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_event_id uuid;
  v_period_code text;
  v_roles text[];
  v_title text;
  v_message text;
BEGIN
  v_status:=payroll_transition_secure(p_period_id,p_action,p_actor_auth_id,p_comment,p_payment_ref,p_payment_amount);

  SELECT e.id,p.period_code INTO v_event_id,v_period_code
  FROM approval_events e JOIN payroll_periods p ON p.id=e.period_id
  WHERE e.period_id=p_period_id AND e.action=p_action AND e.actor_auth_id=p_actor_auth_id AND e.to_status=v_status
  ORDER BY e.created_at DESC LIMIT 1;

  CASE
    WHEN p_action='submit' THEN
      v_roles:=ARRAY['Head of Department'];
      v_title:='Department review required';
      v_message:=format('%s is ready for department verification.',v_period_code);
    WHEN p_action='hod_verify' AND v_status='Awaiting GM Approval' THEN
      v_roles:=ARRAY['General Manager'];
      v_title:='General Manager approval required';
      v_message:=format('%s has completed every department verification and awaits General Manager approval.',v_period_code);
    WHEN p_action='gm_approve' AND v_status='Awaiting CEO Approval' THEN
      v_roles:=ARRAY['CEO'];
      v_title:='CEO approval required';
      v_message:=format('%s meets a configured escalation rule and requires CEO approval.',v_period_code);
    WHEN p_action IN ('gm_approve','ceo_approve') AND v_status='Approved' THEN
      v_roles:=ARRAY['Payment Officer'];
      v_title:='Payroll approved — payment pending';
      v_message:=format('%s is approved and requires payment reconciliation.',v_period_code);
    WHEN p_action='return' THEN
      v_roles:=ARRAY['Payroll Officer'];
      v_title:='Payroll returned for correction';
      v_message:=format('%s was returned for correction. Review the decision comment before resubmitting.',v_period_code);
    WHEN p_action='record_payment' THEN
      v_roles:=ARRAY['Payroll Officer','System Administrator'];
      v_title:='Payroll paid and locked';
      v_message:=format('Payment for %s was reconciled and the payroll is now locked.',v_period_code);
    ELSE
      v_roles:=ARRAY[]::text[];
  END CASE;

  IF v_event_id IS NOT NULL AND cardinality(v_roles)>0 THEN
    INSERT INTO approval_notifications(approval_event_id,period_id,recipient_profile_id,recipient_email,recipient_role,title,message)
    SELECT v_event_id,p_period_id,u.id,u.email,u.role,v_title,v_message
    FROM user_profiles u
    WHERE u.active=true AND u.role=ANY(v_roles)
      AND (p_action<>'submit' OR u.role<>'Head of Department' OR EXISTS (
        SELECT 1 FROM payroll_entries pe JOIN employees e ON e.id=pe.employee_id
        WHERE pe.period_id=p_period_id AND e.department_id=u.department_id
      ))
    ON CONFLICT (approval_event_id,recipient_profile_id) DO NOTHING;
  END IF;

  RETURN v_status;
END;
$$;

COMMIT;
