"use server";

import { getAuth } from "@/lib/auth/server";
import { deliverApprovalEmails } from "@/lib/approval-notifications";
import { db } from "@/lib/db";
import { identity, isRetiredDemoIdentity, requireRoles, ROLES } from "@/lib/security";
import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const text = z.string().trim().min(1).max(180);
const roleSchema = z.enum(ROLES);
const employmentStatusSchema = z.enum(["Active", "Suspended", "On Leave", "Terminated", "Resigned", "Retired", "Deceased"]);
const optionalUuid = z.preprocess((value) => value === "" || value == null ? null : value, z.uuid().nullable());

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function deliverApprovalEmailsSafely(periodId: string) {
  try {
    const delivery = await deliverApprovalEmails(periodId);
    if (delivery.failed>0) console.error("[notifications] approval email delivery failed", { periodId, failed: delivery.failed });
  } catch (error) {
    console.error("[notifications] approval email queue failed", { periodId, message: error instanceof Error ? error.message : "Unknown notification error" });
  }
}

export async function signInAction(_state: { error: string } | null, formData: FormData) {
  const parsed = z.object({ email: z.email(), password: z.string().min(8) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a valid email address and password." };
  if (isRetiredDemoIdentity(parsed.data.email)) return { error: "This demonstration account has been retired." };
  const { error } = await getAuth().signIn.email(parsed.data);
  if (error) return { error: "Sign-in failed. Check your credentials." };
  redirect("/dashboard");
}

export async function signUpAction(_state: { error: string } | null, formData: FormData) {
  const parsed = z.object({ name: text, email: z.email(), password: z.string().min(12).max(128) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Use a valid email and a password of at least 12 characters." };
  if (isRetiredDemoIdentity(parsed.data.email)) return { error: "This demonstration account has been retired." };
  const { error } = await getAuth().signUp.email(parsed.data);
  if (error) return { error: error.message || "Account creation failed." };
  redirect("/setup");
}

export async function signOutAction() {
  await getAuth().signOut();
  redirect("/auth/sign-in");
}

export async function bootstrapAdmin(formData: FormData) {
  const { user, profile } = await identity(false);
  if (profile) redirect("/dashboard");
  const supplied = String(formData.get("token") || "");
  const expected = process.env.BOOTSTRAP_ADMIN_TOKEN || "";
  if (!expected || !safeEqual(supplied, expected)) redirect("/setup?error=Invalid+setup+token");
  const sql = db();
  const count = await sql`SELECT count(*)::int AS count FROM user_profiles WHERE active=true` as { count: number }[];
  if (count[0].count > 0) redirect("/setup?error=Initial+administrator+already+exists");
  await sql`WITH created AS (
    INSERT INTO user_profiles(auth_user_id,email,full_name,role)
    VALUES(${user.id},${user.email!},${user.name || "System Administrator"},'System Administrator') RETURNING id
  ) INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description)
    SELECT 'BOOTSTRAP_ADMIN','user_profile',id::text,${user.id},${user.name || "System Administrator"},'System Administrator','Initial administrator activated' FROM created`;
  redirect("/dashboard");
}

export async function inviteUser(formData: FormData) {
  const { user, profile } = await requireRoles("System Administrator");
  const parsed = z.object({ email: z.email(), fullName: text, role: roleSchema, departmentId: optionalUuid, employeeId: optionalUuid }).safeParse({
    email: formData.get("email"), fullName: formData.get("fullName"), role: formData.get("role"),
    departmentId: formData.get("departmentId"), employeeId: formData.get("employeeId")
  });
  if (!parsed.success) redirect("/settings?error=Enter+a+valid+name%2C+email+and+role");
  if (isRetiredDemoIdentity(parsed.data.email)) redirect("/settings?error=The+retired+demo+account+cannot+be+invited");
  if (parsed.data.email.toLowerCase()===profile.email.toLowerCase() && parsed.data.role!==profile.role) redirect("/settings?error=You+cannot+change+your+own+administrator+role");
  if (parsed.data.role === "Head of Department" && !parsed.data.departmentId) redirect("/settings?error=Select+the+department+assigned+to+this+HOD");
  if (parsed.data.role === "Employee" && !parsed.data.employeeId) redirect("/settings?error=Link+the+employee+account+to+an+employee+record");
  const departmentId = parsed.data.role === "Head of Department" ? parsed.data.departmentId : null;
  const employeeId = parsed.data.role === "Employee" ? parsed.data.employeeId : null;
  const sql = db();
  try {
    await sql`WITH previous AS MATERIALIZED (
      SELECT id,role,active,department_id,employee_id FROM user_profiles WHERE lower(email)=lower(${parsed.data.email})
    ), invited AS (
      INSERT INTO user_profiles(email,full_name,role,department_id,employee_id)
      VALUES(${parsed.data.email.toLowerCase()},${parsed.data.fullName},${parsed.data.role},${departmentId},${employeeId})
      ON CONFLICT(email) DO UPDATE SET full_name=excluded.full_name,role=excluded.role,department_id=excluded.department_id,
        employee_id=excluded.employee_id,active=true,updated_at=now() RETURNING id
    ) INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description,metadata)
      SELECT CASE WHEN EXISTS(SELECT 1 FROM previous) THEN 'USER_ACCESS_UPDATED' ELSE 'USER_INVITED' END,
        'user_profile',id::text,${user.id},${profile.full_name},${profile.role},'User access granted or updated',
        jsonb_build_object('email',${parsed.data.email}::text,'previous_role',(SELECT role FROM previous),
          'new_role',${parsed.data.role}::text,'previous_active',(SELECT active FROM previous),
          'department_id',${departmentId}::uuid,'employee_id',${employeeId}::uuid)
      FROM invited`;
  } catch (error) {
    console.error("[admin] invite user failed", { message: error instanceof Error ? error.message : "Unknown database error" });
    redirect("/settings?error=User+access+could+not+be+saved");
  }
  revalidatePath("/settings");
  redirect("/settings?success=User+access+granted");
}

export async function updateUserAccess(formData: FormData) {
  const { user, profile } = await requireRoles("System Administrator");
  const parsed = z.object({ profileId: z.uuid(), action: z.enum(["deactivate","reactivate"]), confirmation: z.email() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/settings?error=Confirm+the+user+email+before+changing+access");
  if (parsed.data.profileId === profile.id) redirect("/settings?error=You+cannot+change+your+own+active+access");
  type AccessResult = { found:boolean;confirmed:boolean;changed:number;last_admin:boolean };
  const rows = await db()`WITH target AS MATERIALIZED (
      SELECT id,email,role,active FROM user_profiles WHERE id=${parsed.data.profileId}
    ), eligibility AS (
      SELECT t.*,lower(t.email)=lower(${parsed.data.confirmation}) confirmed,
        (t.role='System Administrator' AND t.active=true AND ${parsed.data.action}='deactivate' AND
          (SELECT count(*) FROM user_profiles WHERE role='System Administrator' AND active=true)<=1) last_admin
      FROM target t
    ), changed AS (
      UPDATE user_profiles u SET active=(${parsed.data.action}='reactivate'),updated_at=now()
      FROM eligibility e WHERE u.id=e.id AND e.confirmed AND NOT e.last_admin AND u.active<>(${parsed.data.action}='reactivate')
      RETURNING u.id,u.email,u.role,u.active
    ), audited AS (
      INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description,metadata)
      SELECT CASE WHEN active THEN 'USER_REACTIVATED' ELSE 'USER_DEACTIVATED' END,'user_profile',id::text,
        ${user.id},${profile.full_name},${profile.role},CASE WHEN active THEN 'User access reactivated' ELSE 'User access deactivated' END,
        jsonb_build_object('email',email,'role',role,'active',active) FROM changed RETURNING id
    ) SELECT EXISTS(SELECT 1 FROM target) found,COALESCE((SELECT confirmed FROM eligibility),false) confirmed,
      (SELECT count(*)::int FROM changed) changed,COALESCE((SELECT last_admin FROM eligibility),false) last_admin` as AccessResult[];
  const result=rows[0];
  if (!result.found) redirect("/settings?error=User+profile+was+not+found");
  if (!result.confirmed) redirect("/settings?error=The+confirmation+email+does+not+match");
  if (result.last_admin) redirect("/settings?error=The+last+active+System+Administrator+cannot+be+deactivated");
  if (result.changed===0) redirect("/settings?error=User+access+already+has+that+status");
  revalidatePath("/settings");
  redirect(`/settings?success=${parsed.data.action==="deactivate"?"User+access+deactivated":"User+access+reactivated"}`);
}

export async function createEmployee(formData: FormData) {
  const { user, profile } = await requireRoles("HR / Administrator", "System Administrator");
  const parsed = z.object({
    employeeNo: z.string().trim().regex(/^[A-Z0-9-]{3,30}$/), fullName: text, departmentId: z.uuid(), jobTitle: text,
    employmentType: z.enum(["Permanent","Fixed Term","Contract","Casual","Temporary","Apprentice"]),
    dateJoined: z.iso.date(), basicSalary: z.coerce.number().min(0).max(10000000), bankName: z.string().trim().max(120).optional(),
    accountName: z.string().trim().max(180).optional(), accountNumber: z.string().trim().max(80).optional(), ssnitNumber: z.string().trim().max(80).optional()
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/employees?error=Check+the+required+employee+fields+and+use+an+employee+number+such+as+CPL-007");
  const sql = db();
  try {
    await sql`WITH employee AS (
      INSERT INTO employees(employee_no,full_name,department_id,job_title,employment_type,date_joined,basic_salary,bank_name,account_name,account_number,ssnit_number,created_by)
      VALUES(${parsed.data.employeeNo},${parsed.data.fullName},${parsed.data.departmentId},${parsed.data.jobTitle},${parsed.data.employmentType},${parsed.data.dateJoined},${parsed.data.basicSalary},${parsed.data.bankName || null},${parsed.data.accountName || null},${parsed.data.accountNumber || null},${parsed.data.ssnitNumber || null},${user.id}) RETURNING id
    ) INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description,metadata)
      SELECT 'EMPLOYEE_CREATED','employee',id::text,${user.id},${profile.full_name},${profile.role},'Employee record created',jsonb_build_object('employee_no',${parsed.data.employeeNo}::text) FROM employee`;
  } catch (error) {
    console.error("[admin] create employee failed", { message: error instanceof Error ? error.message : "Unknown database error" });
    redirect("/employees?error=Employee+record+could+not+be+saved.+Check+that+the+employee+number+is+unique");
  }
  revalidatePath("/employees"); revalidatePath("/dashboard");
  redirect("/employees?success=Employee+record+created");
}

export async function updateEmployee(formData: FormData) {
  const { user, profile } = await requireRoles("HR / Administrator", "System Administrator");
  const parsed = z.object({
    employeeId:z.uuid(), employeeNo:z.string().trim().regex(/^[A-Z0-9-]{3,30}$/), fullName:text,
    departmentId:z.uuid(), jobTitle:text, employmentType:z.enum(["Permanent","Fixed Term","Contract","Casual","Temporary","Apprentice"]),
    dateJoined:z.iso.date(), basicSalary:z.coerce.number().min(0).max(10000000), bankName:z.string().trim().max(120).optional(),
    accountName:z.string().trim().max(180).optional(), accountNumber:z.string().trim().max(80).optional(),
    ssnitNumber:z.string().trim().max(80).optional(), taxId:z.string().trim().max(80).optional(),
    effectiveDate:z.iso.date(), reason:z.string().trim().min(5).max(500), confirmation:z.string().trim().max(30),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/employees?error=Check+the+employee+details%2C+effective+date+and+reason");
  if (parsed.data.confirmation.toUpperCase()!==parsed.data.employeeNo) redirect("/employees?error=The+confirmation+employee+number+does+not+match");
  type UpdateResult={found:boolean;valid_date:boolean;changed:number};
  const rows=await db()`WITH target AS MATERIALIZED (
      SELECT * FROM employees WHERE id=${parsed.data.employeeId} AND employee_no=${parsed.data.employeeNo}
    ), changed AS (
      UPDATE employees e SET full_name=${parsed.data.fullName},department_id=${parsed.data.departmentId},job_title=${parsed.data.jobTitle},
        employment_type=${parsed.data.employmentType},date_joined=${parsed.data.dateJoined},basic_salary=${parsed.data.basicSalary},
        bank_name=${parsed.data.bankName||null},account_name=${parsed.data.accountName||null},account_number=${parsed.data.accountNumber||null},
        ssnit_number=${parsed.data.ssnitNumber||null},tax_id=${parsed.data.taxId||null},updated_at=now()
      FROM target t WHERE e.id=t.id AND ${parsed.data.effectiveDate}::date>=${parsed.data.dateJoined}::date
      RETURNING e.*
    ), history AS (
      INSERT INTO employee_change_history(employee_id,changed_by_auth_id,changed_by_name,changed_by_role,reason,effective_date,before_data,after_data)
      SELECT c.id,${user.id},${profile.full_name},${profile.role},${parsed.data.reason},${parsed.data.effectiveDate},to_jsonb(t),to_jsonb(c)
      FROM changed c JOIN target t ON t.id=c.id RETURNING id
    ), audited AS (
      INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description,metadata)
      SELECT 'EMPLOYEE_UPDATED','employee',c.id::text,${user.id},${profile.full_name},${profile.role},
        'Employee master data updated: '||${parsed.data.reason}::text,
        jsonb_build_object('employee_no',c.employee_no,'effective_date',${parsed.data.effectiveDate}::text,'history_id',(SELECT id FROM history LIMIT 1))
      FROM changed c RETURNING id
    ) SELECT EXISTS(SELECT 1 FROM target) found,
      COALESCE((SELECT ${parsed.data.effectiveDate}::date>=date_joined FROM target),false) valid_date,
      (SELECT count(*)::int FROM changed) changed` as UpdateResult[];
  const result=rows[0];
  if (!result.found) redirect("/employees?error=Employee+record+was+not+found");
  if (!result.valid_date) redirect("/employees?error=The+effective+date+cannot+be+before+the+joining+date");
  if (result.changed===0) redirect("/employees?error=Employee+details+could+not+be+updated");
  revalidatePath("/employees");revalidatePath("/dashboard");revalidatePath("/payroll");
  redirect("/employees?success=Employee+details+updated+and+audited");
}

export async function updateEmployeeStatus(formData: FormData) {
  const { user, profile } = await requireRoles("HR / Administrator", "System Administrator");
  const parsed = z.object({
    employeeId: z.uuid(),
    employeeNo: z.string().trim().regex(/^[A-Z0-9-]{3,30}$/),
    status: employmentStatusSchema,
    reason: z.string().trim().min(5).max(500),
    confirmation: z.string().trim().max(30)
  }).safeParse({
    employeeId: formData.get("employeeId"),
    employeeNo: formData.get("employeeNo"),
    status: formData.get("status"),
    reason: formData.get("reason"),
    confirmation: formData.get("confirmation")
  });

  if (!parsed.success) redirect("/employees?error=Select+a+valid+status%2C+give+a+reason%2C+and+confirm+the+employee+number");
  if (parsed.data.confirmation.toUpperCase() !== parsed.data.employeeNo) {
    redirect("/employees?error=The+confirmation+employee+number+does+not+match");
  }

  type StatusResult = { found: boolean; current_status: string | null; changed: number; audited: number };
  let result: StatusResult;
  try {
    const rows = await db()`WITH target AS (
      SELECT id,employee_no,full_name,employment_status
      FROM employees
      WHERE id=${parsed.data.employeeId} AND employee_no=${parsed.data.employeeNo}
    ), changed AS (
      UPDATE employees e
      SET employment_status=${parsed.data.status},updated_at=now()
      FROM target t
      WHERE e.id=t.id AND e.employment_status<>${parsed.data.status}
      RETURNING e.id,e.employee_no,e.full_name,t.employment_status previous_status,e.employment_status new_status
    ), audited AS (
      INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description,metadata)
      SELECT 'EMPLOYEE_STATUS_CHANGED','employee',id::text,${user.id},${profile.full_name},${profile.role},
        'Employee '||employee_no||' status changed from '||previous_status||' to '||new_status||': '||${parsed.data.reason}::text,
        jsonb_build_object('employee_no',employee_no,'previous_status',previous_status,'new_status',new_status,'reason',${parsed.data.reason}::text)
      FROM changed
      RETURNING id
    )
    SELECT EXISTS(SELECT 1 FROM target) found,
      (SELECT employment_status FROM target) current_status,
      (SELECT count(*)::int FROM changed) changed,
      (SELECT count(*)::int FROM audited) audited` as StatusResult[];
    result = rows[0];
  } catch (error) {
    console.error("[admin] update employee status failed", { message: error instanceof Error ? error.message : "Unknown database error" });
    redirect("/employees?error=Employee+status+could+not+be+updated");
  }

  if (!result.found) redirect("/employees?error=Employee+record+was+not+found");
  if (result.changed === 0) redirect(`/employees?error=${encodeURIComponent(`Employee is already ${result.current_status}`)}`);

  revalidatePath("/employees");
  revalidatePath("/dashboard");
  revalidatePath("/payroll");
  redirect(`/employees?success=${encodeURIComponent(`Employee status updated to ${parsed.data.status}`)}`);
}

export async function createPeriod(formData: FormData) {
  const { user, profile } = await requireRoles("Payroll Officer");
  const parsed = z.object({ month: z.coerce.number().int().min(1).max(12), year: z.coerce.number().int().min(2020).max(2100), paymentDate: z.iso.date() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/payroll?error=Select+a+valid+month%2C+year+and+payment+date");
  const start = `${parsed.data.year}-${String(parsed.data.month).padStart(2,"0")}-01`;
  const end = new Date(Date.UTC(parsed.data.year, parsed.data.month, 0)).toISOString().slice(0,10);
  const code = `PAY-${parsed.data.year}-${String(parsed.data.month).padStart(2,"0")}`;
  const sql = db();
  let result:{periods:number;entries:number}|undefined;
  try {
    const rows=await sql`WITH period AS (
      INSERT INTO payroll_periods(period_code,month,year,start_date,end_date,payment_date,created_by_id,created_by_name)
      SELECT ${code},${parsed.data.month},${parsed.data.year},${start},${end},${parsed.data.paymentDate},${user.id},${profile.full_name}
      WHERE EXISTS(SELECT 1 FROM employees WHERE employment_status='Active') RETURNING id
    ), entries AS (
      INSERT INTO payroll_entries(period_id,employee_id,basic_salary,gross_pay,pensionable_salary,net_pay)
      SELECT period.id,e.id,e.basic_salary,e.basic_salary,e.basic_salary,e.basic_salary FROM period CROSS JOIN employees e WHERE e.employment_status='Active' RETURNING id
    ), audited AS (
      INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description)
      SELECT 'PERIOD_CREATED','payroll_period',id::text,${user.id},${profile.full_name},${profile.role},${`Payroll period ${code} created`} FROM period RETURNING id
    ) SELECT (SELECT count(*)::int FROM period) periods,(SELECT count(*)::int FROM entries) entries` as {periods:number;entries:number}[];
    result=rows[0];
  } catch (error) {
    console.error("[payroll] create period failed",{code,message:error instanceof Error?error.message:"Unknown database error"});
    redirect("/payroll?error=The+payroll+period+already+exists+or+could+not+be+created");
  }
  if (!result?.periods||!result.entries) redirect("/payroll?error=At+least+one+active+employee+is+required");
  revalidatePath("/payroll"); revalidatePath("/dashboard");
}

export async function updatePayrollInput(formData: FormData) {
  const { user, profile } = await requireRoles("Payroll Officer");
  const parsed = z.object({ entryId: z.uuid(), periodId: z.uuid(), allowances: z.coerce.number().min(0).max(1000000), overtime: z.coerce.number().min(0).max(1000000), bonus: z.coerce.number().min(0).max(1000000), loan: z.coerce.number().min(0).max(1000000), otherDeductions: z.coerce.number().min(0).max(1000000) }).parse(Object.fromEntries(formData));
  const rows=await db()`WITH previous AS MATERIALIZED (
      SELECT e.* FROM payroll_entries e JOIN payroll_periods p ON p.id=e.period_id
      WHERE e.id=${parsed.entryId} AND p.id=${parsed.periodId} AND p.stage=0 AND p.locked_at IS NULL
    ), changed AS (
      UPDATE payroll_entries e SET allowances=${parsed.allowances},overtime=${parsed.overtime},bonus=${parsed.bonus},loan_deduction=${parsed.loan},other_deductions=${parsed.otherDeductions},updated_at=now()
      FROM previous p WHERE e.id=p.id RETURNING e.*
    ), audited AS (
      INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description,metadata)
      SELECT 'PAYROLL_INPUT_UPDATED','payroll_entry',c.id::text,${user.id},${profile.full_name},${profile.role},'Variable payroll input updated',
        jsonb_build_object('previous',jsonb_build_object('allowances',p.allowances,'overtime',p.overtime,'bonus',p.bonus,'loan',p.loan_deduction,'other_deductions',p.other_deductions),
          'new',jsonb_build_object('allowances',c.allowances,'overtime',c.overtime,'bonus',c.bonus,'loan',c.loan_deduction,'other_deductions',c.other_deductions))
      FROM changed c JOIN previous p ON p.id=c.id RETURNING id
    ) SELECT count(*)::int changed FROM changed` as {changed:number}[];
  if ((rows[0]?.changed||0)!==1) redirect("/payroll?error=Payroll+input+could+not+be+updated+because+the+period+is+not+editable");
  revalidatePath("/payroll");
}

export async function recalculatePayroll(formData: FormData) {
  const { user, profile } = await requireRoles("Payroll Officer");
  const periodId = z.uuid().parse(formData.get("periodId"));
  const sql = db();
  const rows=await sql`WITH period AS (SELECT id,payment_date FROM payroll_periods WHERE id=${periodId} AND stage=0 AND locked_at IS NULL),
    effective_settings AS (SELECT s.* FROM statutory_settings s CROSS JOIN period p WHERE s.effective_date<=p.payment_date AND (s.end_date IS NULL OR s.end_date>=p.payment_date)),
    rates AS (SELECT MAX(rate) FILTER(WHERE setting_name='EMPLOYEE_PENSION_RATE')/100 er,MAX(rate) FILTER(WHERE setting_name='EMPLOYER_PENSION_RATE')/100 rr FROM effective_settings),
    snapshot AS (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',setting_name,'rate',rate,'lower',lower_threshold,'upper',upper_threshold,'effective_date',effective_date) ORDER BY category,lower_threshold NULLS FIRST,setting_name),'[]'::jsonb) settings FROM effective_settings),
    base AS (SELECT e.id,pe.basic_salary,pe.allowances,pe.overtime,pe.bonus,pe.other_earnings,pe.loan_deduction,pe.other_deductions,r.er,r.rr,
      pe.basic_salary+pe.allowances+pe.overtime+pe.bonus+pe.other_earnings gross FROM payroll_entries pe JOIN employees e ON e.id=pe.employee_id CROSS JOIN rates r JOIN period p ON p.id=pe.period_id WHERE r.er IS NOT NULL AND r.rr IS NOT NULL),
    taxes AS (SELECT b.*,COALESCE((SELECT SUM(GREATEST(LEAST(b.gross-(b.basic_salary*b.er),COALESCE(s.upper_threshold,b.gross-(b.basic_salary*b.er)))-s.lower_threshold,0)*(s.rate/100)) FROM effective_settings s WHERE s.category='PAYE'),0) tax FROM base b),
    changed AS (UPDATE payroll_entries pe SET gross_pay=round(t.gross,2),pensionable_salary=t.basic_salary,employee_pension=round(t.basic_salary*t.er,2),employer_pension=round(t.basic_salary*t.rr,2),paye=round(t.tax,2),net_pay=round(t.gross-(t.basic_salary*t.er)-t.tax-t.loan_deduction-t.other_deductions,2),calculation_json=jsonb_build_object('engine','progressive-paye-v2','calculated_at',now(),'settings',(SELECT settings FROM snapshot)),updated_at=now() FROM taxes t WHERE pe.id=t.id RETURNING pe.id),
    audited AS (INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description,metadata)
      SELECT 'PAYROLL_CALCULATED','payroll_period',${periodId},${user.id},${profile.full_name},${profile.role},'Payroll recalculated using effective statutory settings',jsonb_build_object('entries',(SELECT count(*) FROM changed))
      WHERE EXISTS(SELECT 1 FROM changed) RETURNING id)
    SELECT (SELECT count(*)::int FROM changed) changed,
      ((SELECT er IS NOT NULL AND rr IS NOT NULL FROM rates) AND EXISTS(SELECT 1 FROM effective_settings WHERE category='PAYE')) has_rates` as {changed:number;has_rates:boolean}[];
  if (!rows[0]?.has_rates) redirect("/payroll?error=Applicable+PAYE+and+pension+settings+are+incomplete");
  if (!rows[0]?.changed) redirect("/payroll?error=Payroll+could+not+be+recalculated+because+the+period+is+not+editable");
  revalidatePath("/payroll"); revalidatePath("/dashboard"); revalidatePath("/approvals");
}

export async function transitionPayroll(formData: FormData) {
  const { user } = await requireRoles("Payroll Officer","Head of Department","General Manager","CEO");
  const parsed = z.object({ periodId: z.uuid(), action: z.enum(["submit","hod_verify","gm_approve","ceo_approve","return"]), comment: z.string().trim().max(500).optional() }).parse(Object.fromEntries(formData));
  if (["hod_verify","gm_approve","ceo_approve","return"].includes(parsed.action) && !parsed.comment) redirect("/approvals?error=A+decision+comment+is+required");
  try {
    await db()`SELECT payroll_transition_notify_secure(${parsed.periodId},${parsed.action},${user.id},${parsed.comment || null},NULL,NULL)`;
  } catch (error) {
    console.error("[approval] transition rejected",{periodId:parsed.periodId,action:parsed.action,message:error instanceof Error?error.message:"Unknown workflow error"});
    redirect(`/approvals?error=${encodeURIComponent(approvalError(error))}`);
  }
  await deliverApprovalEmailsSafely(parsed.periodId);
  revalidatePath("/approvals"); revalidatePath("/dashboard"); revalidatePath("/payroll"); revalidatePath("/notifications");
}

export async function recordPayment(formData: FormData) {
  const { user } = await requireRoles("Payment Officer");
  const parsed = z.object({ periodId: z.uuid(), paymentReference: z.string().trim().min(4).max(120), paymentAmount:z.coerce.number().positive().max(1000000000), comment: z.string().trim().max(500).optional() }).parse(Object.fromEntries(formData));
  try {
    await db()`SELECT payroll_transition_notify_secure(${parsed.periodId},'record_payment',${user.id},${parsed.comment || null},${parsed.paymentReference},${parsed.paymentAmount})`;
  } catch (error) {
    console.error("[payment] reconciliation rejected",{periodId:parsed.periodId,message:error instanceof Error?error.message:"Unknown payment error"});
    redirect(`/approvals?error=${encodeURIComponent(approvalError(error))}`);
  }
  await deliverApprovalEmailsSafely(parsed.periodId);
  revalidatePath("/approvals"); revalidatePath("/dashboard"); revalidatePath("/payroll"); revalidatePath("/notifications");
}

function approvalError(error: unknown) {
  const message=error instanceof Error?error.message:"";
  if (message.includes("bank or statutory")) return "Complete all employee bank and SSNIT information before submission";
  if (message.includes("statutory settings")) return "Accounts must confirm the applicable statutory settings before submission";
  if (message.includes("negative net pay")) return "Resolve negative net pay before submission";
  if (message.includes("must equal")) return "The payment amount must equal the approved net payroll";
  if (message.includes("prepared")||message.includes("approver")) return "Separation of duties prevents this user from completing the action";
  if (message.includes("duplicate key")||message.includes("unique constraint")) return "This payment reference or payroll payment has already been recorded";
  if (message.includes("decision comment")) return "A decision comment is required";
  return "The workflow changed or the action is not permitted. Refresh and try again";
}

export async function markAllNotificationsRead() {
  const { profile } = await identity();
  await db()`UPDATE approval_notifications SET read_at=now()
    WHERE recipient_profile_id=${profile!.id} AND read_at IS NULL`;
  revalidatePath("/notifications");
}

export async function retryApprovalEmails() {
  await requireRoles("System Administrator");
  const delivery = await deliverApprovalEmails();
  revalidatePath("/notifications");
  revalidatePath("/settings");
  if (!delivery.configured) redirect("/settings?error=Approval+email+is+not+configured");
  if (delivery.failed>0) redirect(`/settings?error=${encodeURIComponent(`${delivery.failed} approval email(s) could not be delivered`)}`);
  redirect(`/settings?success=${encodeURIComponent(`${delivery.sent} queued approval email(s) delivered`)}`);
}

export async function updateSetting(formData: FormData) {
  const { user, profile } = await requireRoles("System Administrator");
  const parsed = z.object({ settingName: z.string().trim().regex(/^[A-Z0-9_]+$/), rate: z.coerce.number().min(0).max(100000000), source: text, effectiveDate:z.iso.date() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/settings?error=Enter+a+valid+rate%2C+effective+date+and+source+reference");
  const sql = db();
  let created = 0;
  try {
    const rows = await sql`WITH previous AS MATERIALIZED (
      SELECT * FROM statutory_settings WHERE setting_name=${parsed.data.settingName} AND active=true ORDER BY effective_date DESC LIMIT 1
    ), closed AS (
      UPDATE statutory_settings s SET active=false,end_date=${parsed.data.effectiveDate}::date-1,updated_at=now(),updated_by=${user.id}
      FROM previous p WHERE s.id=p.id AND ${parsed.data.effectiveDate}::date>p.effective_date RETURNING s.id
    ), created AS (
      INSERT INTO statutory_settings(setting_name,category,rate,lower_threshold,upper_threshold,effective_date,source_reference,active,updated_by)
      SELECT ${parsed.data.settingName},COALESCE((SELECT category FROM previous),'Approval'),${parsed.data.rate},
        (SELECT lower_threshold FROM previous),(SELECT upper_threshold FROM previous),${parsed.data.effectiveDate},${parsed.data.source},true,${user.id}
      WHERE NOT EXISTS(SELECT 1 FROM previous) OR EXISTS(SELECT 1 FROM closed)
      RETURNING id,setting_name
    ) INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description,metadata)
      SELECT 'SETTING_VERSION_CREATED','statutory_setting',setting_name,${user.id},${profile.full_name},${profile.role},
        'Effective-dated statutory setting version created',jsonb_build_object('previous_rate',(SELECT rate FROM previous),
          'new_rate',${parsed.data.rate}::numeric,'effective_date',${parsed.data.effectiveDate}::text,'source',${parsed.data.source}::text)
      FROM created RETURNING id`;
    created=rows.length;
  } catch (error) {
    console.error("[admin] update setting failed", { message: error instanceof Error ? error.message : "Unknown database error" });
    redirect("/settings?error=The+setting+could+not+be+saved");
  }
  if (created!==1) redirect("/settings?error=The+new+effective+date+must+be+after+the+current+version");
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  redirect("/settings?success=Effective-dated+setting+version+created");
}

export async function confirmStatutoryRates(formData: FormData) {
  const { user, profile } = await requireRoles("Payroll Officer");
  const parsed = z.object({
    reference: text,
    attestation: z.literal("confirmed"),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/settings?error=Enter+a+verification+reference+and+confirm+the+Accounts+attestation");

  try {
    await db()`WITH confirmed AS (
      UPDATE statutory_settings
      SET confirmed_by=${user.id},confirmed_by_name=${profile.full_name},confirmed_at=now(),confirmation_note=${parsed.data.reference},updated_at=now()
      WHERE active=true AND category IN ('PAYE','Pension') AND confirmed_at IS NULL
      RETURNING id
    ), summary AS (
      SELECT count(*)::int AS confirmed_count FROM confirmed
    )
    INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description,metadata)
      SELECT 'STATUTORY_RATES_CONFIRMED','statutory_settings','active-statutory-rates',${user.id},${profile.full_name},${profile.role},
        'Active PAYE and pension settings confirmed by Accounts',
        jsonb_build_object('confirmed_count',confirmed_count,'reference',${parsed.data.reference}::text)
      FROM summary WHERE confirmed_count>0`;
  } catch (error) {
    console.error("[accounts] statutory confirmation failed", { message: error instanceof Error ? error.message : "Unknown database error" });
    redirect("/settings?error=Statutory+rates+could+not+be+confirmed");
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  redirect("/settings?success=Current+statutory+rates+confirmed+by+Accounts");
}
