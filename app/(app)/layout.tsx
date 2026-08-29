import { Shell } from "@/components/shell";
import { ActionNotice } from "@/components/action-notice";
import { identity } from "@/lib/security";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await identity(true);
  return <Shell profile={profile!}><Suspense fallback={null}><ActionNotice /></Suspense>{children}</Shell>;
}
