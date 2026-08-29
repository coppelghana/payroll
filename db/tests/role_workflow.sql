DO $$
DECLARE
  v_suffix text := replace(gen_random_uuid()::text,'-','');
  v_department_a uuid;
  v_department_b uuid;
  v_employee_a uuid := gen_random_uuid();
  v_employee_b uuid := gen_random_uuid();
  v_period_routine uuid := gen_random_uuid();
  v_period_escalated uuid := gen_random_uuid();
  v_payroll_profile uuid;
  v_hod_a_profile uuid;
  v_hod_b_profile uuid;
  v_gm_profile uuid;
  v_ceo_profile uuid;
  v_payment_profile uuid;
  v_employee_profile uuid;
  v_status text;
  v_count integer;
BEGIN
  SELECT id INTO v_department_a FROM departments WHERE active ORDER BY name LIMIT 1;
  SELECT id INTO v_department_b FROM departments WHERE active AND id<>v_department_a ORDER BY name LIMIT 1;
  IF v_department_a IS NULL OR v_department_b IS NULL THEN RAISE EXCEPTION 'Two active departments are required'; END IF;

  INSERT INTO employees(id,employee_no,full_name,department_id,job_title,employment_type,date_joined,basic_salary,bank_name,account_name,account_number,ssnit_number)
  VALUES
    (v_employee_a,'RBAC-A-'||left(v_suffix,6),'Role Test A',v_department_a,'Tester','Permanent','2098-01-01',1000,'Test Bank','Role Test A','0001','SSNIT-A'),
    (v_employee_b,'RBAC-B-'||left(v_suffix,6),'Role Test B',v_department_b,'Tester','Permanent','2098-01-01',1200,'Test Bank','Role Test B','0002','SSNIT-B');

  INSERT INTO user_profiles(email,full_name,role,auth_user_id) VALUES
    ('payroll-'||v_suffix||'@example.invalid','Payroll Test','Payroll Officer','rbac-payroll-'||v_suffix) RETURNING id INTO v_payroll_profile;
  INSERT INTO user_profiles(email,full_name,role,auth_user_id,department_id) VALUES
    ('hod-a-'||v_suffix||'@example.invalid','HOD A Test','Head of Department','rbac-hod-a-'||v_suffix,v_department_a) RETURNING id INTO v_hod_a_profile;
  INSERT INTO user_profiles(email,full_name,role,auth_user_id,department_id) VALUES
    ('hod-b-'||v_suffix||'@example.invalid','HOD B Test','Head of Department','rbac-hod-b-'||v_suffix,v_department_b) RETURNING id INTO v_hod_b_profile;
  INSERT INTO user_profiles(email,full_name,role,auth_user_id) VALUES
    ('gm-'||v_suffix||'@example.invalid','GM Test','General Manager','rbac-gm-'||v_suffix) RETURNING id INTO v_gm_profile;
  INSERT INTO user_profiles(email,full_name,role,auth_user_id) VALUES
    ('ceo-'||v_suffix||'@example.invalid','CEO Test','CEO','rbac-ceo-'||v_suffix) RETURNING id INTO v_ceo_profile;
  INSERT INTO user_profiles(email,full_name,role,auth_user_id) VALUES
    ('payment-'||v_suffix||'@example.invalid','Payment Test','Payment Officer','rbac-payment-'||v_suffix) RETURNING id INTO v_payment_profile;
  INSERT INTO user_profiles(email,full_name,role,auth_user_id,employee_id) VALUES
    ('employee-'||v_suffix||'@example.invalid','Employee Test','Employee','rbac-employee-'||v_suffix,v_employee_a) RETURNING id INTO v_employee_profile;

  INSERT INTO statutory_settings(setting_name,category,rate,effective_date,source_reference,active)
  VALUES('CEO_PAYROLL_THRESHOLD','Approval',100000,'2098-01-01','Automated role workflow test',true)
  ON CONFLICT(setting_name,effective_date) DO UPDATE SET rate=excluded.rate,source_reference=excluded.source_reference;

  INSERT INTO payroll_periods(id,period_code,month,year,start_date,end_date,payment_date,created_by_id,created_by_name)
  VALUES(v_period_routine,'RBAC-R-'||left(v_suffix,12),1,2099,'2099-01-01','2099-01-31','2099-01-31','rbac-payroll-'||v_suffix,'Payroll Test');
  INSERT INTO payroll_entries(period_id,employee_id,basic_salary,gross_pay,pensionable_salary,net_pay)
  VALUES(v_period_routine,v_employee_a,1000,1000,1000,900),(v_period_routine,v_employee_b,1200,1200,1200,1100);

  BEGIN
    PERFORM payroll_transition_notify_secure(v_period_routine,'submit','rbac-payroll-'||v_suffix,NULL,NULL,NULL);
    RAISE EXCEPTION 'Unconfirmed statutory settings were not rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='Unconfirmed statutory settings were not rejected' OR SQLERRM NOT LIKE '%statutory settings%' THEN RAISE; END IF;
  END;
  UPDATE statutory_settings SET confirmed_by='rbac-payroll-'||v_suffix,confirmed_by_name='Payroll Test',confirmed_at=now(),confirmation_note='Automated workflow test'
  WHERE category IN ('PAYE','Pension') AND effective_date<='2099-02-28' AND (end_date IS NULL OR end_date>='2099-01-01') AND confirmed_at IS NULL;

  v_status:=payroll_transition_notify_secure(v_period_routine,'submit','rbac-payroll-'||v_suffix,NULL,NULL,NULL);
  IF v_status<>'Department Review' THEN RAISE EXCEPTION 'Submit routing failed'; END IF;

  BEGIN
    PERFORM payroll_transition_notify_secure(v_period_routine,'hod_verify','rbac-hod-a-'||v_suffix,NULL,NULL,NULL);
    RAISE EXCEPTION 'Required HOD comment was not enforced';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='Required HOD comment was not enforced' OR SQLERRM NOT LIKE '%decision comment%' THEN RAISE; END IF;
  END;

  v_status:=payroll_transition_notify_secure(v_period_routine,'hod_verify','rbac-hod-a-'||v_suffix,'Department A verified',NULL,NULL);
  IF v_status<>'Department Review' THEN RAISE EXCEPTION 'Partial HOD review advanced too early'; END IF;
  SELECT count(*) INTO v_count FROM payroll_entries pe JOIN employees e ON e.id=pe.employee_id
  WHERE pe.period_id=v_period_routine AND ((e.department_id=v_department_a AND pe.hod_verified) OR (e.department_id=v_department_b AND NOT pe.hod_verified));
  IF v_count<>2 THEN RAISE EXCEPTION 'HOD verification was not department scoped'; END IF;

  v_status:=payroll_transition_notify_secure(v_period_routine,'hod_verify','rbac-hod-b-'||v_suffix,'Department B verified',NULL,NULL);
  IF v_status<>'Awaiting GM Approval' THEN RAISE EXCEPTION 'Final HOD review did not route to GM'; END IF;
  SELECT count(*) INTO v_count FROM approval_notifications WHERE period_id=v_period_routine AND recipient_profile_id=v_gm_profile;
  IF v_count<>1 THEN RAISE EXCEPTION 'GM notification must be queued once after all HOD reviews'; END IF;

  v_status:=payroll_transition_notify_secure(v_period_routine,'gm_approve','rbac-gm-'||v_suffix,'Routine payroll approved',NULL,NULL);
  IF v_status<>'Approved' THEN RAISE EXCEPTION 'Routine GM approval did not reach payment'; END IF;

  BEGIN
    PERFORM payroll_transition_notify_secure(v_period_routine,'record_payment','rbac-payment-'||v_suffix,'Mismatch test','RBAC-WRONG-'||v_suffix,1999);
    RAISE EXCEPTION 'Payment mismatch was not rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='Payment mismatch was not rejected' OR SQLERRM NOT LIKE '%must equal%' THEN RAISE; END IF;
  END;
  v_status:=payroll_transition_notify_secure(v_period_routine,'record_payment','rbac-payment-'||v_suffix,'Reconciled','RBAC-PAY-1-'||v_suffix,2000);
  IF v_status<>'Locked' THEN RAISE EXCEPTION 'Reconciled payment did not lock payroll'; END IF;

  INSERT INTO statutory_settings(setting_name,category,rate,effective_date,source_reference,active)
  VALUES('CEO_PAYROLL_THRESHOLD','Approval',100,'2099-02-01','Automated role workflow test',true)
  ON CONFLICT(setting_name,effective_date) DO UPDATE SET rate=excluded.rate,source_reference=excluded.source_reference;
  INSERT INTO payroll_periods(id,period_code,month,year,start_date,end_date,payment_date,created_by_id,created_by_name)
  VALUES(v_period_escalated,'RBAC-E-'||left(v_suffix,12),2,2099,'2099-02-01','2099-02-28','2099-02-28','rbac-payroll-'||v_suffix,'Payroll Test');
  INSERT INTO payroll_entries(period_id,employee_id,basic_salary,gross_pay,pensionable_salary,net_pay)
  VALUES(v_period_escalated,v_employee_a,1000,1000,1000,900),(v_period_escalated,v_employee_b,1200,1200,1200,1100);

  PERFORM payroll_transition_notify_secure(v_period_escalated,'submit','rbac-payroll-'||v_suffix,NULL,NULL,NULL);
  PERFORM payroll_transition_notify_secure(v_period_escalated,'hod_verify','rbac-hod-a-'||v_suffix,'Department A verified',NULL,NULL);
  PERFORM payroll_transition_notify_secure(v_period_escalated,'hod_verify','rbac-hod-b-'||v_suffix,'Department B verified',NULL,NULL);
  v_status:=payroll_transition_notify_secure(v_period_escalated,'gm_approve','rbac-gm-'||v_suffix,'Escalated payroll reviewed',NULL,NULL);
  IF v_status<>'Awaiting CEO Approval' THEN RAISE EXCEPTION 'Configured CEO escalation failed'; END IF;
  v_status:=payroll_transition_notify_secure(v_period_escalated,'return','rbac-ceo-'||v_suffix,'Correction required',NULL,NULL);
  IF v_status<>'Reopened' THEN RAISE EXCEPTION 'CEO return failed'; END IF;
  SELECT count(*) INTO v_count FROM payroll_entries WHERE period_id=v_period_escalated AND hod_verified;
  IF v_count<>0 THEN RAISE EXCEPTION 'Return did not reset department verification'; END IF;

  PERFORM payroll_transition_notify_secure(v_period_escalated,'submit','rbac-payroll-'||v_suffix,'Corrected',NULL,NULL);
  PERFORM payroll_transition_notify_secure(v_period_escalated,'hod_verify','rbac-hod-a-'||v_suffix,'Department A reverified',NULL,NULL);
  PERFORM payroll_transition_notify_secure(v_period_escalated,'hod_verify','rbac-hod-b-'||v_suffix,'Department B reverified',NULL,NULL);
  PERFORM payroll_transition_notify_secure(v_period_escalated,'gm_approve','rbac-gm-'||v_suffix,'Correction accepted',NULL,NULL);
  v_status:=payroll_transition_notify_secure(v_period_escalated,'ceo_approve','rbac-ceo-'||v_suffix,'Escalation approved',NULL,NULL);
  IF v_status<>'Approved' THEN RAISE EXCEPTION 'CEO approval failed'; END IF;

  UPDATE user_profiles SET role='Payment Officer' WHERE id=v_payroll_profile;
  BEGIN
    PERFORM payroll_transition_notify_secure(v_period_escalated,'record_payment','rbac-payroll-'||v_suffix,'Maker-checker test','RBAC-MAKER-'||v_suffix,2000);
    RAISE EXCEPTION 'Preparer payment was not rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='Preparer payment was not rejected' OR SQLERRM NOT LIKE '%prepared%' THEN RAISE; END IF;
  END;
  UPDATE user_profiles SET role='Payroll Officer' WHERE id=v_payroll_profile;

  UPDATE user_profiles SET role='Payment Officer' WHERE id=v_ceo_profile;
  BEGIN
    PERFORM payroll_transition_notify_secure(v_period_escalated,'record_payment','rbac-ceo-'||v_suffix,'Approver separation test','RBAC-APPROVER-'||v_suffix,2000);
    RAISE EXCEPTION 'Approver payment was not rejected';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='Approver payment was not rejected' OR SQLERRM NOT LIKE '%approver%' THEN RAISE; END IF;
  END;
  UPDATE user_profiles SET role='CEO' WHERE id=v_ceo_profile;

  v_status:=payroll_transition_notify_secure(v_period_escalated,'record_payment','rbac-payment-'||v_suffix,'Reconciled','RBAC-PAY-2-'||v_suffix,2000);
  IF v_status<>'Locked' THEN RAISE EXCEPTION 'Escalated payroll payment failed'; END IF;

  SELECT count(*) INTO v_count FROM payroll_entries pe JOIN payroll_periods p ON p.id=pe.period_id
  WHERE pe.employee_id=v_employee_a AND p.locked_at IS NOT NULL;
  IF v_count<2 THEN RAISE EXCEPTION 'Employee self-service has no locked payslips'; END IF;

  RAISE NOTICE 'Role workflow test passed: %',v_suffix;
END;
$$;
