import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    const required = ["DATABASE_URL", "NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET", "BOOTSTRAP_ADMIN_TOKEN"];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) {
      console.error(JSON.stringify({ level: "error", message: "health_missing_environment", missing, duration_ms: Date.now() - started }));
      return Response.json({ status: "error", code: "ENVIRONMENT_INCOMPLETE", missing }, { status: 503 });
    }
    await db()`SELECT 1 AS healthy`;
    return Response.json({ status: "ok", database: "connected", authentication: "configured" }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "health_failed", error: error instanceof Error ? error.message : String(error), duration_ms: Date.now() - started }));
    return Response.json({ status: "error", code: "DATABASE_UNAVAILABLE" }, { status: 503 });
  }
}
