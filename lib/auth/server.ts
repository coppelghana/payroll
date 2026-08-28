import { createNeonAuth } from "@neondatabase/auth/next/server";

const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build";

function authConfig(name: "NEON_AUTH_BASE_URL" | "NEON_AUTH_COOKIE_SECRET") {
  const value = process.env[name];
  if (value) return value;
  if (isProductionBuild) {
    return name === "NEON_AUTH_BASE_URL"
      ? "https://build-placeholder.invalid/auth"
      : "build-only-placeholder-secret-32-characters";
  }
  throw new Error(`${name} is not configured in the runtime environment`);
}

export const auth = createNeonAuth({
  baseUrl: authConfig("NEON_AUTH_BASE_URL"),
  cookies: { secret: authConfig("NEON_AUTH_COOKIE_SECRET") },
  logLevel: "warn",
});
