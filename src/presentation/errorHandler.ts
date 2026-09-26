import express from "express";
import { DomainError } from "../domain/error/domainError";
import { ApplicationError, ApplicationErrorType } from "../application/error/applicationError";
import { SchemaOutOfDateError } from "../infrastructure/migration/schemaCheck";
import { isDatabaseUnavailable } from "../infrastructure/databaseAvailability";
import { describeError } from "./errorLogging";

// Every ApplicationError type must have a status; the compiler enforces it.
export const APPLICATION_ERROR_STATUS: Record<ApplicationErrorType, number> = {
  LatestGameNotFound: 404,
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

  if (err instanceof ApplicationError) {
    res.status(APPLICATION_ERROR_STATUS[err.type]).json({ type: err.type, message: err.message });
    return;
  }

  if (isClientBodyError(err)) {
    res.status(400).json({ type: "InvalidRequest", message: "Request body is not valid JSON" });
    return;
  }

  logServerError(req, err);

  if (err instanceof SchemaOutOfDateError || isDatabaseUnavailable(err)) {
    res.status(503).json({ type: "ServiceUnavailable", message: "Service temporarily unavailable" });
    return;
  }

  res.status(500).send({ message: "Unexpected Error occured" });
}

// body-parser marks errors caused by the request body (malformed JSON, too
// large) with `expose` and a 4xx `status`.
function isClientBodyError(err: any): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    err.expose === true &&
    typeof err.status === "number" &&
    err.status >= 400 &&
    err.status < 500
  );
}

// One JSON line so nested causes are not truncated by the log viewer.
function logServerError(req: express.Request, err: unknown) {
  console.error(
    `Request failed: ${JSON.stringify({ method: req.method, path: req.path, error: describeError(err) })}`,
  );
}
