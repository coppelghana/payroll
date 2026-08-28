import { getAuth } from "@/lib/auth/server";

type AuthRouteContext = { params: Promise<{ path: string[] }> };

function unavailable(error: unknown) {
  console.error("[auth] route unavailable", {
    message: error instanceof Error ? error.message : "Unknown authentication configuration error",
  });
  return Response.json({ error: "Authentication service unavailable." }, {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request, context: AuthRouteContext) {
  try {
    return await getAuth().handler().GET(request, context);
  } catch (error) {
    return unavailable(error);
  }
}

export async function POST(request: Request, context: AuthRouteContext) {
  try {
    return await getAuth().handler().POST(request, context);
  } catch (error) {
    return unavailable(error);
  }
}
