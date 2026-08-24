import { describe, expect, it, vi } from 'vitest'

import { fetchSkillsFromEsi } from '../../workflows/steps/skills/fetch-skills'

import type { Esi } from '@repo/esi'

describe('fetchSkillsFromEsi', () => {
	it('returns wallet balance alongside the skills snapshot', async () => {
		const esi = {
			fetchCharacterSkills: vi.fn().mockResolvedValue({ skills: [], total_sp: 12_345 }),
			fetchCharacterSkillQueue: vi.fn().mockResolvedValue([]),
			fetchCharacterWalletBalance: vi.fn().mockResolvedValue(987_654.32),
		} as unknown as Esi

		await expect(fetchSkillsFromEsi(esi, '123')).resolves.toEqual({
			skills: { skills: [], total_sp: 12_345 },
			skillQueue: [],
			walletBalance: 987_654.32,
		})
	})

	it('keeps the skills snapshot when wallet access is unavailable', async () => {
		const esi = {
			fetchCharacterSkills: vi.fn().mockResolvedValue({ skills: [], total_sp: 12_345 }),
			fetchCharacterSkillQueue: vi.fn().mockResolvedValue([]),
			fetchCharacterWalletBalance: vi.fn().mockRejectedValue(new Error('missing wallet scope')),
		} as unknown as Esi

		await expect(fetchSkillsFromEsi(esi, '123')).resolves.toMatchObject({
			skills: { total_sp: 12_345 },
			skillQueue: [],
			walletBalance: null,
		})
	})
})
