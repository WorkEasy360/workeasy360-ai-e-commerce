import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Gateway credentials at rest: AES-256-GCM under SECRETS_ENCRYPTION_KEY,
 * held by the API and the worker only, so a database dump alone can't take
 * payments or refunds. Format: v1:<iv>:<tag>:<ciphertext>, base64url parts.
 */
export function parseSecretKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("SECRETS_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptSecret(stored: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Unrecognized secret format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

/** Shows that a secret is set without revealing it: "••••••3f9a". */
export function maskSecret(plain: string): string {
  return plain.length <= 4 ? "••••" : `••••••${plain.slice(-4)}`;
}
