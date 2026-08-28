import { auth } from "@/lib/auth/server";

export default auth.middleware({ loginUrl: "/auth/sign-in" });

export const config = {
  matcher: ["/dashboard/:path*", "/employees/:path*", "/payroll/:path*", "/approvals/:path*", "/settings/:path*", "/audit/:path*", "/setup/:path*"],
};
