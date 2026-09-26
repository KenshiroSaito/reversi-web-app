import { expect, test } from "@playwright/test";
import { startGame, stones } from "./support";

test("a move request without the CSRF header is rejected", async ({ page }) => {
  const gameId = await startGame(page);

  const result = await page.evaluate(async (id) => {
    const response = await fetch(`/api/games/${id}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnCount: 1, move: { x: 4, y: 2 } }),
    });
    return { status: response.status, body: await response.json() };
  }, gameId);

  expect(result.status).toBe(403);
  expect(result.body.type).toBe("CsrfRejected");
  await page.reload();
  await expect(stones(page)).toHaveCount(4);
});
