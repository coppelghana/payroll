import { confirmStatutoryRates, inviteUser, retryApprovalEmails, updateSetting } from "@/app/actions";
import { approvalEmailConfigured } from "@/lib/approval-notifications";
import { db } from "@/lib/db";
import { date } from "@/lib/format";
import { identity, ROLES } from "@/lib/security";

type Setting = {
  id: string;
  setting_name: string;
  category: string;
  rate: number;
  lower_threshold: number | null;
  upper_threshold: number | null;
  effective_date: string;
  source_reference: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  confirmation_note: string | null;
};

type UserProfile = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  active: boolean;
  auth_user_id: string | null;
  created_at: string;
};

export default async function SettingsPage() {
  const { profile } = await identity();
  const sql = db();
  const [settingRows, userRows] = await Promise.all([
    sql`SELECT id,setting_name,category,rate::float,lower_threshold::float,upper_threshold::float,effective_date,source_reference,
      confirmed_by_name,confirmed_at,confirmation_note
      FROM statutory_settings WHERE active ORDER BY category,lower_threshold NULLS FIRST,setting_name`,
    sql`SELECT id,email,full_name,role,active,auth_user_id,created_at FROM user_profiles ORDER BY created_at`,
  ]);
  const settings = settingRows as Setting[];
  const users = userRows as UserProfile[];
  const admin = profile!.role === "System Administrator";
  const accounts = profile!.role === "Payroll Officer";
  const emailConfigured = approvalEmailConfigured();
  const statutorySettings = settings.filter((setting) => setting.category === "PAYE" || setting.category === "Pension");
  const pendingConfirmations = statutorySettings.filter((setting) => !setting.confirmed_at).length;
  const latestConfirmation = statutorySettings
    .filter((setting) => setting.confirmed_at)
    .sort((a, b) => new Date(b.confirmed_at!).getTime() - new Date(a.confirmed_at!).getTime())[0];

  return <>
    <div className="page-head">
      <div><span className="eyebrow">Effective-dated controls</span><h1>System settings</h1><p>Statutory values remain configurable and require recorded Accounts confirmation.</p></div>
    </div>
    <section className="grid two">
      <article className="card">
        <h2>Pension and escalation</h2>
        {settings.filter((setting) => setting.category !== "PAYE").map((setting) => <form action={updateSetting} className="setting-row" key={setting.id}>
          <input type="hidden" name="settingName" value={setting.setting_name}/>
          <div><b>{setting.setting_name.replaceAll("_", " ")}</b><small>{setting.source_reference}</small></div>
          <input name="rate" type="number" step=".01" defaultValue={setting.rate} disabled={!admin}/>
          <input name="source" defaultValue={setting.source_reference || "Administrative verification required"} hidden={!admin}/>
          {admin && <button className="button">Save</button>}
        </form>)}
      </article>
      <article className="card">
        <h2>Security status</h2>
        <div className="data-row"><span>Authentication</span><span className="badge green">Neon Auth active</span></div>
        <div className="data-row"><span>Database</span><span className="badge green">PostgreSQL connected</span></div>
        <div className="data-row"><span>Role enforcement</span><span className="badge green">Server-side</span></div>
        <div className="data-row"><span>Audit records</span><span className="badge green">Append-only</span></div>
        <div className="data-row"><span>Payroll transitions</span><span className="badge green">Database function</span></div>
        <div className="data-row"><span>Approval email</span><span className={`badge ${emailConfigured ? "green" : "amber"}`}>{emailConfigured ? "Configured" : "Setup required"}</span></div>
      </article>
    </section>
    <section className="card space-top">
      <div className="card-head"><div><h2>Approval notification rules</h2><p>Every rule creates an in-app alert and queues an email for each active user assigned the target role.</p></div><span className={`badge ${emailConfigured ? "green" : "amber"}`}>{emailConfigured ? "In-app + email" : "In-app active"}</span></div>
      <div className="data-row"><span>Payroll submitted</span><b>Head of Department</b></div>
      <div className="data-row"><span>Department verification completed</span><b>General Manager</b></div>
      <div className="data-row"><span>GM approval exceeds escalation threshold</span><b>CEO</b></div>
      <div className="data-row"><span>GM or CEO gives final approval</span><b>Payment Officer</b></div>
      <div className="data-row"><span>Payroll returned for correction</span><b>Payroll Officer</b></div>
      <div className="data-row"><span>Payment recorded and payroll locked</span><b>Payroll Officer · System Administrator</b></div>
      {!emailConfigured ? <div className="info-box compact space-top">Add RESEND_API_KEY and PAYROLL_EMAIL_FROM in Vercel to activate email delivery. Pending emails remain available for retry.</div> : null}
      {admin && emailConfigured ? <form action={retryApprovalEmails} className="space-top"><button className="button">Retry queued approval emails</button></form> : null}
    </section>
    <section className="card space-top" id="statutory-confirmation">
      <div className="card-head">
        <div><h2>Statutory rate confirmation</h2><p>Accounts must review the active PAYE and pension values against current official sources.</p></div>
        <span className={`badge ${pendingConfirmations ? "amber" : "green"}`}>{pendingConfirmations ? `${pendingConfirmations} pending` : "Confirmed"}</span>
      </div>
      {pendingConfirmations > 0 ? <>
        <div className="info-box compact space-top">Confirmation records who reviewed the rates; it does not change any rate or threshold.</div>
        {accounts ? <form action={confirmStatutoryRates} className="confirmation-form">
          <label>Verification reference or note<input name="reference" minLength={5} maxLength={180} placeholder="Example: GRA and SSNIT schedules reviewed" required/></label>
          <label className="attestation"><input name="attestation" type="checkbox" value="confirmed" required/> I confirm that Accounts has reviewed every active PAYE and pension value.</label>
          <button className="button primary">Confirm current statutory rates</button>
        </form> : <p className="space-top">A user assigned the <b>Payroll Officer</b> role must complete this confirmation.</p>}
      </> : latestConfirmation ? <div className="data-row space-top"><span>Latest Accounts confirmation<small>{latestConfirmation.confirmation_note}</small></span><b>{latestConfirmation.confirmed_by_name}<small>{date(latestConfirmation.confirmed_at!)}</small></b></div> : null}
    </section>
    <section className="card space-top">
      <h2>Monthly PAYE bands</h2>
      <div className="table-wrap"><table><thead><tr><th>Setting</th><th>Lower</th><th>Upper</th><th>Rate</th><th>Effective</th><th>Reference</th></tr></thead><tbody>{settings.filter((setting) => setting.category === "PAYE").map((setting) => <tr key={setting.id}><td><b>{setting.setting_name}</b></td><td>{setting.lower_threshold ?? "—"}</td><td>{setting.upper_threshold ?? "Remainder"}</td><td>{setting.rate}%</td><td>{date(setting.effective_date)}</td><td>{setting.source_reference}</td></tr>)}</tbody></table></div>
    </section>
    <section className="card space-top">
      <div className="card-head"><div><h2>User access</h2><p>Accounts only receive access after their email is assigned a role.</p></div></div>
      {admin && <details className="form-card"><summary>+ Invite or update user</summary><form action={inviteUser} className="inline-form"><input name="fullName" placeholder="Full name" required/><input name="email" type="email" placeholder="Work email" required/><select name="role">{ROLES.map((role) => <option key={role}>{role}</option>)}</select><button className="button primary">Grant access</button></form></details>}
      <div className="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Account</th><th>Granted</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><b>{user.full_name}</b><small>{user.email}</small></td><td><span className="badge blue">{user.role}</span></td><td><span className={`badge ${user.auth_user_id ? "green" : "amber"}`}>{user.auth_user_id ? "Activated" : "Invitation pending"}</span></td><td>{date(user.created_at)}</td></tr>)}</tbody></table></div>
    </section>
  </>;
}
