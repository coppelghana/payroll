import assert from "node:assert/strict";
import test from "node:test";
import { canAccessPath, defaultPathForRole, ROLES } from "../lib/permissions.ts";

test("every configured role has a safe home", () => {
  for (const role of ROLES) assert.equal(canAccessPath(role, defaultPathForRole(role)), true, role);
});

test("employee self-service cannot open company payroll records", () => {
  assert.equal(canAccessPath("Employee", "/my-payroll"), true);
  for (const path of ["/dashboard","/employees","/payroll","/approvals","/settings","/audit"]) {
    assert.equal(canAccessPath("Employee", path), false, path);
  }
});

test("HOD is limited to approval and notification pages", () => {
  assert.equal(canAccessPath("Head of Department", "/approvals"), true);
  assert.equal(canAccessPath("Head of Department", "/notifications"), true);
  assert.equal(canAccessPath("Head of Department", "/payroll"), false);
  assert.equal(canAccessPath("Head of Department", "/employees"), false);
  assert.equal(canAccessPath("Head of Department", "/settings"), false);
});

test("system administration has no payroll preparation or approval route", () => {
  assert.equal(canAccessPath("System Administrator", "/settings"), true);
  assert.equal(canAccessPath("System Administrator", "/audit"), true);
  assert.equal(canAccessPath("System Administrator", "/payroll"), false);
  assert.equal(canAccessPath("System Administrator", "/approvals"), false);
});

test("HR cannot open payroll, approvals, settings or audit", () => {
  assert.equal(canAccessPath("HR / Administrator", "/employees"), true);
  for (const path of ["/payroll","/approvals","/settings","/audit"]) {
    assert.equal(canAccessPath("HR / Administrator", path), false, path);
  }
});

test("only Payroll Officer has payroll register access", () => {
  for (const role of ROLES) assert.equal(canAccessPath(role, "/payroll"), role === "Payroll Officer", role);
});

test("workflow roles have approval access and non-workflow roles do not", () => {
  const allowed = new Set(["Payroll Officer","Head of Department","General Manager","CEO","Payment Officer"]);
  for (const role of ROLES) assert.equal(canAccessPath(role, "/approvals"), allowed.has(role), role);
});
