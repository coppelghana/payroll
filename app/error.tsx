"use client";

export default function ErrorPage({reset}:{error:Error&{digest?:string};reset:()=>void}){return <main className="error-page"><div className="setup-card"><span className="brand-mark">!</span><h1>Action could not be completed</h1><p>The system rejected the request or encountered a temporary problem. No approval should be assumed.</p><button className="button primary" onClick={reset}>Try again</button></div></main>}
