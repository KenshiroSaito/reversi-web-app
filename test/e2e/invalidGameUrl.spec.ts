import { expect, test } from "@playwright/test";
import { squares } from "./support";

// Checkpoint review finding: a malformed ?id= used to leave a broken board
// (empty id → TypeError) or a generic error instead of "Game not found".
for (const id of ["", "abc", "0", "01", "1e3", "2147483648"]) {
  test(`a game URL with ?id=${id} shows the not-found page`, async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await page.goto(`/game/?id=${id}`);

    await expect(page.locator("#next-disc-message")).toHaveText("Game not found");
    await expect(squares(page)).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
}
