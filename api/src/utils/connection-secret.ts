import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { env } from "../config/env.js";

const SECRET_FORMAT_VERSION = "v1";
const IV_LENGTH = 12;

function getKey() {
  // Derive a stable 32-byte key from env material.
  return createHash("sha256").update(env.CONNECTION_SECRET_KEY, "utf8").digest();
}

export function encryptConnectionSecret(plainText: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    SECRET_FORMAT_VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64")
  ].join(":");
}

export function decryptConnectionSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = String(payload || "").split(":");
  if (version !== SECRET_FORMAT_VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Unsupported encrypted secret format");
  }

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}
