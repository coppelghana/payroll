import { bootstrapAdmin } from "@/app/actions";
import { identity } from "@/lib/security";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { user, profile } = await identity(false);
  if (profile) redirect("/dashboard");
  const { error } = await searchParams;
  return <main className="setup-page"><div className="setup-card"><span className="brand-mark">C</span><span className="eyebrow">Account authorization</span><h1>Access pending</h1><p><b>{user.email}</b> is authenticated but does not yet have a Coppel payroll role.</p><div className="info-box">Ask the System Administrator to invite this exact email address. Access will activate automatically at your next sign-in.</div><hr/><h2>Initial administrator</h2><p>If this is the first account, enter the one-time setup token supplied during deployment.</p>{error&&<div className="error-box">{error}</div>}<form action={bootstrapAdmin} className="inline-form"><input name="token" type="password" placeholder="One-time setup token" required/><button className="button primary">Activate administrator</button></form></div></main>;
}
