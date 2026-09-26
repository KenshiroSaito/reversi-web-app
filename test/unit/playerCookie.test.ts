import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { playerCookieName, setPlayerCookie } from "../../src/presentation/identity/playerCookie";

function captureCookie(): { name?: string; value?: string; options?: express.CookieOptions; res: express.Response } {
  const captured: { name?: string; value?: string; options?: express.CookieOptions; res: express.Response } = {
    res: undefined as unknown as express.Response,
  };
  captured.res = {
    cookie(name: string, value: string, options: express.CookieOptions) {
      Object.assign(captured, { name, value, options });
      return captured.res;
    },
  } as unknown as express.Response;
  return captured;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("player cookie", () => {
  it("is a plain, non-Secure cookie locally", () => {
    vi.stubEnv("VERCEL", "");
    const captured = captureCookie();

    setPlayerCookie(captured.res, "token");

    expect(playerCookieName()).toBe("rv_player");
    expect(captured).toMatchObject({
      name: "rv_player",
      value: "token",
      options: { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 400 * 24 * 60 * 60 * 1000 },
    });
  });

  it("uses the __Host- prefix and Secure on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    const captured = captureCookie();

    setPlayerCookie(captured.res, "token");

    expect(playerCookieName()).toBe("__Host-rv_player");
    expect(captured).toMatchObject({ name: "__Host-rv_player", options: { secure: true, path: "/" } });
  });
});
