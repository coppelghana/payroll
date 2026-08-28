"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpAction } from "@/app/actions";

export default function SignUpPage() {
  const [state, action, pending] = useActionState(signUpAction, null);
  return <main className="auth-page"><section className="auth-story"><div className="brand"><span className="brand-mark">C</span><span><b>Coppel Company Limited</b><small>Secure payroll operations</small></span></div><div><span className="eyebrow light">Invite-only access</span><h1>Create your<br/>secure account.</h1><p>Your access remains pending until your email matches a role invitation issued by the system administrator.</p></div><small>Passwords are managed by Neon Auth</small></section><section className="auth-panel"><form action={action} className="auth-form"><span className="eyebrow">Account registration</span><h2>Create account</h2><label>Full name<input name="name" autoComplete="name" required /></label><label>Work email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label><small className="hint">Minimum 12 characters.</small>{state?.error&&<div className="error-box">{state.error}</div>}<button className="button primary full" disabled={pending}>{pending?"Creating account…":"Create account"}</button><p className="auth-link">Already registered? <Link href="/auth/sign-in">Sign in</Link></p></form></section></main>;
}
