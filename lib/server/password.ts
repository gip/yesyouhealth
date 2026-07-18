import { randomBytes } from "node:crypto";

import { argon2idAsync } from "@noble/hashes/argon2.js";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1_024;

// Server-grade parameters: stronger than the browser KDF in
// lib/browser-encryption.ts because hashing happens off the UI thread.
const ARGON2ID_MEMORY_KIB = 64 * 1_024;
const ARGON2ID_ITERATIONS = 3;
const ARGON2ID_PARALLELISM = 1;
const HASH_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;
const ENCODING_VERSION = 1;

const encoder = new TextEncoder();

interface ParsedHash {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Use a password with no more than ${MAX_PASSWORD_LENGTH.toLocaleString()} characters.`);
  }
}

async function derive(
  password: string,
  salt: Uint8Array,
  params: { memoryKiB: number; iterations: number; parallelism: number; hashLength: number },
): Promise<Uint8Array> {
  const passwordBytes = encoder.encode(password.normalize("NFKC"));
  try {
    return await argon2idAsync(passwordBytes, salt, {
      m: params.memoryKiB,
      t: params.iterations,
      p: params.parallelism,
      dkLen: params.hashLength,
    });
  } finally {
    passwordBytes.fill(0);
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = new Uint8Array(randomBytes(SALT_LENGTH_BYTES));
  const hash = await derive(password, salt, {
    memoryKiB: ARGON2ID_MEMORY_KIB,
    iterations: ARGON2ID_ITERATIONS,
    parallelism: ARGON2ID_PARALLELISM,
    hashLength: HASH_LENGTH_BYTES,
  });
  try {
    return [
      "",
      "argon2id",
      `v=${ENCODING_VERSION}`,
      `m=${ARGON2ID_MEMORY_KIB},t=${ARGON2ID_ITERATIONS},p=${ARGON2ID_PARALLELISM}`,
      Buffer.from(salt).toString("base64"),
      Buffer.from(hash).toString("base64"),
    ].join("$");
  } finally {
    hash.fill(0);
  }
}

function parseEncodedHash(encoded: string): ParsedHash | null {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "" || parts[1] !== "argon2id") return null;
  if (parts[2] !== `v=${ENCODING_VERSION}`) return null;
  const paramsMatch = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(parts[3] ?? "");
  if (!paramsMatch) return null;
  const memoryKiB = Number(paramsMatch[1]);
  const iterations = Number(paramsMatch[2]);
  const parallelism = Number(paramsMatch[3]);
  if (memoryKiB < 8 || iterations < 1 || parallelism < 1) return null;
  let salt: Uint8Array;
  let hash: Uint8Array;
  try {
    salt = new Uint8Array(Buffer.from(parts[4] ?? "", "base64"));
    hash = new Uint8Array(Buffer.from(parts[5] ?? "", "base64"));
  } catch {
    return null;
  }
  if (salt.byteLength < 8 || hash.byteLength < 16) return null;
  return { memoryKiB, iterations, parallelism, salt, hash };
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parseEncodedHash(encoded);
  if (!parsed) return false;
  if (password.length < 1 || password.length > MAX_PASSWORD_LENGTH) return false;
  const candidate = await derive(password, parsed.salt, {
    memoryKiB: parsed.memoryKiB,
    iterations: parsed.iterations,
    parallelism: parsed.parallelism,
    hashLength: parsed.hash.byteLength,
  });
  try {
    if (candidate.byteLength !== parsed.hash.byteLength) return false;
    let diff = 0;
    for (let index = 0; index < candidate.byteLength; index += 1) {
      diff |= (candidate[index] ?? 0) ^ (parsed.hash[index] ?? 0);
    }
    return diff === 0;
  } finally {
    candidate.fill(0);
  }
}
