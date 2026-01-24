import argon2 from "argon2";

const MIN_LENGTH = 12;

export function isPasswordStrong(password: string) {
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  return (
    password.length >= MIN_LENGTH &&
    hasUpper &&
    hasLower &&
    hasNumber &&
    hasSymbol
  );
}

export async function hashPassword(password: string) {
  return argon2.hash(password, {
    type: argon2.argon2id,
  });
}

export async function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}
