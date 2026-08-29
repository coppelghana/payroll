import Link from "next/link";
import { defaultPathForRole } from "@/lib/permissions";
import { identity } from "@/lib/security";

export const metadata = { title: "Access restricted" };

export default async function ForbiddenPage() {
  const { profile } = await identity();
  return <section className="card">
    <span className="eyebrow">Access restricted</span>
    <h1>This page is outside your assigned role.</h1>
    <p>Your account remains active, but payroll information is limited according to your responsibilities.</p>
    <Link className="button primary space-top" href={defaultPathForRole(profile!.role)}>Return to your workspace</Link>
  </section>;
}
