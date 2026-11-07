import { describe, expect, it } from "vitest";
import { extractPassToken, titleCase, toDateTimeLocal } from "./format";

describe("extractPassToken", () => {
  it("accepts a raw token", () => {
    expect(extractPassToken("abc123TOKEN")).toBe("abc123TOKEN");
  });

  it("extracts the token from a visitor URL", () => {
    expect(extractPassToken("http://localhost:5173/pass/abc123TOKEN")).toBe("abc123TOKEN");
  });

  it("strips query strings and fragments", () => {
    expect(extractPassToken("https://parkvanta.app/pass/abc123?from=qr#top")).toBe("abc123");
  });
});

describe("titleCase", () => {
  it("renders enum values for humans", () => {
    expect(titleCase("SERVICE_TECHNICIAN")).toBe("Service Technician");
  });
});

describe("toDateTimeLocal", () => {
  it("returns a datetime-local compatible string", () => {
    const value = toDateTimeLocal(new Date("2026-01-02T03:04:00Z"));
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});
