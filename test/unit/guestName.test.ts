import { describe, expect, it } from "vitest";
import { generateGuestName } from "../../src/application/identity/guestName";

describe("generateGuestName", () => {
  it("formats the number drawn from 1000 to 9999", () => {
    const calls: [number, number][] = [];
    const name = generateGuestName((min, max) => {
      calls.push([min, max]);
      return 4821;
    });

    expect(name).toBe("Guest 4821");
    expect(calls).toEqual([[1000, 10000]]);
  });

  it("uses a secure random source by default", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateGuestName()).toMatch(/^Guest [1-9][0-9]{3}$/);
    }
  });
});
