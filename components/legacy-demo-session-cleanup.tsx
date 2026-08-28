"use client";

import { useEffect } from "react";

/**
 * Remove credentials and payroll data created by the retired browser-only demo.
 * Production authorization is provided exclusively by Neon Auth and user_profiles.
 */
export function LegacyDemoSessionCleanup() {
  useEffect(() => {
    window.sessionStorage.removeItem("coppel-session");
    window.localStorage.removeItem("coppel-payroll-db");
  }, []);

  return null;
}
