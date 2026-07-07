import { describe, expect, it } from 'vitest'

import { escapeLikePrefix, likePrefixPattern } from './prefix'

describe('escapeLikePrefix', () => {
	it('leaves a plain prefix unchanged', () => {
		expect(escapeLikePrefix('notifications.email')).toBe('notifications.email')
	})

	it('escapes underscores so they match literally instead of as single-char wildcards', () => {
		expect(escapeLikePrefix('user_a')).toBe('user\\_a')
	})

	it('escapes percent signs so they match literally instead of as multi-char wildcards', () => {
		expect(escapeLikePrefix('100%')).toBe('100\\%')
	})

	it('escapes backslashes (the escape character itself)', () => {
		expect(escapeLikePrefix('a\\b')).toBe('a\\\\b')
	})

	it('escapes multiple metacharacters in one prefix', () => {
		expect(escapeLikePrefix('a_b%c')).toBe('a\\_b\\%c')
	})
})

describe('likePrefixPattern', () => {
	it('appends an unescaped trailing wildcard to the escaped prefix', () => {
		expect(likePrefixPattern('user_a')).toBe('user\\_a%')
	})

	it('produces a plain prefix pattern when there are no metacharacters', () => {
		expect(likePrefixPattern('mumble')).toBe('mumble%')
	})
})
