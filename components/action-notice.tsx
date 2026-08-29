"use client";

import { useSearchParams } from "next/navigation";

export function ActionNotice() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const success = searchParams.get("success");

  if (!error && !success) return null;

  return (
    <div className={error ? "error-box" : "info-box"} role={error ? "alert" : "status"}>
      {error || success}
    </div>
  );
}
