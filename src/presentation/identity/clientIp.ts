import { createHmac } from "node:crypto";
import express from "express";

/**
 * Vercel overwrites X-Forwarded-For and sets x-real-ip to the same value, so
 * the header can be trusted there. Anywhere else forwarding headers are
 * client-controlled, and the socket address is used.
 */
export function clientIpOf(req: express.Request, onVercel: boolean): string {
  if (onVercel) {
    const header = req.headers["x-real-ip"];
    if (typeof header === "string" && header !== "") {
      return header;
    }
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Keyed so the stored value cannot be reversed by hashing every IPv4 address. */
export function hashClientIp(ip: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(ip).digest();
}
