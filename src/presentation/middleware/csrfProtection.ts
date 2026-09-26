import express from "express";

export class CsrfRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsrfRejectedError";
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_HEADER = "x-requested-with";
const CSRF_HEADER_VALUE = "reversi";

/**
 * On top of SameSite=Lax cookies: a custom header forces a CORS preflight for
 * cross-origin scripts (which this API never approves) and cannot be set by
 * an HTML form, and the Origin must be this site.
 */
export function csrfProtection(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
) {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    next(new CsrfRejectedError("Missing or invalid X-Requested-With header"));
    return;
  }
  const origin = req.get("origin");
  if (!origin || origin !== expectedOrigin(req)) {
    next(new CsrfRejectedError("Cross-origin request rejected"));
    return;
  }
  next();
}

function expectedOrigin(req: express.Request): string {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0].trim();
  return `${forwardedProto || req.protocol}://${req.get("host")}`;
}
