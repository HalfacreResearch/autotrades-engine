import { describe, it, expect } from "vitest";

describe("Database connectivity secrets", () => {
  it("TRADINGHQ_DATABASE_URL is set and has correct format", () => {
    const url = process.env.TRADINGHQ_DATABASE_URL;
    expect(url).toBeDefined();
    expect(url).toMatch(/^mysql:\/\//);
    expect(url).toContain("187.124.149.19");
    expect(url).toContain("tradinghq");
  });

  it("CLIENT_PORTAL_DATABASE_URL is set and has correct format", () => {
    const url = process.env.CLIENT_PORTAL_DATABASE_URL;
    expect(url).toBeDefined();
    expect(url).toMatch(/^mysql:\/\//);
    expect(url).toContain("187.124.149.19");
    expect(url).toContain("codex_portal");
  });

  it("AUTOTRADES_SECRET is set and non-empty", () => {
    const secret = process.env.AUTOTRADES_SECRET;
    expect(secret).toBeDefined();
    expect(secret!.length).toBeGreaterThan(10);
  });
});
