/**
 * Identifier generation.
 *
 * Ids must be unique across collaborating clients, so they combine a time prefix
 * with randomness rather than a local counter — two users creating a card in the
 * same millisecond must not collide.
 */
export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${random}`;
}
