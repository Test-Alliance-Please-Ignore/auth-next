import { describe, expect, it } from 'vitest'

import { shouldUseFullPageAuthRedirect } from '@/lib/auth-redirect'

describe('auth callback redirect handling', () => {
	it('uses a browser navigation for absolute OAuth authorize URLs', () => {
		expect(
			shouldUseFullPageAuthRedirect(
				'https://pleaseignore.app/authorize?response_type=code&client_id=client&state=state'
			)
		).toBe(true)
	})

	it('uses SPA navigation for ordinary internal destinations', () => {
		expect(shouldUseFullPageAuthRedirect('/dashboard')).toBe(false)
	})

	it('keeps server-rendered destinations on a full browser navigation', () => {
		expect(shouldUseFullPageAuthRedirect('/login?redirect=%2Fauthorize')).toBe(true)
		expect(shouldUseFullPageAuthRedirect('/invite/invite-code')).toBe(true)
	})
})
