import express from "express";

// Browsers cap cookie lifetime at 400 days.
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

// The __Host- prefix requires Secure, which plain-http localhost cannot use
// reliably, so it is only used on Vercel.
export function playerCookieName(onVercel = Boolean(process.env.VERCEL)): string {
  return onVercel ? "__Host-rv_player" : "rv_player";
}

export function readPlayerToken(req: express.Request): string | undefined {
  const value = req.cookies?.[playerCookieName()];
  return typeof value === "string" ? value : undefined;
}

export function setPlayerCookie(res: express.Response, token: string) {
  const onVercel = Boolean(process.env.VERCEL);
  res.cookie(playerCookieName(onVercel), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: onVercel,
    path: "/",
    maxAge: MAX_AGE_MS,
  });
}
