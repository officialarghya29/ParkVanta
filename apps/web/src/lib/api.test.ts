import { describe, expect, it } from "vitest";
import { API_BASE_URL, RequestError, api } from "./api";

describe("api configuration", () => {
  it("resolves a configured base URL in test/dev without throwing", () => {
    expect(typeof API_BASE_URL).toBe("string");
  });

  it("exposes structured RequestError metadata", () => {
    const err = new RequestError(401, "unauthorized", "Authentication required");
    expect(err.status).toBe(401);
    expect(err.code).toBe("unauthorized");
    expect(typeof api).toBe("function");
  });
});
