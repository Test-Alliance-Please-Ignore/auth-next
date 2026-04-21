import { describe, expect, it, vi } from 'vitest'

import { generateSrpFriendlyToken } from './srp-token'

vi.mock('@marianmeres/random-human-readable', () => ({
	getRandomHumanReadable: vi.fn(),
}))

describe('generateSrpFriendlyToken', () => {
	it('joins generated parts into PascalCase without separators', async () => {
		const { getRandomHumanReadable } = await import('@marianmeres/random-human-readable')
		vi.mocked(getRandomHumanReadable).mockReturnValue([
			'fleet',
			'staging_system',
			'front-line',
		] as never)

		const token = generateSrpFriendlyToken()
		expect(token).toBe('FleetStagingSystemFrontLine')
	})
})
