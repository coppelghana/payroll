"use server";

import { auth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { identity, requireRoles, ROLES } from "@/lib/security";
import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const text = z.string().trim().min(1).max(180);
const roleSchema = z.enum(ROLES);

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function signInAction(_state: { error: string } | null, formData: FormData) {
  const parsed = z.object({ email: z.email(), password: z.string().min(8) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a valid email address and password." };
  const { error } = await auth.signIn.email(parsed.data);
  if (error) return { error: "Sign-in failed. Check your credentials." };
  redirect("/dashboard");
}

export async function signUpAction(_state: { error: string } | null, formData: FormData) {
  const parsed = z.object({ name: text, email: z.email(), password: z.string().min(12).max(128) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Use a valid email and a password of at least 12 characters." };
  const { error } = await auth.signUp.email(parsed.data);
  if (error) return { error: error.message || "Account creation failed." };
  redirect("/setup");
}

export async function signOutAction() {
  await auth.signOut();
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
  const parsed = z.object({ email: z.email(), fullName: text, role: roleSchema }).parse({
    email: formData.get("email"), fullName: formData.get("fullName"), role: formData.get("role")
  });
  const sql = db();
  await sql`WITH invited AS (
    INSERT INTO user_profiles(email,full_name,role) VALUES(${parsed.email.toLowerCase()},${parsed.fullName},${parsed.role})
    ON CONFLICT(email) DO UPDATE SET full_name=excluded.full_name,role=excluded.role,active=true,updated_at=now() RETURNING id
  ) INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description,metadata)
    SELECT 'USER_INVITED','user_profile',id::text,${user.id},${profile.full_name},${profile.role},'User access granted',jsonb_build_object('email',${parsed.email},'role',${parsed.role}) FROM invited`;
  revalidatePath("/settings");
}

export async function createEmployee(formData: FormData) {
  const { user, profile } = await requireRoles("HR / Administrator", "System Administrator");
  const parsed = z.object({
    employeeNo: z.string().trim().regex(/^[A-Z0-9-]{3,30}$/), fullName: text, departmentId: z.uuid(), jobTitle: text,
    employmentType: z.enum(["Permanent","Fixed Term","Contract","Casual","Temporary","Apprentice"]),
    dateJoined: z.iso.date(), basicSalary: z.coerce.number().min(0).max(10000000), bankName: z.string().trim().max(120).optional(),
    accountName: z.string().trim().max(180).optional(), accountNumber: z.string().trim().max(80).optional(), ssnitNumber: z.string().trim().max(80).optional()
  }).parse(Object.fromEntries(formData));
  const sql = db();
  await sql`WITH employee AS (
    INSERT INTO employees(employee_no,full_name,department_id,job_title,employment_type,date_joined,basic_salary,bank_name,account_name,account_number,ssnit_number,created_by)
    VALUES(${parsed.employeeNo},${parsed.fullName},${parsed.departmentId},${parsed.jobTitle},${parsed.employmentType},${parsed.dateJoined},${parsed.basicSalary},${parsed.bankName || null},${parsed.accountName || null},${parsed.accountNumber || null},${parsed.ssnitNumber || null},${user.id}) RETURNING id
  ) INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description,metadata)
    SELECT 'EMPLOYEE_CREATED','employee',id::text,${user.id},${profile.full_name},${profile.role},'Employee record created',jsonb_build_object('employee_no',${parsed.employeeNo}) FROM employee`;
  revalidatePath("/employees"); revalidatePath("/dashboard");
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
  const parsed = z.object({ settingName: z.string().trim().regex(/^[A-Z0-9_]+$/), rate: z.coerce.number().min(0).max(100000000), source: text }).parse(Object.fromEntries(formData));
  const sql = db();
  await sql`UPDATE statutory_settings SET rate=${parsed.rate},source_reference=${parsed.source},updated_by=${user.id},updated_at=now() WHERE setting_name=${parsed.settingName} AND active=true`;
  await sql`INSERT INTO audit_log(event_type,entity_type,entity_id,actor_auth_id,actor_name,actor_role,description,metadata)
    VALUES('SETTING_UPDATED','statutory_setting',${parsed.settingName},${user.id},${profile.full_name},${profile.role},'Statutory setting updated',jsonb_build_object('new_rate',${parsed.rate}))`;
  revalidatePath("/settings");
}
