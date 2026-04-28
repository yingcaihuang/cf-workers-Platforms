import { describe, it, expect } from "vitest";
import { validateTitle, validateTenantName, validateStatus } from "./validation";

describe("validateTitle", () => {
  it("returns null for a valid title", () => {
    expect(validateTitle("Buy milk")).toBeNull();
  });

  it("returns error for non-string", () => {
    expect(validateTitle(123)).toBeTruthy();
    expect(validateTitle(null)).toBeTruthy();
    expect(validateTitle(undefined)).toBeTruthy();
  });

  it("returns error for empty string", () => {
    expect(validateTitle("")).toBeTruthy();
  });

  it("returns error for whitespace-only string", () => {
    expect(validateTitle("   ")).toBeTruthy();
    expect(validateTitle("\t\n")).toBeTruthy();
  });

  it("returns null for title exactly 255 characters", () => {
    expect(validateTitle("a".repeat(255))).toBeNull();
  });

  it("returns error for title exceeding 255 characters", () => {
    expect(validateTitle("a".repeat(256))).toBeTruthy();
  });
});

describe("validateTenantName", () => {
  it("returns null for valid names", () => {
    expect(validateTenantName("abc")).toBeNull();
    expect(validateTenantName("tenant-a")).toBeNull();
    expect(validateTenantName("ABC123")).toBeNull();
    expect(validateTenantName("a".repeat(63))).toBeNull();
  });

  it("returns error for non-string", () => {
    expect(validateTenantName(42)).toBeTruthy();
    expect(validateTenantName(null)).toBeTruthy();
  });

  it("returns error for names shorter than 3 characters", () => {
    expect(validateTenantName("ab")).toBeTruthy();
    expect(validateTenantName("a")).toBeTruthy();
  });

  it("returns error for names longer than 63 characters", () => {
    expect(validateTenantName("a".repeat(64))).toBeTruthy();
  });

  it("returns error for names with invalid characters", () => {
    expect(validateTenantName("tenant_a")).toBeTruthy();
    expect(validateTenantName("tenant.a")).toBeTruthy();
    expect(validateTenantName("tenant a")).toBeTruthy();
  });
});

describe("validateStatus", () => {
  it("returns null for pending", () => {
    expect(validateStatus("pending")).toBeNull();
  });

  it("returns null for completed", () => {
    expect(validateStatus("completed")).toBeNull();
  });

  it("returns error for invalid status strings", () => {
    expect(validateStatus("done")).toBeTruthy();
    expect(validateStatus("active")).toBeTruthy();
    expect(validateStatus("")).toBeTruthy();
  });

  it("returns error for non-string", () => {
    expect(validateStatus(null)).toBeTruthy();
    expect(validateStatus(1)).toBeTruthy();
  });
});
