/**
 * Helpers for building safe SQL LIKE prefix patterns.
 *
 * Kept pure (no database / no drizzle) so the escaping rules can be unit
 * tested deterministically.
 */

/**
 * Escape the LIKE wildcard metacharacters (`%`, `_`) and the escape character
 * (`\`) in a user-supplied prefix so the prefix matches literally.
 *
 * Postgres LIKE treats `\` as the default escape character, so escaping each
 * metacharacter with a backslash makes it match itself rather than acting as a
 * wildcard. Without this, a prefix such as `user_a` would treat `_` as a
 * single-character wildcard and over-match keys like `userXa`.
 *
 * @param prefix - The literal prefix supplied by the caller
 * @returns The prefix with LIKE metacharacters escaped
 */
export function escapeLikePrefix(prefix: string): string {
	return prefix.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/**
 * Build a LIKE pattern that matches keys starting with `prefix` literally.
 *
 * @param prefix - The literal prefix supplied by the caller
 * @returns A LIKE pattern (escaped prefix followed by a trailing `%` wildcard)
 */
export function likePrefixPattern(prefix: string): string {
	return `${escapeLikePrefix(prefix)}%`
}
