import type { Metadata } from "next";
import { LegacyDemoSessionCleanup } from "@/components/legacy-demo-session-cleanup";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Coppel Payroll", template: "%s · Coppel Payroll" },
  description: "Secure payroll management for Coppel Company Limited",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><LegacyDemoSessionCleanup />{children}</body></html>;
}
