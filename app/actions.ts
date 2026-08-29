"use server";

import { getAuth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { identity, isRetiredDemoIdentity, requireRoles, ROLES } from "@/lib/security";
import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const text = z.string().trim().min(1).max(180);
const roleSchema = z.enum(ROLES);
const employmentStatusSchema = z.enum(["Active", "Suspended", "On Leave", "Terminated", "Resigned", "Retired", "Deceased"]);

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
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
  const parsed = z.object({ email: z.email(), fullName: text, role: roleSchema }).safeParse({
    email: formData.get("email"), fullName: formData.get("fullName"), role: formData.get("role")
  });
  if (!parsed.success) redirect("/settings?error=Enter+a+valid+name%2C+email+and+role");
  if (isRetiredDemoIdentity(parsed.data.email)) redirect("/settings?error=The+retired+demo+account+cannot+be+invited");
  const sql = db();
  try {
    await sql`WITH invited AS (
      INSERT INTO user_profiles(email,full_name,role) VALUES(${parsed.data.email.toLowerCase()},${parsed.data.fullName},${parsed.data.role})
      ON CONFLICT(email) DO UPDATE SET full_name=excluded.full_name,role=excluded.role,active=true,updated_at=now() RETURNING id
    ) INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description,metadata)
      SELECT 'USER_INVITED','user_profile',id::text,${user.id},${profile.full_name},${profile.role},'User access granted',jsonb_build_object('email',${parsed.data.email}::text,'role',${parsed.data.role}::text) FROM invited`;
  } catch (error) {
    console.error("[admin] invite user failed", { message: error instanceof Error ? error.message : "Unknown database error" });
    redirect("/settings?error=User+access+could+not+be+saved");
  }
  revalidatePath("/settings");
  redirect("/settings?success=User+access+granted");
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
  const parsed = z.object({ month: z.coerce.number().int().min(1).max(12), year: z.coerce.number().int().min(2020).max(2100), paymentDate: z.iso.date() }).parse(Object.fromEntries(formData));
  const start = `${parsed.year}-${String(parsed.month).padStart(2,"0")}-01`;
  const end = new Date(Date.UTC(parsed.year, parsed.month, 0)).toISOString().slice(0,10);
  const code = `PAY-${parsed.year}-${String(parsed.month).padStart(2,"0")}`;
  const sql = db();
  await sql`WITH period AS (
    INSERT INTO payroll_periods(period_code,month,year,start_date,end_date,payment_date,created_by_id,created_by_name)
    VALUES(${code},${parsed.month},${parsed.year},${start},${end},${parsed.paymentDate},${user.id},${profile.full_name}) RETURNING id
  ), entries AS (
    INSERT INTO payroll_entries(period_id,employee_id,basic_salary,gross_pay,pensionable_salary,net_pay)
    SELECT period.id,e.id,e.basic_salary,e.basic_salary,e.basic_salary,e.basic_salary FROM period CROSS JOIN employees e WHERE e.employment_status='Active'
  ) INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description)
    SELECT 'PERIOD_CREATED','payroll_period',id::text,${user.id},${profile.full_name},${profile.role},${`Payroll period ${code} created`} FROM period`;
  revalidatePath("/payroll"); revalidatePath("/dashboard");
}

export async function updatePayrollInput(formData: FormData) {
  const { user, profile } = await requireRoles("Payroll Officer");
  const parsed = z.object({ entryId: z.uuid(), periodId: z.uuid(), allowances: z.coerce.number().min(0).max(1000000), overtime: z.coerce.number().min(0).max(1000000), bonus: z.coerce.number().min(0).max(1000000), loan: z.coerce.number().min(0).max(1000000), otherDeductions: z.coerce.number().min(0).max(1000000) }).parse(Object.fromEntries(formData));
  const sql = db();
  await sql`UPDATE payroll_entries e SET allowances=${parsed.allowances},overtime=${parsed.overtime},bonus=${parsed.bonus},loan_deduction=${parsed.loan},other_deductions=${parsed.otherDeductions},updated_at=now()
    FROM payroll_periods p WHERE e.id=${parsed.entryId} AND e.period_id=p.id AND p.id=${parsed.periodId} AND p.stage=0 AND p.locked_at IS NULL`;
  await sql`INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description)
    VALUES('PAYROLL_INPUT_UPDATED','payroll_entry',${parsed.entryId},${user.id},${profile.full_name},${profile.role},'Variable payroll input updated')`;
  revalidatePath("/payroll");
}

export async function recalculatePayroll(formData: FormData) {
  const { user, profile } = await requireRoles("Payroll Officer");
  const periodId = z.uuid().parse(formData.get("periodId"));
  const sql = db();
  await sql`WITH period AS (SELECT id FROM payroll_periods WHERE id=${periodId} AND stage=0 AND locked_at IS NULL),
    rates AS (SELECT MAX(rate) FILTER(WHERE setting_name='EMPLOYEE_PENSION_RATE')/100 er,MAX(rate) FILTER(WHERE setting_name='EMPLOYER_PENSION_RATE')/100 rr FROM statutory_settings WHERE active),
    base AS (SELECT e.id,pe.basic_salary,pe.allowances,pe.overtime,pe.bonus,pe.other_earnings,pe.loan_deduction,pe.other_deductions,r.er,r.rr,
      pe.basic_salary+pe.allowances+pe.overtime+pe.bonus+pe.other_earnings gross FROM payroll_entries pe JOIN employees e ON e.id=pe.employee_id CROSS JOIN rates r JOIN period p ON p.id=pe.period_id),
    taxes AS (SELECT b.*,COALESCE((SELECT SUM(GREATEST(LEAST(b.gross-(b.basic_salary*b.er),COALESCE(s.upper_threshold,b.gross-(b.basic_salary*b.er)))-s.lower_threshold,0)*(s.rate/100)) FROM statutory_settings s WHERE s.category='PAYE' AND s.active),0) tax FROM base b)
    UPDATE payroll_entries pe SET gross_pay=round(t.gross,2),pensionable_salary=t.basic_salary,employee_pension=round(t.basic_salary*t.er,2),employer_pension=round(t.basic_salary*t.rr,2),paye=round(t.tax,2),net_pay=round(t.gross-(t.basic_salary*t.er)-t.tax-t.loan_deduction-t.other_deductions,2),calculation_json=jsonb_build_object('engine','progressive-paye-v2','calculated_at',now()),updated_at=now() FROM taxes t WHERE pe.id=t.id`;
  await sql`INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description)
    VALUES('PAYROLL_CALCULATED','payroll_period',${periodId},${user.id},${profile.full_name},${profile.role},'Payroll recalculated using effective statutory settings')`;
  revalidatePath("/payroll"); revalidatePath("/dashboard"); revalidatePath("/approvals");
}

export async function transitionPayroll(formData: FormData) {
  const { user, profile } = await requireRoles("Payroll Officer","Head of Department","General Manager","CEO");
  const parsed = z.object({ periodId: z.uuid(), action: z.enum(["submit","hod_verify","gm_approve","ceo_approve","return"]), comment: z.string().trim().max(500).optional() }).parse(Object.fromEntries(formData));
  await db()`SELECT payroll_transition(${parsed.periodId},${parsed.action},${user.id},${profile.full_name},${profile.role},${parsed.comment || null},NULL)`;
  revalidatePath("/approvals"); revalidatePath("/dashboard"); revalidatePath("/payroll");
}

export async function recordPayment(formData: FormData) {
  const { user, profile } = await requireRoles("Payment Officer");
  const parsed = z.object({ periodId: z.uuid(), paymentReference: z.string().trim().min(4).max(120), comment: z.string().trim().max(500).optional() }).parse(Object.fromEntries(formData));
  await db()`SELECT payroll_transition(${parsed.periodId},'record_payment',${user.id},${profile.full_name},${profile.role},${parsed.comment || null},${parsed.paymentReference})`;
  revalidatePath("/approvals"); revalidatePath("/dashboard"); revalidatePath("/payroll");
}

export async function updateSetting(formData: FormData) {
  const { user, profile } = await requireRoles("System Administrator");
  const parsed = z.object({ settingName: z.string().trim().regex(/^[A-Z0-9_]+$/), rate: z.coerce.number().min(0).max(100000000), source: text }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/settings?error=Enter+a+valid+rate+and+retain+the+source+reference");
  const sql = db();
  try {
    await sql`WITH changed AS (
      UPDATE statutory_settings
      SET rate=${parsed.data.rate},source_reference=${parsed.data.source},updated_by=${user.id},updated_at=now()
      WHERE setting_name=${parsed.data.settingName} AND active=true
      RETURNING setting_name
    ) INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description,metadata)
      SELECT 'SETTING_UPDATED','statutory_setting',setting_name,${user.id},${profile.full_name},${profile.role},'Statutory setting updated',jsonb_build_object('new_rate',${parsed.data.rate}::numeric) FROM changed`;
  } catch (error) {
    console.error("[admin] update setting failed", { message: error instanceof Error ? error.message : "Unknown database error" });
    redirect("/settings?error=The+setting+could+not+be+saved");
  }
  revalidatePath("/settings");
  redirect("/settings?success=Setting+updated");
}
