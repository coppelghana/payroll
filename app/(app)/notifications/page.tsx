import Link from "next/link";
import { markAllNotificationsRead } from "@/app/actions";
import { db } from "@/lib/db";
import { date } from "@/lib/format";
import { identity } from "@/lib/security";

type Notification = {
  id: string;
  period_code: string;
  title: string;
  message: string;
  action_url: string;
  read_at: string | null;
  email_status: string;
  created_at: string;
};

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { profile } = await identity();
  const rows = await db()`SELECT n.id,p.period_code,n.title,n.message,n.action_url,n.read_at,n.email_status,n.created_at
    FROM approval_notifications n
    JOIN payroll_periods p ON p.id=n.period_id
    WHERE n.recipient_profile_id=${profile!.id}
    ORDER BY (n.read_at IS NOT NULL),n.created_at DESC
    LIMIT 100` as Notification[];
  const unread = rows.filter((notification) => !notification.read_at).length;

  return <>
    <div className="page-head">
      <div><span className="eyebrow">Role-based alerts</span><h1>Approval notifications</h1><p>Workflow requests assigned to your payroll role.</p></div>
      {unread>0?<form action={markAllNotificationsRead}><button className="button">Mark all as read</button></form>:null}
    </div>
    <section className="card">
      {rows.length?rows.map((notification) => <div className="data-row" key={notification.id}>
        <span><b>{notification.title}</b><small>{notification.message}</small><small>{notification.period_code} · {date(notification.created_at)}</small></span>
        <span><span className={`badge ${notification.read_at?"green":"amber"}`}>{notification.read_at?"Read":"New"}</span> <span className={`badge ${notification.email_status==="sent"?"green":notification.email_status==="failed"?"red":"amber"}`}>Email {notification.email_status}</span> <Link className="button" href={notification.action_url}>Open</Link></span>
      </div>):<div className="empty">No approval notifications have been assigned to you.</div>}
    </section>
  </>;
}
