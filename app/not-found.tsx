import Link from "next/link";
export default function NotFound(){return <main className="error-page"><div className="setup-card"><h1>Page not found</h1><p>The requested payroll page does not exist.</p><Link className="button primary" href="/dashboard">Return to control centre</Link></div></main>}
