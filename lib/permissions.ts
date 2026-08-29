export const ROLES = [
  "Payroll Officer",
  "Head of Department",
  "General Manager",
  "CEO",
  "Payment Officer",
  "HR / Administrator",
  "System Administrator",
  "Employee",
] as const;

export type Role = (typeof ROLES)[number];

const ROLE_PATHS: Record<Role, readonly string[]> = {
  "System Administrator": ["/dashboard", "/employees", "/notifications", "/audit", "/settings", "/forbidden"],
  "HR / Administrator": ["/dashboard", "/employees", "/notifications", "/forbidden"],
  "Payroll Officer": ["/dashboard", "/payroll", "/approvals", "/notifications", "/settings", "/forbidden"],
  "Head of Department": ["/dashboard", "/approvals", "/notifications", "/forbidden"],
  "General Manager": ["/dashboard", "/approvals", "/notifications", "/forbidden"],
  "CEO": ["/dashboard", "/approvals", "/notifications", "/forbidden"],
  "Payment Officer": ["/dashboard", "/approvals", "/notifications", "/forbidden"],
  "Employee": ["/my-payroll", "/notifications", "/forbidden"],
};

export function canAccessPath(role: Role, path: string) {
  return ROLE_PATHS[role].some((allowed) => path === allowed || path.startsWith(`${allowed}/`));
}

export function navigationForRole(role: Role) {
  return ROLE_PATHS[role].filter((path) => path !== "/forbidden");
}

export function defaultPathForRole(role: Role) {
  if (role === "Employee") return "/my-payroll";
  if (role === "HR / Administrator") return "/employees";
  return "/dashboard";
}
