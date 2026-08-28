import { neon } from "@neondatabase/serverless";

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not configured");
  return value;
}

export function db() {
  return neon(databaseUrl(), { fullResults: false });
}
