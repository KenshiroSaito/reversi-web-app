import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../src/infrastructure/migration/migrations";

describe("MIGRATIONS", () => {
  it("has unique, ordered, well-formed versions", () => {
    const versions = MIGRATIONS.map((m) => m.version);

    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort()).toEqual(versions);
    for (const version of versions) {
      expect(version).toMatch(/^[0-9]{3}_[a-z0-9_]+$/);
      expect(version.length).toBeLessThanOrEqual(64);
    }
  });

  it("gives every migration at least one statement", () => {
    for (const migration of MIGRATIONS) {
      expect(migration.statements.length).toBeGreaterThan(0);
    }
  });
});
