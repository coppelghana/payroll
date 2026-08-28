import Link from "next/link";
import { db } from "@/lib/db";
import { money } from "@/lib/format";

export const metadata = { title: "Control centre" };

type Summary = { id:string; period_code:string; month:number; year:number; status:string; stage:number; employee_count:number; gross:number; net:number; paye:number; employee_pension:number; employer_pension:number; missing_bank:number; missing_ssnit:number };

export default async function DashboardPage() {
  const sql=db();
  const rows=await sql`SELECT p.id,p.period_code,p.month,p.year,p.status,p.stage,
    count(pe.id)::int employee_count,COALESCE(sum(pe.gross_pay),0)::float gross,COALESCE(sum(pe.net_pay),0)::float net,
    COALESCE(sum(pe.paye),0)::float paye,COALESCE(sum(pe.employee_pension),0)::float employee_pension,COALESCE(sum(pe.employer_pension),0)::float employer_pension,
    count(*) FILTER(WHERE e.bank_name IS NULL)::int missing_bank,count(*) FILTER(WHERE e.ssnit_applicable AND e.ssnit_number IS NULL)::int missing_ssnit
    FROM payroll_periods p LEFT JOIN payroll_entries pe ON pe.period_id=p.id LEFT JOIN employees e ON e.id=pe.employee_id
    GROUP BY p.id ORDER BY p.year DESC,p.month DESC LIMIT 1` as Summary[];
  const s=rows[0];
  if(!s) return <><PageHead/><div className="empty">No payroll period exists yet. A Payroll Officer can create the first period.</div></>;
  const labels=["Prepare","HOD review","GM approval","CEO review","Payment","Locked"];
  return <><PageHead/><section className="stats"><Stat label="Gross payroll" value={money(s.gross)} detail={`${s.employee_count} employees`}/><Stat label="Net payroll" value={money(s.net)} detail="Bank payment amount"/><Stat label="PAYE liability" value={money(s.paye)} detail="Verify filing deadline"/><Stat label="Exceptions" value={String(s.missing_bank+s.missing_ssnit)} detail="Missing statutory or bank data" warn/></section><section className="grid two"><article className="card"><div className="card-head"><div><span className="badge blue">{s.status}</span><h2>Payroll approval path</h2></div><Link className="button dark" href="/approvals">Review controls</Link></div><div className="stages">{labels.map((x,i)=><div className={`stage ${i<s.stage?"done":i===s.stage?"current":""}`} key={x}><i/>{x}</div>)}</div><div className="owner"><span>Current owner</span><b>{["Payroll Officer","Department Heads","General Manager","CEO","Payment Officer","System"][s.stage]}</b></div></article><article className="card"><h2>Attention required</h2><Alert title="Missing bank details" detail={`${s.missing_bank} employee record(s)`}/><Alert title="Missing SSNIT information" detail={`${s.missing_ssnit} applicable employee record(s)`}/><Alert title="Statutory verification" detail="Rates are configurable and require Accounts confirmation"/></article></section><section className="grid two space-top"><article className="card"><h2>Separation of duties</h2><Check label="Payroll preparation" owner="Payroll Officer"/><Check label="Department input verification" owner="HOD"/><Check label="Routine final approval" owner="General Manager"/><Check label="Threshold escalation" owner="CEO only when required"/><Check label="Payment confirmation" owner="Payment Officer"/></article><article className="card"><h2>Statutory summary</h2><Row label="Employee pension" value={money(s.employee_pension)}/><Row label="Employer pension" value={money(s.employer_pension)}/><Row label="PAYE" value={money(s.paye)}/><Row label="Total statutory" value={money(s.employee_pension+s.employer_pension+s.paye)} strong/></article></section></>;
}

function PageHead(){return <div className="page-head"><div><span className="eyebrow">Live database</span><h1>Management control centre</h1><p>Current payroll status, exceptions and accountability.</p></div><Link className="button primary" href="/payroll">Open payroll register</Link></div>}
function Stat({label,value,detail,warn=false}:{label:string;value:string;detail:string;warn?:boolean}){return <article className="stat"><span>{label}</span><strong>{value}</strong><small className={warn?"warn":""}>{detail}</small></article>}
function Alert({title,detail}:{title:string;detail:string}){return <div className="alert"><span>!</span><div><b>{title}</b><small>{detail}</small></div></div>}
function Check({label,owner}:{label:string;owner:string}){return <div className="data-row"><span>{label}</span><span className="badge green">{owner}</span></div>}
function Row({label,value,strong=false}:{label:string;value:string;strong?:boolean}){return <div className={`data-row ${strong?"strong":""}`}><span>{label}</span><b>{value}</b></div>}
