import { hash, verify } from 'argon2';

/**
 * node-argon2's defaults are already the OWASP baseline (argon2id, 64 MiB,
 * 3 passes, parallelism 4), so we pass no options — a hand-tuned set here would
 * only ever drift below what the library ships.
 */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

/**
 * Argument order is load-bearing: verify() takes the DIGEST first and the
 * plaintext second. Reversed, it returns false rather than throwing, which is
 * an authentication bug that passes casual testing.
 *
 * Never throws on a malformed hash either — a corrupt row must read as "wrong
 * password", not as a 500 that reveals the account exists.
 */
export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain);
  } catch {
    return false;
  }
}
