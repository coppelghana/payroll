import { getAuth } from "@/lib/auth/server";
import type { NextRequest } from "next/server";

export default function proxy(request: NextRequest) {
  try {
    return getAuth().middleware({ loginUrl: "/auth/sign-in" })(request);
  } catch (error) {
    console.error("[auth] middleware unavailable", {
      message: error instanceof Error ? error.message : "Unknown authentication configuration error",
    });
    return new Response("Authentication service unavailable.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export const config = {
  matcher: ["/dashboard/:path*", "/employees/:path*", "/payroll/:path*", "/approvals/:path*", "/my-payroll/:path*", "/notifications/:path*", "/settings/:path*", "/audit/:path*", "/forbidden/:path*", "/setup/:path*"],
};
