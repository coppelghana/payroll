import Link from "next/link";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { identity } from "@/lib/security";
import { redirect } from "next/navigation";

export const metadata = { title: "Control centre" };

type PayrollSummary = { period_code:string;status:string;stage:number;employee_count:number;gross:number;net:number;paye:number;employee_pension:number;employer_pension:number };
type ComplianceSummary = { missing_bank:number;missing_ssnit:number;unconfirmed_statutory:number };

export default async function DashboardPage() {
  const { profile } = await identity();
  if (profile!.role === "Employee") redirect("/my-payroll");
  if (profile!.role === "HR / Administrator") return <HrDashboard/>;
  if (profile!.role === "System Administrator") return <SystemDashboard/>;
  if (profile!.role === "Head of Department") return <HodDashboard departmentId={profile!.department_id}/>;
  return <FinancialDashboard role={profile!.role}/>;
}

async function FinancialDashboard({role}:{role:string}) {
  const sql=db();
  const [summaryResult,complianceResult]=await Promise.all([
    sql`SELECT p.period_code,p.status,p.stage,count(pe.id)::int employee_count,COALESCE(sum(pe.gross_pay),0)::float gross,
      COALESCE(sum(pe.net_pay),0)::float net,COALESCE(sum(pe.paye),0)::float paye,
      COALESCE(sum(pe.employee_pension),0)::float employee_pension,COALESCE(sum(pe.employer_pension),0)::float employer_pension
      FROM payroll_periods p LEFT JOIN payroll_entries pe ON pe.period_id=p.id GROUP BY p.id ORDER BY p.year DESC,p.month DESC LIMIT 1`,
    sql`SELECT
      (SELECT count(*)::int FROM employees WHERE employment_status='Active' AND (NULLIF(trim(bank_name),'') IS NULL OR NULLIF(trim(account_name),'') IS NULL OR NULLIF(trim(account_number),'') IS NULL)) missing_bank,
      (SELECT count(*)::int FROM employees WHERE employment_status='Active' AND ssnit_applicable=true AND NULLIF(trim(ssnit_number),'') IS NULL) missing_ssnit,
      (SELECT count(*)::int FROM statutory_settings WHERE active=true AND category IN ('PAYE','Pension') AND confirmed_at IS NULL) unconfirmed_statutory`,
  ]);
  const summary=(summaryResult as PayrollSummary[])[0];
  const compliance=(complianceResult as ComplianceSummary[])[0]||{missing_bank:0,missing_ssnit:0,unconfirmed_statutory:0};
  if(!summary)return <><PageHead action="/payroll"/><div className="empty">No payroll period exists yet.</div></>;
  const labels=["Prepare","HOD review","GM approval","CEO review","Payment","Locked"];
  return <><PageHead action={role==="Payroll Officer"?"/payroll":"/approvals"}/>
    <section className="stats"><Stat label="Gross payroll" value={money(summary.gross)} detail={`${summary.employee_count} employees`}/><Stat label="Net payroll" value={money(summary.net)} detail="Approved payment basis"/><Stat label="PAYE liability" value={money(summary.paye)} detail="Subject to statutory confirmation"/><Stat label="Exceptions" value={String(compliance.missing_bank+compliance.missing_ssnit)} detail="Missing bank or statutory data" warn={compliance.missing_bank+compliance.missing_ssnit>0}/></section>
    <section className="grid two"><article className="card"><div className="card-head"><div><span className="badge blue">{summary.status}</span><h2>Payroll approval path</h2></div><Link className="button dark" href="/approvals">Review controls</Link></div><div className="stages">{labels.map((label,index)=><div className={`stage ${index<summary.stage?"done":index===summary.stage?"current":""}`} key={label}><i/>{label}</div>)}</div></article><article className="card"><h2>Readiness</h2><Alert title="Bank details" count={compliance.missing_bank}/><Alert title="SSNIT information" count={compliance.missing_ssnit}/><Alert title="Statutory confirmation" count={compliance.unconfirmed_statutory}/></article></section>
    <section className="card space-top"><h2>Statutory summary</h2><Row label="Employee pension" value={money(summary.employee_pension)}/><Row label="Employer pension" value={money(summary.employer_pension)}/><Row label="PAYE" value={money(summary.paye)}/><Row label="Total statutory" value={money(summary.employee_pension+summary.employer_pension+summary.paye)} strong/></section></>;
}

async function HodDashboard({departmentId}:{departmentId:string|null}) {
  if(!departmentId)return <div className="empty">Your HOD account must be assigned to a department before it can review payroll.</div>;
  const rows=await db()`SELECT d.name,count(pe.id)::int employees,count(*) FILTER(WHERE pe.hod_verified=false)::int pending FROM departments d LEFT JOIN employees e ON e.department_id=d.id LEFT JOIN payroll_entries pe ON pe.employee_id=e.id AND pe.period_id=(SELECT id FROM payroll_periods ORDER BY year DESC,month DESC LIMIT 1) WHERE d.id=${departmentId} GROUP BY d.id` as {name:string;employees:number;pending:number}[];
  const row=rows[0];
  return <><PageHead action="/approvals"/><section className="stats"><Stat label="Department" value={row?.name||"Assigned department"} detail="Your authorized scope"/><Stat label="Employees in current payroll" value={String(row?.employees||0)} detail="Department records only"/><Stat label="Pending verification" value={String(row?.pending||0)} detail="Awaiting HOD review" warn={(row?.pending||0)>0}/></section><section className="card"><h2>Department verification</h2><p>Only employees and variable inputs from your assigned department are available on the approval page.</p><Link className="button primary space-top" href="/approvals">Open department review</Link></section></>;
}

async function HrDashboard(){const rows=await db()`SELECT count(*)::int employees,count(*) FILTER(WHERE employment_status='Active')::int active,count(*) FILTER(WHERE employment_status='Active' AND (NULLIF(trim(bank_name),'') IS NULL OR NULLIF(trim(account_name),'') IS NULL OR NULLIF(trim(account_number),'') IS NULL))::int missing_bank,count(*) FILTER(WHERE employment_status='Active' AND ssnit_applicable=true AND NULLIF(trim(ssnit_number),'') IS NULL)::int missing_ssnit FROM employees` as {employees:number;active:number;missing_bank:number;missing_ssnit:number}[];const row=rows[0];return <><PageHead action="/employees"/><section className="stats"><Stat label="Employee records" value={String(row.employees)} detail={`${row.active} active`}/><Stat label="Missing bank details" value={String(row.missing_bank)} detail="Requires HR correction" warn={row.missing_bank>0}/><Stat label="Missing SSNIT" value={String(row.missing_ssnit)} detail="Applicable active employees" warn={row.missing_ssnit>0}/></section><section className="card"><h2>HR master data</h2><p>Employee records and employment status controls are available without exposing payroll totals.</p></section></>}
async function SystemDashboard(){const rows=await db()`SELECT count(*) FILTER(WHERE active)::int active_users,count(*) FILTER(WHERE active AND auth_user_id IS NULL)::int pending_users,count(DISTINCT role) FILTER(WHERE active)::int represented_roles FROM user_profiles` as {active_users:number;pending_users:number;represented_roles:number}[];const row=rows[0];return <><PageHead action="/settings"/><section className="stats"><Stat label="Active users" value={String(row.active_users)} detail="Authorized profiles"/><Stat label="Pending registrations" value={String(row.pending_users)} detail="Invited but not activated" warn={row.pending_users>0}/><Stat label="Roles represented" value={`${row.represented_roles}/8`} detail="Workflow coverage" warn={row.represented_roles<8}/></section><section className="card"><h2>System administration</h2><p>Manage access, employee master data, settings and audit evidence without payroll preparation or approval powers.</p></section></>}

function PageHead({action}:{action:string}){return <div className="page-head"><div><span className="eyebrow">Role-controlled workspace</span><h1>Management control centre</h1><p>Information is limited to the responsibilities of the signed-in role.</p></div><Link className="button primary" href={action}>Open workspace</Link></div>}
function Stat({label,value,detail,warn=false}:{label:string;value:string;detail:string;warn?:boolean}){return <article className="stat"><span>{label}</span><strong>{value}</strong><small className={warn?"warn":""}>{detail}</small></article>}
function Alert({title,count}:{title:string;count:number}){return <div className={`alert ${count===0?"passed":"warning"}`}><span aria-hidden="true">{count===0?"✓":"!"}</span><div><b>{title}</b><small>{count===0?"Complete":`${count} record(s) require attention`}</small></div></div>}
function Row({label,value,strong=false}:{label:string;value:string;strong?:boolean}){return <div className={`data-row ${strong?"strong":""}`}><span>{label}</span><b>{value}</b></div>}
