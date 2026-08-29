import Link from "next/link";
import { db } from "@/lib/db";
import { money } from "@/lib/format";

export const metadata = { title: "Control centre" };

type Summary = {
  id: string;
  period_code: string;
  month: number;
  year: number;
  status: string;
  stage: number;
  employee_count: number;
  gross: number;
  net: number;
  paye: number;
  employee_pension: number;
  employer_pension: number;
};

type ComplianceSummary = {
  missing_bank: number;
  missing_ssnit: number;
  unconfirmed_statutory: number;
};

export default async function DashboardPage() {
  const sql = db();
  const [summaryResult, complianceResult] = await Promise.all([
    sql`SELECT p.id,p.period_code,p.month,p.year,p.status,p.stage,
      count(pe.id)::int employee_count,COALESCE(sum(pe.gross_pay),0)::float gross,COALESCE(sum(pe.net_pay),0)::float net,
      COALESCE(sum(pe.paye),0)::float paye,COALESCE(sum(pe.employee_pension),0)::float employee_pension,COALESCE(sum(pe.employer_pension),0)::float employer_pension
      FROM payroll_periods p LEFT JOIN payroll_entries pe ON pe.period_id=p.id
      GROUP BY p.id ORDER BY p.year DESC,p.month DESC LIMIT 1`,
    sql`SELECT
      (SELECT count(*)::int FROM employees
        WHERE employment_status='Active'
          AND (NULLIF(trim(bank_name),'') IS NULL OR NULLIF(trim(account_name),'') IS NULL OR NULLIF(trim(account_number),'') IS NULL)) AS missing_bank,
      (SELECT count(*)::int FROM employees
        WHERE employment_status='Active' AND ssnit_applicable=true AND NULLIF(trim(ssnit_number),'') IS NULL) AS missing_ssnit,
      (SELECT count(*)::int FROM statutory_settings
        WHERE active=true AND category IN ('PAYE','Pension') AND confirmed_at IS NULL) AS unconfirmed_statutory`,
  ]);

  const summaryRows = summaryResult as Summary[];
  const complianceRows = complianceResult as ComplianceSummary[];
  const s = summaryRows[0];
  const compliance = complianceRows[0] ?? { missing_bank: 0, missing_ssnit: 0, unconfirmed_statutory: 0 };
  const employeeExceptions = compliance.missing_bank + compliance.missing_ssnit;
  const requiresAttention = employeeExceptions > 0 || compliance.unconfirmed_statutory > 0;

  if (!s) {
    return <><PageHead/><div className="empty">No payroll period exists yet. A Payroll Officer can create the first period.</div></>;
  }

  const labels = ["Prepare", "HOD review", "GM approval", "CEO review", "Payment", "Locked"];
  return <>
    <PageHead/>
    <section className="stats">
      <Stat label="Gross payroll" value={money(s.gross)} detail={`${s.employee_count} employees`}/>
      <Stat label="Net payroll" value={money(s.net)} detail="Bank payment amount"/>
      <Stat label="PAYE liability" value={money(s.paye)} detail="Verify filing deadline"/>
      <Stat label="Exceptions" value={String(employeeExceptions)} detail={employeeExceptions ? "Missing statutory or bank data" : "Employee records complete"} warn={employeeExceptions > 0}/>
    </section>
    <section className="grid two">
      <article className="card">
        <div className="card-head">
          <div><span className="badge blue">{s.status}</span><h2>Payroll approval path</h2></div>
          <Link className="button dark" href="/approvals">Review controls</Link>
        </div>
        <div className="stages">{labels.map((label, index) => <div className={`stage ${index < s.stage ? "done" : index === s.stage ? "current" : ""}`} key={label}><i/>{label}</div>)}</div>
        <div className="owner"><span>Current owner</span><b>{["Payroll Officer", "Department Heads", "General Manager", "CEO", "Payment Officer", "System"][s.stage]}</b></div>
      </article>
      <article className="card">
        <h2>{requiresAttention ? "Attention required" : "Compliance checks"}</h2>
        <Alert
          title="Bank details"
          detail={compliance.missing_bank ? `${compliance.missing_bank} active employee record(s) require bank details` : "Complete for all active employees"}
          passed={compliance.missing_bank === 0}
        />
        <Alert
          title="SSNIT information"
          detail={compliance.missing_ssnit ? `${compliance.missing_ssnit} applicable employee record(s) require SSNIT information` : "Complete for all applicable employees"}
          passed={compliance.missing_ssnit === 0}
        />
        <Alert
          title="Statutory rates"
          detail={compliance.unconfirmed_statutory ? `${compliance.unconfirmed_statutory} active rate(s) require Accounts confirmation` : "Current active rates confirmed by Accounts"}
          passed={compliance.unconfirmed_statutory === 0}
          href={compliance.unconfirmed_statutory ? "/settings#statutory-confirmation" : undefined}
        />
      </article>
    </section>
    <section className="grid two space-top">
      <article className="card">
        <h2>Separation of duties</h2>
        <Check label="Payroll preparation" owner="Payroll Officer"/>
        <Check label="Department input verification" owner="HOD"/>
        <Check label="Routine final approval" owner="General Manager"/>
        <Check label="Threshold escalation" owner="CEO only when required"/>
        <Check label="Payment confirmation" owner="Payment Officer"/>
      </article>
      <article className="card">
        <h2>Statutory summary</h2>
        <Row label="Employee pension" value={money(s.employee_pension)}/>
        <Row label="Employer pension" value={money(s.employer_pension)}/>
        <Row label="PAYE" value={money(s.paye)}/>
        <Row label="Total statutory" value={money(s.employee_pension + s.employer_pension + s.paye)} strong/>
      </article>
    </section>
  </>;
}

function PageHead() {
  return <div className="page-head"><div><span className="eyebrow">Live database</span><h1>Management control centre</h1><p>Current payroll status, exceptions and accountability.</p></div><Link className="button primary" href="/payroll">Open payroll register</Link></div>;
}

function Stat({ label, value, detail, warn = false }: { label: string; value: string; detail: string; warn?: boolean }) {
  return <article className="stat"><span>{label}</span><strong>{value}</strong><small className={warn ? "warn" : ""}>{detail}</small></article>;
}

function Alert({ title, detail, passed, href }: { title: string; detail: string; passed: boolean; href?: string }) {
  return <div className={`alert ${passed ? "passed" : "warning"}`}>
    <span aria-hidden="true">{passed ? "✓" : "!"}</span>
    <div><b>{title}</b><small>{detail}</small>{href && <Link className="alert-link" href={href}>Review and confirm</Link>}</div>
  </div>;
}

function Check({ label, owner }: { label: string; owner: string }) {
  return <div className="data-row"><span>{label}</span><span className="badge green">{owner}</span></div>;
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`data-row ${strong ? "strong" : ""}`}><span>{label}</span><b>{value}</b></div>;
}
