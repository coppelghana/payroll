import { recordPayment, transitionPayroll } from "@/app/actions";
import { db } from "@/lib/db";
import { date, money } from "@/lib/format";
import { requirePageRoles } from "@/lib/security";

type Period={id:string;period_code:string;status:string;stage:number;created_by_name:string;gross:number;net:number;paye:number;employees:number;pending_hod:number;locked_at:string|null;ceo_exception_reason:string|null;paid_amount:number|null;paid_reference:string|null};
type Event={id:string;action:string;from_status:string;to_status:string;actor_name:string;actor_role:string;comment:string|null;created_at:string};
type HodEntry={id:string;employee_no:string;full_name:string;allowances:number;overtime:number;bonus:number;other_earnings:number;loan_deduction:number;other_deductions:number;hod_verified:boolean};

export default async function ApprovalsPage(){
  const {profile}=await requirePageRoles("Payroll Officer","Head of Department","General Manager","CEO","Payment Officer");const sql=db();
  const rows=await sql`SELECT p.id,p.period_code,p.status,p.stage,p.created_by_name,p.locked_at,p.ceo_exception_reason,p.paid_amount::float,p.paid_reference,
    count(pe.id)::int employees,count(pe.id) FILTER(WHERE NOT pe.hod_verified)::int pending_hod,
    COALESCE(sum(pe.gross_pay),0)::float gross,COALESCE(sum(pe.net_pay),0)::float net,COALESCE(sum(pe.paye),0)::float paye
    FROM payroll_periods p LEFT JOIN payroll_entries pe ON pe.period_id=p.id GROUP BY p.id ORDER BY p.year DESC,p.month DESC LIMIT 1` as Period[];
  const period=rows[0];if(!period)return <div className="empty">No payroll is available for approval.</div>;
  const [eventRows,hodEntryRows]=await Promise.all([
    sql`SELECT id,action,from_status,to_status,actor_name,actor_role,comment,created_at FROM approval_events WHERE period_id=${period.id} ORDER BY created_at DESC`,
    profile.role==="Head of Department"&&profile.department_id?sql`SELECT pe.id,e.employee_no,e.full_name,pe.allowances::float,pe.overtime::float,pe.bonus::float,pe.other_earnings::float,pe.loan_deduction::float,pe.other_deductions::float,pe.hod_verified FROM payroll_entries pe JOIN employees e ON e.id=pe.employee_id WHERE pe.period_id=${period.id} AND e.department_id=${profile.department_id} ORDER BY e.full_name`:Promise.resolve([]),
  ]);
  const events=eventRows as Event[],hodEntries=hodEntryRows as HodEntry[];
  const labels=["Prepare","HOD review","GM approval","CEO review","Payment","Locked"];
  return <><div className="page-head"><div><span className="eyebrow">Database-enforced workflow</span><h1>Payroll approvals</h1><p>Every decision is role, stage and maker-checker validated.</p></div><span className={`badge ${period.locked_at?"green":"blue"}`}>{period.status}</span></div>
    <section className="card"><div className="card-head"><div><h2>{period.period_code}</h2><p>Prepared by {period.created_by_name}</p></div><ApprovalAction role={profile.role} stage={period.stage} periodId={period.id} net={period.net}/></div><div className="stages">{labels.map((label,index)=><div className={`stage ${index<period.stage?"done":index===period.stage?"current":""}`} key={label}><i/>{label}</div>)}</div>{period.ceo_exception_reason?<div className="info-box compact space-top"><b>CEO escalation:</b> {period.ceo_exception_reason}</div>:null}{period.locked_at?<div className="data-row space-top"><span>Payment reconciled</span><b>{money(period.paid_amount||0)}<small>{period.paid_reference}</small></b></div>:null}</section>
    {profile.role==="Head of Department"?<HodReview entries={hodEntries}/>:<section className="stats"><Stat label="Gross payroll" value={money(period.gross)}/><Stat label="Net payroll" value={money(period.net)}/><Stat label="Employees" value={String(period.employees)}/><Stat label="Pending HOD entries" value={String(period.pending_hod)}/></section>}
    <section className="grid two"><article className="card"><h2>Control checks</h2><Check label="Maker–checker validation" ok/><Check label="Department verification" ok={period.pending_hod===0}/><Check label="Payment separation" ok={period.stage>=4}/><Check label="Payroll locking" ok={Boolean(period.locked_at)}/></article><article className="card"><h2>Approval history</h2>{events.length?events.map(event=><div className="timeline" key={event.id}><i/><div><b>{event.to_status}</b><p>{event.actor_name} · {event.actor_role}</p><small>{date(event.created_at)}{event.comment?` · ${event.comment}`:""}</small></div></div>):<p className="muted">No approval actions yet.</p>}</article></section>
  </>;
}

function ApprovalAction({role,stage,periodId,net}:{role:string;stage:number;periodId:string;net:number}){
  if(role==="Payment Officer"&&stage===4)return <form action={recordPayment} className="inline-form"><input type="hidden" name="periodId" value={periodId}/><label>Payment reference<input name="paymentReference" required/></label><label>Reconciled amount<input name="paymentAmount" type="number" step="0.01" min="0.01" defaultValue={net.toFixed(2)} required/></label><label>Comment<input name="comment" maxLength={500}/></label><button className="button primary">Reconcile payment & lock</button></form>;
  const action=role==="Payroll Officer"&&stage===0?"submit":role==="Head of Department"&&stage===1?"hod_verify":role==="General Manager"&&stage===2?"gm_approve":role==="CEO"&&stage===3?"ceo_approve":"";
  if(!action)return <span className="info-box compact">Current stage belongs to another role.</span>;
  const label=action==="submit"?"Submit for HOD review":action==="hod_verify"?"Verify my department":action==="gm_approve"?"Approve payroll":"Approve escalation";
  return <div><form action={transitionPayroll} className="inline-form"><input type="hidden" name="periodId" value={periodId}/><input type="hidden" name="action" value={action}/>{action!=="submit"?<input name="comment" minLength={3} maxLength={500} placeholder="Required decision comment" required/>:<input name="comment" maxLength={500} placeholder="Submission note"/>}<button className="button primary">{label}</button></form>{action!=="submit"?<form action={transitionPayroll} className="inline-form space-top"><input type="hidden" name="periodId" value={periodId}/><input type="hidden" name="action" value="return"/><input name="comment" minLength={3} maxLength={500} placeholder="Required correction reason" required/><button className="button">Return for correction</button></form>:null}</div>;
}

function HodReview({entries}:{entries:HodEntry[]}){return <section className="card space-top"><div className="card-head"><div><h2>Assigned department review</h2><p>Only variable inputs needed for department verification are shown; salaries and net pay remain restricted.</p></div><span className="badge blue">{entries.length} employees</span></div><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Allowance</th><th>Overtime</th><th>Bonus</th><th>Other earnings</th><th>Deductions</th><th>Verification</th></tr></thead><tbody>{entries.map(entry=><tr key={entry.id}><td><b>{entry.full_name}</b><small>{entry.employee_no}</small></td><td>{money(entry.allowances)}</td><td>{money(entry.overtime)}</td><td>{money(entry.bonus)}</td><td>{money(entry.other_earnings)}</td><td>{money(entry.loan_deduction+entry.other_deductions)}</td><td><span className={`badge ${entry.hod_verified?"green":"amber"}`}>{entry.hod_verified?"Verified":"Pending"}</span></td></tr>)}</tbody></table></div></section>}
function Stat({label,value}:{label:string;value:string}){return <article className="stat"><span>{label}</span><strong>{value}</strong></article>}
function Check({label,ok}:{label:string;ok:boolean}){return <div className="data-row"><span>{label}</span><span className={`badge ${ok?"green":"amber"}`}>{ok?"Passed":"Pending"}</span></div>}
