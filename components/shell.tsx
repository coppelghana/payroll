import Link from "next/link";
import { signOutAction } from "@/app/actions";
import type { Profile } from "@/lib/security";

const nav = [
  ["/dashboard","▦","Control centre"], ["/employees","♙","Employees"], ["/payroll","₵","Payroll register"],
  ["/approvals","✓","Approvals"], ["/notifications","●","Notifications"], ["/audit","▤","Audit trail"], ["/settings","⚙","Settings"]
];

export function Shell({ profile, unreadNotifications, children }: { profile: Profile; unreadNotifications: number; children: React.ReactNode }) {
  return <div className="shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">C</span><span><b>Coppel Payroll</b><small>Production system</small></span></div><p className="nav-label">Workspace</p><nav>{nav.map(([href,icon,label])=><Link href={href} key={href}><span>{icon}</span>{label}{href==="/notifications"&&unreadNotifications>0?<span className="badge amber">{unreadNotifications}</span>:null}</Link>)}</nav><div className="sidebar-user"><span className="avatar">{profile.full_name.split(" ").map(x=>x[0]).join("").slice(0,2)}</span><span><b>{profile.full_name}</b><small>{profile.role}</small></span></div></aside><main className="main"><header className="topbar"><div><b>Coppel Company Limited</b><small>Accra, Ghana</small></div><div className="inline-form"><Link className="button ghost" href="/notifications">Notifications {unreadNotifications>0?<span className="badge amber">{unreadNotifications}</span>:null}</Link><form action={signOutAction}><button className="button ghost">Sign out</button></form></div></header><div className="content">{children}</div></main></div>;
}
