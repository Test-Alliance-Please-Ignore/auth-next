import { describe, expect, it, vi } from 'vitest'

import { PasteService } from '../paste.service'

describe('PasteService authorization and throttling', () => {
	it('does not allow non-owner non-admin delete', async () => {
		const bucket = { delete: vi.fn() }
		const db = {
			query: {
				pastes: {
					findFirst: vi.fn().mockResolvedValue({
						id: 'paste-1',
						createdByUserId: 'owner-1',
						r2Key: 'pastes/2026/05/paste-1.txt',
					}),
				},
			},
			delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
		}
		const service = new PasteService(db as any, bucket as any, {} as any)

		const deleted = await service.deletePaste({
			pasteId: 'paste-1',
			actorUserId: 'other-user',
			isAdmin: false,
		})

		expect(deleted).toBe(false)
		expect(bucket.delete).not.toHaveBeenCalled()
		expect(db.delete).not.toHaveBeenCalled()
	})

	it('allows admin delete for non-owner paste', async () => {
		const where = vi.fn().mockResolvedValue(undefined)
		const bucket = { delete: vi.fn().mockResolvedValue(undefined) }
		const db = {
			query: {
				pastes: {
					findFirst: vi.fn().mockResolvedValue({
						id: 'paste-1',
						createdByUserId: 'owner-1',
						r2Key: 'pastes/2026/05/paste-1.txt',
					}),
				},
			},
			delete: vi.fn(() => ({ where })),
		}
		const service = new PasteService(db as any, bucket as any, {} as any)

		const deleted = await service.deletePaste({
			pasteId: 'paste-1',
			actorUserId: 'admin-user',
			isAdmin: true,
		})

		expect(deleted).toBe(true)
		expect(bucket.delete).toHaveBeenCalledWith('pastes/2026/05/paste-1.txt')
		expect(db.delete).toHaveBeenCalledTimes(1)
		expect(where).toHaveBeenCalledTimes(1)
	})

	it('permits public decrypt attempts when KV throttle binding is unavailable', async () => {
		const service = new PasteService({} as any, {} as any, undefined as any)
		await expect(service.canAttemptPublicDecrypt({ attemptKey: '1.2.3.4:paste-1' })).resolves.toBe(true)
	})
})

