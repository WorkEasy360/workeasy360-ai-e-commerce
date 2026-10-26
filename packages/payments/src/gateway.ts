import { createHmac, timingSafeEqual } from "node:crypto";

/** Shared types and helpers for the card gateways. */

export type Provider = "razorpay" | "stripe";

/** fetch, injectable so tests can answer for the gateway. */
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface GatewayCredentials {
  /** Razorpay key_id or Stripe publishable key: safe to show to shoppers. */
  publicKey: string;
  /** Razorpay key_secret or Stripe secret key. */
  secretKey: string;
  /** Signs the gateway's webhooks to us. */
  webhookSecret: string;
}

/** A gateway refused or failed; `code` is safe to log and show, never the gateway's raw message. */
export class GatewayError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(code);
    this.name = "GatewayError";
  }
}

export const GATEWAY_TIMEOUT_MS = 15_000;

export function hmacHex(key: string, payload: string | Buffer): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}

/** Constant-time comparison of two hex signatures. */
export function sameHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Maps a gateway HTTP status to a stable error code. */
export function statusError(provider: Provider, status: number): GatewayError {
  if (status === 401 || status === 403) return new GatewayError(`${provider}_auth_failed`, false, status);
  if (status === 429) return new GatewayError(`${provider}_rate_limited`, true, status);
  if (status >= 500) return new GatewayError(`${provider}_unavailable`, true, status);
  return new GatewayError(`${provider}_rejected`, false, status);
}

export async function call<T>(fetchFn: Fetch, provider: Provider, url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<T> {
  let res;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) });
  } catch {
    throw new GatewayError(`${provider}_unreachable`, true);
  }
  if (res.status < 200 || res.status >= 300) throw statusError(provider, res.status);
  return (await res.json()) as T;
}
