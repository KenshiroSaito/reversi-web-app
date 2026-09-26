import express from "express";
import { DomainError } from "../domain/error/domainError";
import { ApplicationError, ApplicationErrorType } from "../application/error/applicationError";
import { SchemaOutOfDateError } from "../infrastructure/migration/schemaCheck";
import { isDatabaseUnavailable } from "../infrastructure/databaseAvailability";
import { describeError } from "./errorLogging";
import { ValidationError } from "./validation";
import { CsrfRejectedError } from "./middleware/csrfProtection";

// Every ApplicationError type must have a status; the compiler enforces it.
export const APPLICATION_ERROR_STATUS: Record<ApplicationErrorType, number> = {
  PlayerNotFound: 404,
  GuestCreationLimitReached: 429,
  GameNotFound: 404,
  NotYourTurn: 409,
  StaleTurn: 409,
  GameAlreadyEnded: 409,
  GameCreationLimitReached: 429,
};

export function errorHandler(
  err: any,
  req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) {
  if (err instanceof DomainError) {
    res.status(400).json({ type: err.type, message: err.message });
    return;
  }

  if (err instanceof ValidationError) {
    res.status(400).json({ type: "InvalidRequest", message: err.message });
    return;
  }

  if (err instanceof CsrfRejectedError) {
    res.status(403).json({ type: "CsrfRejected", message: err.message });
    return;
  }

  if (err instanceof ApplicationError) {
    res.status(APPLICATION_ERROR_STATUS[err.type]).json({ type: err.type, message: err.message });
    return;
  }

  const clientStatus = clientErrorStatus(err);
  if (clientStatus !== undefined) {
    res.status(clientStatus).json({ type: "InvalidRequest", message: clientErrorMessage(err, clientStatus) });
    return;
  }

  logServerError(req, err);

  if (err instanceof SchemaOutOfDateError || isDatabaseUnavailable(err)) {
    res.status(503).json({ type: "ServiceUnavailable", message: "Service temporarily unavailable" });
    return;
  }

  res.status(500).send({ message: "Unexpected Error occured" });
}

// Errors caused by the request itself carry a 4xx `status`: body-parser's
// (malformed JSON, too large, bad charset) and Express's own (a path
// parameter that is not valid percent-encoding). Our own errors and mysql2's
// never set one.
function clientErrorStatus(err: any): number | undefined {
  const status = typeof err === "object" && err !== null ? err.status ?? err.statusCode : undefined;
  return typeof status === "number" && status >= 400 && status < 500 ? status : undefined;
}

function clientErrorMessage(err: any, status: number): string {
  if (err.type === "entity.parse.failed") {
    return "Request body is not valid JSON";
  }
  if (status === 413) {
    return "Request body is too large";
  }
  if (status === 415) {
    return "Unsupported request body encoding";
  }
  return "Invalid request";
}

// One JSON line so nested causes are not truncated by the log viewer.
function logServerError(req: express.Request, err: unknown) {
  console.error(
    `Request failed: ${JSON.stringify({ method: req.method, path: req.path, error: describeError(err) })}`,
  );
}
