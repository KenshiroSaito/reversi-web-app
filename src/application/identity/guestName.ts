import { randomInt } from "node:crypto";

/** "Guest 1000" to "Guest 9999". Not unique; the player ID identifies a guest. */
export function generateGuestName(
  random: (min: number, max: number) => number = randomInt,
): string {
  return `Guest ${random(1000, 10000)}`;
}
