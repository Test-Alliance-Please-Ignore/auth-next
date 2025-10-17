import { SELF, env } from 'cloudflare:test'
import { describe, expect, test } from 'vitest'

import { getStub } from '@repo/do-utils'
import type { CharacterDataStore } from '@repo/character-data-store'
import type { Env } from '../../context'

import '../..'

// Type assertion for env to include our bindings
const testEnv = env as unknown as Env

describe('Character and Corporation Data Tracking', () => {
	describe('CharacterDataStore', () => {
		test('upserts character data and tracks changes', async () => {
			const dataStore = getStub<CharacterDataStore>(testEnv.CHARACTER_DATA_STORE, 'test-upsert-character')
			const characterId = 123456
			const now = Date.now()
			const expiresAt = now + 3600 * 1000

			// Insert initial character
			const character1 = await dataStore.upsertCharacter(
				characterId,
				{
					name: 'Test Character',
					corporation_id: 98000001,
					alliance_id: 99000001,
					security_status: 5.0,
					birthday: '2010-01-01T00:00:00Z',
					gender: 'male',
					race_id: 1,
					bloodline_id: 1,
					ancestry_id: 1,
					description: 'Test description',
				},
				expiresAt
			)

			expect(character1).toBeDefined()
			expect(character1.character_id).toBe(characterId)
			expect(character1.name).toBe('Test Character')
			expect(character1.corporation_id).toBe(98000001)
			expect(character1.update_count).toBe(1)

			// Update character with corporation change
			const character2 = await dataStore.upsertCharacter(
				characterId,
				{
					name: 'Test Character',
					corporation_id: 98000002, // Changed corporation
					alliance_id: 99000001,
					security_status: 5.0,
					birthday: '2010-01-01T00:00:00Z',
					gender: 'male',
					race_id: 1,
					bloodline_id: 1,
					ancestry_id: 1,
					description: 'Test description',
				},
				expiresAt
			)

			expect(character2.corporation_id).toBe(98000002)
			expect(character2.update_count).toBe(2)

			// Check history for corporation change
			const history = await dataStore.getCharacterHistory(characterId)
			expect(history.length).toBeGreaterThan(0)

			const corpChange = history.find((h: { field_name: string }) => h.field_name === 'corporation_id')
			expect(corpChange).toBeDefined()
			expect(corpChange?.old_value).toBe('98000001')
			expect(corpChange?.new_value).toBe('98000002')
		})

		test('upserts corporation data', async () => {
			const dataStore = getStub<CharacterDataStore>(testEnv.CHARACTER_DATA_STORE, 'test-upsert-corporation')

			const corporationId = 98000001
			const now = Date.now()
			const expiresAt = now + 3600 * 1000

			const corporation = await dataStore.upsertCorporation(
				corporationId,
				{
					name: 'Test Corporation',
					ticker: 'TEST',
					member_count: 100,
					ceo_id: 123456,
					creator_id: 123456,
					date_founded: '2010-01-01T00:00:00Z',
					tax_rate: 0.1,
					url: 'https://example.com',
					description: 'Test corp',
					alliance_id: 99000001,
				},
				expiresAt
			)

			expect(corporation).toBeDefined()
			expect(corporation.corporation_id).toBe(corporationId)
			expect(corporation.name).toBe('Test Corporation')
			expect(corporation.ticker).toBe('TEST')
			expect(corporation.member_count).toBe(100)
			expect(corporation.update_count).toBe(1)
		})

		test('retrieves character by ID', async () => {
			const dataStore = getStub<CharacterDataStore>(testEnv.CHARACTER_DATA_STORE, 'test-retrieve-character')

			const characterId = 123456
			const now = Date.now()
			const expiresAt = now + 3600 * 1000

			// First insert a character
			await dataStore.upsertCharacter(
				characterId,
				{
					name: 'Test Character',
					corporation_id: 98000001,
					security_status: 5.0,
					birthday: '2010-01-01T00:00:00Z',
					gender: 'male',
					race_id: 1,
					bloodline_id: 1,
				},
				expiresAt
			)

			const character = await dataStore.getCharacter(characterId)
			expect(character).toBeDefined()
			expect(character?.character_id).toBe(characterId)
			expect(character?.name).toBe('Test Character')
		})

		test('retrieves corporation by ID', async () => {
			const dataStore = getStub<CharacterDataStore>(testEnv.CHARACTER_DATA_STORE, 'test-retrieve-corporation')

			const corporationId = 98000001
			const now = Date.now()
			const expiresAt = now + 3600 * 1000

			// First insert a corporation
			await dataStore.upsertCorporation(
				corporationId,
				{
					name: 'Test Corporation',
					ticker: 'TEST',
					member_count: 100,
					ceo_id: 123456,
					creator_id: 123456,
					tax_rate: 0.1,
				},
				expiresAt
			)

			const corporation = await dataStore.getCorporation(corporationId)
			expect(corporation).toBeDefined()
			expect(corporation?.corporation_id).toBe(corporationId)
			expect(corporation?.name).toBe('Test Corporation')
		})

		test('returns null for non-existent character', async () => {
			const dataStore = getStub<CharacterDataStore>(testEnv.CHARACTER_DATA_STORE, 'test-null-character')

			const character = await dataStore.getCharacter(999999999)
			expect(character).toBeNull()
		})

		test('returns null for non-existent corporation', async () => {
			const dataStore = getStub<CharacterDataStore>(testEnv.CHARACTER_DATA_STORE, 'test-null-corporation')

			const corporation = await dataStore.getCorporation(999999999)
			expect(corporation).toBeNull()
		})

		test('tracks alliance changes in history', async () => {
			const dataStore = getStub<CharacterDataStore>(testEnv.CHARACTER_DATA_STORE, 'test-alliance-changes')

			const characterId = 234567
			const now = Date.now()
			const expiresAt = now + 3600 * 1000

			// Insert character with alliance
			await dataStore.upsertCharacter(
				characterId,
				{
					name: 'Test Character 2',
					corporation_id: 98000001,
					alliance_id: 99000001,
					security_status: 5.0,
					birthday: '2010-01-01T00:00:00Z',
					gender: 'female',
					race_id: 1,
					bloodline_id: 1,
					ancestry_id: 1,
					description: 'Test description',
				},
				expiresAt
			)

			// Update character with alliance change
			await dataStore.upsertCharacter(
				characterId,
				{
					name: 'Test Character 2',
					corporation_id: 98000001,
					alliance_id: 99000002, // Changed alliance
					security_status: 5.0,
					birthday: '2010-01-01T00:00:00Z',
					gender: 'female',
					race_id: 1,
					bloodline_id: 1,
					ancestry_id: 1,
					description: 'Test description',
				},
				expiresAt
			)

			const history = await dataStore.getCharacterHistory(characterId)
			const allianceChange = history.find((h: { field_name: string }) => h.field_name === 'alliance_id')

			expect(allianceChange).toBeDefined()
			expect(allianceChange?.old_value).toBe('99000001')
			expect(allianceChange?.new_value).toBe('99000002')
		})
	})

	describe('Lookup Endpoints', () => {
		test('GET /esi/characters/:characterId returns character data', async () => {
			// Setup: insert test data first
			const dataStore = getStub<CharacterDataStore>(testEnv.CHARACTER_DATA_STORE, 'global')
			const characterId = 123456
			const now = Date.now()
			const expiresAt = now + 3600 * 1000

			await dataStore.upsertCharacter(
				characterId,
				{
					name: 'Test Character',
					corporation_id: 98000002,
					security_status: 5.0,
					birthday: '2010-01-01T00:00:00Z',
					gender: 'male',
					race_id: 1,
					bloodline_id: 1,
				},
				expiresAt
			)

			const res = await SELF.fetch('https://example.com/esi/characters/123456')
			expect(res.status).toBe(200)

			const data = (await res.json()) as {
				characterId: number
				name: string
				corporationId: number
				updateCount: number
			}

			expect(data.characterId).toBe(123456)
			expect(data.name).toBe('Test Character')
			expect(data.corporationId).toBe(98000002)
			expect(data.updateCount).toBeGreaterThanOrEqual(1)
		})

		test('GET /esi/corporations/:corporationId returns corporation data', async () => {
			// Setup: insert test data first
			const dataStore = getStub<CharacterDataStore>(testEnv.CHARACTER_DATA_STORE, 'global')
			const corporationId = 98000001
			const now = Date.now()
			const expiresAt = now + 3600 * 1000

			await dataStore.upsertCorporation(
				corporationId,
				{
					name: 'Test Corporation',
					ticker: 'TEST',
					member_count: 100,
					ceo_id: 123456,
					creator_id: 123456,
					tax_rate: 0.1,
				},
				expiresAt
			)

			const res = await SELF.fetch('https://example.com/esi/corporations/98000001')
			expect(res.status).toBe(200)

			const data = (await res.json()) as {
				corporationId: number
				name: string
				ticker: string
				memberCount: number
			}

			expect(data.corporationId).toBe(98000001)
			expect(data.name).toBe('Test Corporation')
			expect(data.ticker).toBe('TEST')
			expect(data.memberCount).toBe(100)
		})

		test('GET /esi/characters/:characterId returns 404 for non-existent character', async () => {
			const res = await SELF.fetch('https://example.com/esi/characters/999999999')
			expect(res.status).toBe(404)

			const data = await res.json()
			expect(data).toEqual({ error: 'Character not found' })
		})

		test('GET /esi/corporations/:corporationId returns 404 for non-existent corporation', async () => {
			const res = await SELF.fetch('https://example.com/esi/corporations/999999999')
			expect(res.status).toBe(404)

			const data = await res.json()
			expect(data).toEqual({ error: 'Corporation not found' })
		})

		test('GET /esi/characters/:characterId returns 400 for invalid ID', async () => {
			const res = await SELF.fetch('https://example.com/esi/characters/invalid')
			expect(res.status).toBe(400)

			const data = await res.json()
			expect(data).toEqual({ error: 'Invalid character ID' })
		})

		test('GET /esi/corporations/:corporationId returns 400 for invalid ID', async () => {
			const res = await SELF.fetch('https://example.com/esi/corporations/invalid')
			expect(res.status).toBe(400)

			const data = await res.json()
			expect(data).toEqual({ error: 'Invalid corporation ID' })
		})
	})

	describe('ESI Client', () => {
		test('parseCacheControl extracts max-age correctly', async () => {
			const { parseCacheControl } = await import('../../esi-client')

			const cacheControl = 'public, max-age=3600'
			const expiresAt = parseCacheControl(cacheControl)

			expect(expiresAt).toBeDefined()
			expect(expiresAt).toBeGreaterThan(Date.now())
			expect(expiresAt).toBeLessThan(Date.now() + 3700 * 1000)
		})

		test('parseCacheControl returns null for invalid header', async () => {
			const { parseCacheControl } = await import('../../esi-client')

			const expiresAt = parseCacheControl(null)
			expect(expiresAt).toBeNull()
		})

		test('parseCacheControl returns null for header without max-age', async () => {
			const { parseCacheControl } = await import('../../esi-client')

			const cacheControl = 'public, no-cache'
			const expiresAt = parseCacheControl(cacheControl)

			expect(expiresAt).toBeNull()
		})
	})
})
