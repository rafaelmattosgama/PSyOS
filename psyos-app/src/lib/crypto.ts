import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const DELIMITER = ".";

function toBase64(input: Uint8Array): string {
  return Buffer.from(input).toString("base64");
}

function fromBase64(input: string): Buffer {
  return Buffer.from(input, "base64");
}

export function getMasterKek(): Buffer {
  const encoded = process.env.MASTER_KEK_B64;
  if (!encoded) {
    throw new Error("MASTER_KEK_B64 is not configured");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("MASTER_KEK_B64 must be 32 bytes base64");
  }
  return key;
}

export function generateDek(): Buffer {
  return randomBytes(32);
}

export function encryptDek(dek: Buffer, masterKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [toBase64(iv), toBase64(authTag), toBase64(ciphertext)].join(DELIMITER);
}

export function decryptDek(packed: string, masterKey: Buffer): Buffer {
  const [ivB64, tagB64, cipherB64] = packed.split(DELIMITER);
  if (!ivB64 || !tagB64 || !cipherB64) {
    throw new Error("Invalid encrypted DEK format");
  }
  const iv = fromBase64(ivB64);
  const authTag = fromBase64(tagB64);
  const ciphertext = fromBase64(cipherB64);
  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptMessage(plaintext: string, dek: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
    authTag: toBase64(authTag),
  };
}

export function decryptMessage(
  ciphertext: string,
  iv: string,
  authTag: string,
  dek: Buffer,
): string {
  const decipher = createDecipheriv("aes-256-gcm", dek, fromBase64(iv));
  decipher.setAuthTag(fromBase64(authTag));
  const plaintext = Buffer.concat([
    decipher.update(fromBase64(ciphertext)),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
