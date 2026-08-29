import { Shell } from "@/components/shell";
import { ActionNotice } from "@/components/action-notice";
import { db } from "@/lib/db";
import { identity } from "@/lib/security";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await identity(true);
  const unreadRows = await db()`SELECT count(*)::int AS count FROM approval_notifications
    WHERE recipient_profile_id=${profile!.id} AND read_at IS NULL` as { count: number }[];
  return <Shell profile={profile!} unreadNotifications={unreadRows[0]?.count || 0}><Suspense fallback={null}><ActionNotice /></Suspense>{children}</Shell>;
}
