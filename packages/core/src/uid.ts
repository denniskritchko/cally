/**
 * Deterministic IDs. Same upstream object always maps to the same UID, so
 * every write downstream is idempotent even if our mapping tables are lost.
 *
 * FNV-1a 64-bit over a short string is plenty: we're not defending against
 * adversarial collisions, only ensuring stability. Runs anywhere (no crypto
 * import) so the extension and server agree byte-for-byte.
 */
export function fnv1a64(input: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(input);
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

export function eventUid(source: string, externalId: string, host: string): string {
  return `cally-${fnv1a64(`${source}:${host}:${externalId}`)}@cally`;
}

/**
 * Google Calendar event IDs must match /^[a-v0-9]{5,1024}$/ (base32hex).
 * Hex is a strict subset, so a hex digest is a valid, deterministic Google id.
 */
export function googleEventId(uid: string): string {
  return `ca11${fnv1a64(uid)}${fnv1a64(uid + '#2')}`;
}
