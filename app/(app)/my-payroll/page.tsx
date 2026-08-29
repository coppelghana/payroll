import { db } from "@/lib/db";
import { date, money } from "@/lib/format";
import { requirePageRoles } from "@/lib/security";

type Payslip = {
  id: string;
  period_code: string;
  payment_date: string;
  basic_salary: number;
  allowances: number;
  overtime: number;
  bonus: number;
  other_earnings: number;
  gross_pay: number;
  employee_pension: number;
  paye: number;
  loan_deduction: number;
  other_deductions: number;
  net_pay: number;
};

export const metadata = { title: "My payslips" };

export default async function MyPayrollPage() {
  const { profile } = await requirePageRoles("Employee");
  if (!profile.employee_id) return <div className="empty">Your account is not linked to an employee record. Contact the System Administrator.</div>;

  const rows = await db()`SELECT pe.id,p.period_code,p.payment_date,
    pe.basic_salary::float,pe.allowances::float,pe.overtime::float,pe.bonus::float,pe.other_earnings::float,
    pe.gross_pay::float,pe.employee_pension::float,pe.paye::float,pe.loan_deduction::float,
    pe.other_deductions::float,pe.net_pay::float
    FROM payroll_entries pe JOIN payroll_periods p ON p.id=pe.period_id
    WHERE pe.employee_id=${profile.employee_id} AND p.locked_at IS NOT NULL
    ORDER BY p.year DESC,p.month DESC` as Payslip[];

  return <>
    <div className="page-head"><div><span className="eyebrow">Private self-service</span><h1>My payslips</h1><p>Only your paid and locked payroll records are displayed.</p></div></div>
    {rows.length ? rows.map((row) => <section className="card space-top" key={row.id}>
      <div className="card-head"><div><h2>{row.period_code}</h2><p>Payment date {date(row.payment_date)}</p></div><span className="badge green">Paid</span></div>
      <div className="grid two">
        <div>
          <Row label="Basic salary" value={money(row.basic_salary)}/>
          <Row label="Allowances" value={money(row.allowances)}/>
          <Row label="Overtime" value={money(row.overtime)}/>
          <Row label="Bonus" value={money(row.bonus)}/>
          <Row label="Other earnings" value={money(row.other_earnings)}/>
          <Row label="Gross earnings" value={money(row.gross_pay)} strong/>
        </div>
        <div>
          <Row label="Employee pension" value={money(row.employee_pension)}/>
          <Row label="PAYE" value={money(row.paye)}/>
          <Row label="Loan deduction" value={money(row.loan_deduction)}/>
          <Row label="Other deductions" value={money(row.other_deductions)}/>
          <Row label="Net pay" value={money(row.net_pay)} strong/>
        </div>
      </div>
    </section>) : <div className="empty">No paid payslip is available yet.</div>}
  </>;
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`data-row ${strong ? "strong" : ""}`}><span>{label}</span><b>{value}</b></div>;
}
