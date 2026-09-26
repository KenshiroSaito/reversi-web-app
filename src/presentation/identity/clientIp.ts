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

/**
 * Keyed so the stored value cannot be reversed by hashing every IPv4 address.
 * Hashes the rate-limit key, not the raw address: see clientKey.
 */
export function hashClientIp(ip: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(clientKey(ip)).digest();
}

const IPV4_MAPPED_PREFIX = "::ffff:";

/**
 * One key per client for the per-IP caps. An IPv6 host normally owns a whole
 * /64 and can rotate through it freely, so IPv6 addresses are reduced to
 * their /64 prefix; IPv4-mapped IPv6 addresses count as the IPv4 address.
 */
function clientKey(ip: string): string {
  const address = ip.split("%")[0].toLowerCase();
  if (address.startsWith(IPV4_MAPPED_PREFIX) && address.includes(".")) {
    return address.slice(IPV4_MAPPED_PREFIX.length);
  }
  if (!address.includes(":")) {
    return address;
  }
  const groups = expandIpv6(address);
  if (!groups) {
    return address;
  }
  return `${groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16)).join(":")}::/64`;
}

/** The eight 16-bit groups of an IPv6 address, or undefined if it is malformed. */
function expandIpv6(address: string): string[] | undefined {
  const halves = address.split("::");
  if (halves.length > 2) {
    return undefined;
  }
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  // A trailing embedded IPv4 address (a.b.c.d) takes the place of two groups.
  const groupCount = (parts: string[]) => parts.reduce((n, part) => n + (part.includes(".") ? 2 : 1), 0);
  const missing = 8 - groupCount(head) - groupCount(tail);
  if (halves.length === 1 ? missing !== 0 : missing < 1) {
    return undefined;
  }
  const groups = [...head, ...Array(missing).fill("0"), ...tail];
  return groups.slice(0, 4).every((group) => /^[0-9a-f]{1,4}$/.test(group)) ? groups : undefined;
}
