"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction } from "@/app/actions";

export default function SignInPage() {
  const [state, action, pending] = useActionState(signInAction, null);
  return <main className="auth-page"><section className="auth-story"><div className="brand"><span className="brand-mark">C</span><span><b>Coppel Company Limited</b><small>Secure payroll operations</small></span></div><div><span className="eyebrow light">Management control system</span><h1>Payroll control,<br/>with accountable access.</h1><p>Every preparation, verification, approval and payment is tied to an authenticated user and recorded permanently.</p></div><small>Internal system · Authorized personnel only</small></section><section className="auth-panel"><form action={action} className="auth-form"><span className="eyebrow">Secure workspace</span><h2>Sign in</h2><p>Use the account provided by your system administrator.</p><label>Email address<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>{state?.error&&<div className="error-box">{state.error}</div>}<button className="button primary full" disabled={pending}>{pending?"Signing in…":"Sign in securely"}</button><p className="auth-link">Invited but no account? <Link href="/auth/sign-up">Create account</Link></p></form></section></main>;
}
