import { expect, test } from "@playwright/test";
import { boardSignature, clickSquare, stones } from "./support";

// Legal in sequence from the opening: black, white, black, white.
const MOVES: [number, number][] = [
  [4, 2],
  [3, 2],
  [2, 2],
  [5, 4],
];

test("a local game resumes at the same position after a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Start a Match" }).click();
  await expect(page).toHaveURL(/\/game\/\?id=\d+$/);
  await expect(stones(page)).toHaveCount(4);

  for (const [index, [x, y]] of MOVES.entries()) {
    await clickSquare(page, x, y);
    await expect(stones(page)).toHaveCount(5 + index);
  }
  await expect(page.locator("#next-disc-message")).toHaveText("Next: Black turn");
  const url = page.url();
  const before = await boardSignature(page);

  await page.reload();

  await expect(stones(page)).toHaveCount(8);
  expect(page.url()).toBe(url);
  expect(await boardSignature(page)).toEqual(before);
  await expect(page.locator("#next-disc-message")).toHaveText("Next: Black turn");
});
