import { expect, test } from "@playwright/test";
import { boardSignature, clickSquare, startGame, stones } from "./support";

test("a stale second tab re-renders the latest board instead of failing", async ({ context }) => {
  const first = await context.newPage();
  const gameId = await startGame(first);
  const second = await context.newPage();
  await second.goto(`/game/?id=${gameId}`);
  await expect(stones(second)).toHaveCount(4);

  await clickSquare(first, 4, 2);
  await expect(stones(first)).toHaveCount(5);

  // The second tab still shows the opening and tries the same move: 409, then refresh.
  await clickSquare(second, 4, 2);

  await expect(stones(second)).toHaveCount(5);
  await expect(second.locator("#next-disc-message")).toHaveText("Next: White turn");
  expect(await boardSignature(second)).toEqual(await boardSignature(first));
});
