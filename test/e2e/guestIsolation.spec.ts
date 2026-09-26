import { expect, test } from "@playwright/test";
import { POST_HEADERS, squares, startGame, stones } from "./support";

test("another guest gets the not-found page and cannot move", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  try {
    const pageA = await contextA.newPage();
    const gameId = await startGame(pageA);

    const pageB = await contextB.newPage();
    await startGame(pageB); // B is a guest with its own cookie
    await pageB.goto(`/game/?id=${gameId}`);

    await expect(pageB.locator("#next-disc-message")).toHaveText("Game not found");
    await expect(squares(pageB)).toHaveCount(0);

    const status = await pageB.evaluate(
      async ({ id, headers }) => {
        const response = await fetch(`/api/games/${id}/turns`, {
          method: "POST",
          headers,
          body: JSON.stringify({ turnCount: 1, move: { x: 4, y: 2 } }),
        });
        return response.status;
      },
      { id: gameId, headers: POST_HEADERS },
    );
    expect(status).toBe(404);

    await pageA.reload();
    await expect(stones(pageA)).toHaveCount(4);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
