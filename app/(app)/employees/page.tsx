import { createEmployee } from "@/app/actions";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { identity } from "@/lib/security";

type Employee={id:string;employee_no:string;full_name:string;department:string;job_title:string;employment_type:string;employment_status:string;basic_salary:number;bank_name:string|null;ssnit_number:string|null};
type Department={id:string;name:string};

export default async function EmployeesPage(){
  const {profile}=await identity(); const sql=db();
  const [employeeRows,departmentRows]=await Promise.all([
    sql`SELECT e.id,e.employee_no,e.full_name,d.name department,e.job_title,e.employment_type,e.employment_status,e.basic_salary::float,e.bank_name,e.ssnit_number FROM employees e JOIN departments d ON d.id=e.department_id ORDER BY e.full_name`,
    sql`SELECT id,name FROM departments WHERE active ORDER BY name`
  ]);
  const employees=employeeRows as Employee[], departments=departmentRows as Department[];
  const canAdd=["HR / Administrator","System Administrator"].includes(profile!.role);
  return <><div className="page-head"><div><span className="eyebrow">Controlled master data</span><h1>Employees</h1><p>{employees.length} persistent employee records in the production database.</p></div></div>{canAdd&&<details className="card form-card"><summary>+ Add employee</summary><form action={createEmployee} className="form-grid"><label>Employee number<input name="employeeNo" placeholder="CPL-007" required/></label><label>Full name<input name="fullName" required/></label><label>Department<select name="departmentId" required>{departments.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}</select></label><label>Job title<input name="jobTitle" required/></label><label>Employment type<select name="employmentType"><option>Permanent</option><option>Fixed Term</option><option>Contract</option><option>Casual</option><option>Temporary</option><option>Apprentice</option></select></label><label>Date joined<input name="dateJoined" type="date" required/></label><label>Basic monthly salary<input name="basicSalary" type="number" min="0" step="0.01" required/></label><label>Bank name<input name="bankName"/></label><label>Account name<input name="accountName"/></label><label>Account number<input name="accountNumber"/></label><label>SSNIT number<input name="ssnitNumber"/></label><div className="form-actions"><button className="button primary">Create employee</button></div></form></details>}<section className="card"><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Department</th><th>Employment</th><th>Basic salary</th><th>Records</th><th>Status</th></tr></thead><tbody>{employees.map(e=><tr key={e.id}><td><b>{e.full_name}</b><small>{e.employee_no} · {e.job_title}</small></td><td>{e.department}</td><td>{e.employment_type}</td><td className="money">{money(e.basic_salary)}</td><td><span className={`badge ${e.bank_name&&e.ssnit_number?"green":"red"}`}>{e.bank_name&&e.ssnit_number?"Complete":"Missing data"}</span></td><td><span className="badge green">{e.employment_status}</span></td></tr>)}</tbody></table></div></section></>;
}
