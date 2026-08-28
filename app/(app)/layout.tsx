import { Shell } from "@/components/shell";
import { identity } from "@/lib/security";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await identity(true);
  return <Shell profile={profile!}>{children}</Shell>;
}
