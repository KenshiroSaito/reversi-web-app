import { expect, Page } from "@playwright/test";

export const POST_HEADERS = { "Content-Type": "application/json", "X-Requested-With": "reversi" };

export function squares(page: Page) {
  return page.locator("#board .square");
}

export function stones(page: Page) {
  return page.locator("#board .stone");
}

/** Opens /game/, which starts a new game, and waits for the initial board. */
export async function startGame(page: Page): Promise<string> {
  await page.goto("/game/");
  await expect(page).toHaveURL(/\/game\/\?id=\d+$/);
  await expect(stones(page)).toHaveCount(4);
  return new URL(page.url()).searchParams.get("id")!;
}

export async function clickSquare(page: Page, x: number, y: number) {
  await squares(page).nth(y * 8 + x).click();
}

/** Each square's stone class ("stone dark", "stone light", or "") in board order. */
export async function boardSignature(page: Page): Promise<string[]> {
  return squares(page).evaluateAll((elements) =>
    elements.map((element) => element.querySelector(".stone")?.className ?? ""),
  );
}
