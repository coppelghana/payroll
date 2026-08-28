import { auth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

export const ROLES = ["Payroll Officer","Head of Department","General Manager","CEO","Payment Officer","HR / Administrator","System Administrator"] as const;
export type Role = typeof ROLES[number];

export type Profile = {
  id: string;
  auth_user_id: string;
  email: string;
  full_name: string;
  role: Role;
  department_id: string | null;
};

export async function identity(requireProfile = true) {
  const { data: session } = await auth.getSession();
  if (!session?.user?.id || !session.user.email) redirect("/auth/sign-in");
  const sql = db();
  let rows = await sql`SELECT id,auth_user_id,email,full_name,role,department_id
    FROM user_profiles WHERE active=true AND (auth_user_id=${session.user.id} OR (auth_user_id IS NULL AND lower(email)=lower(${session.user.email}))) LIMIT 1` as Profile[];
  if (rows[0] && !rows[0].auth_user_id) {
    rows = await sql`UPDATE user_profiles SET auth_user_id=${session.user.id},updated_at=now()
      WHERE id=${rows[0].id} AND auth_user_id IS NULL
      RETURNING id,auth_user_id,email,full_name,role,department_id` as Profile[];
  }
  if (requireProfile && !rows[0]) redirect("/setup");
  return { user: session.user, profile: rows[0] || null };
}

export async function requireRoles(...roles: Role[]) {
  const result = await identity(true);
  if (!result.profile || !roles.includes(result.profile.role)) throw new Error("You do not have permission to perform this action.");
  return { user: result.user, profile: result.profile };
}
