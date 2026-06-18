import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import flagsRoutes from '../flags'

import type { App } from '../../context'

const { getStubMock, featuresStub } = vi.hoisted(() => ({
	getStubMock: vi.fn(),
	featuresStub: {
		checkFlag: vi.fn(),
	},
}))

vi.mock('@repo/do-utils', () => ({
	getStub: getStubMock,
}))

const env = {
	FEATURES: { name: 'FEATURES' },
} as any

function makeApp() {
	const app = new Hono<App>()
	return app.route('/api/flags', flagsRoutes)
}

beforeEach(() => {
	vi.clearAllMocks()
	featuresStub.checkFlag.mockImplementation(async (key: string) => {
		if (key === 'srp.enabled') return true
		if (key === 'mumble.enabled') return false
		return null
	})
	getStubMock.mockImplementation((namespace: any) => {
		if (namespace === env.FEATURES) return featuresStub as any
		throw new Error('Unexpected namespace')
	})
})

describe('GET /api/flags', () => {
	it('returns UI-facing flags including mumble', async () => {
		const res = await makeApp().request('/api/flags', {}, env)
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({
			'srp.enabled': true,
			'mumble.enabled': false,
		})
	})
})
