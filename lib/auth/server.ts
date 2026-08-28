import { createNeonAuth } from "@neondatabase/auth/next/server";

type NeonAuth = ReturnType<typeof createNeonAuth>;

let authClient: NeonAuth | undefined;

export function getAuth() {
  if (authClient) return authClient;

  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET;

  if (!baseUrl) throw new Error("NEON_AUTH_BASE_URL is not configured in the runtime environment");
  if (!cookieSecret) throw new Error("NEON_AUTH_COOKIE_SECRET is not configured in the runtime environment");

  authClient = createNeonAuth({
    baseUrl,
    cookies: { secret: cookieSecret },
    logLevel: "warn",
  });

  return authClient;
}
