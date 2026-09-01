import { Hono } from 'hono'

import { and, eq, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { managedCorporations, userCharacters } from '../db/schema'

import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { App } from '../context'

const MAX_TOKENS_PER_CORPORATION = 15
const TOKEN_BATCH_SIZE = 100
const CORPORATION_CONCURRENCY = 4

type Candidate = {
	characterId: string
	characterName: string
	userId: string
	role: 'director' | 'member'
}

type Corporation = {
	corporationId: string
	name: string
}

type CorporationResult = {
	corporationId: string
	corporationName: string
	tokens: Array<Candidate & { refreshToken: string }>
}

function getBearerToken(authorization: string | undefined): string | null {
	if (!authorization?.startsWith('Bearer ')) return null
	const token = authorization.slice('Bearer '.length).trim()
	return token || null
}

function parseRequestedCorporationIds(url: URL): { ids: string[] | null; error?: string } {
	const values = [
		...url.searchParams.getAll('corporationId'),
		...url.searchParams.getAll('corporationIds'),
	]
		.flatMap((value) => value.split(','))
		.map((value) => value.trim())
		.filter(Boolean)

	if (values.length === 0) return { ids: null }
	const ids = [...new Set(values)]
	if (ids.some((id) => !/^\d+$/.test(id))) {
		return { ids: null, error: 'Corporation IDs must be numeric EVE IDs' }
	}
	return { ids }
}

function orderCandidates(
	characters: Array<{ characterId: string; characterName: string; userId: string }>,
	directorIds: Set<string>
): Candidate[] {
	const directors: Candidate[] = []
	const members: Candidate[] = []

	for (const character of characters) {
		const candidate = {
			characterId: character.characterId,
			characterName: character.characterName,
			userId: character.userId,
			role: directorIds.has(character.characterId) ? ('director' as const) : ('member' as const),
		}
		if (candidate.role === 'director') directors.push(candidate)
		else members.push(candidate)
	}

	// Keep director priority deterministic, but rotate ordinary members so
	// repeated daemon requests do not select the same ten characters forever.
	directors.sort((a, b) => a.characterId.localeCompare(b.characterId))
	for (let index = members.length - 1; index > 0; index -= 1) {
		const random = new Uint32Array(1)
		crypto.getRandomValues(random)
		const swapIndex = random[0] % (index + 1)
		const current = members[index]
		members[index] = members[swapIndex]
		members[swapIndex] = current
	}

	return [...directors, ...members]
}

async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	mapper: (item: T) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length)
	let nextIndex = 0

	async function runWorker(): Promise<void> {
		while (true) {
			const index = nextIndex++
			if (index >= items.length) return
			results[index] = await mapper(items[index])
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()))
	return results
}

const app = new Hono<App>()

app.get('/', async (c) => {
	const expectedToken = c.env.MEMBER_REFRESH_TOKEN_EXPORT_TOKEN?.trim()
	if (!expectedToken) {
		return c.json({ error: 'Member refresh token export is not configured' }, 500)
	}
	if (getBearerToken(c.req.header('Authorization')) !== expectedToken) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const parsed = parseRequestedCorporationIds(new URL(c.req.url))
	if (parsed.error) return c.json({ error: parsed.error }, 400)

	const database = c.get('db') ?? createDb(c.env.DATABASE_URL)
	const corporations = await database.query.managedCorporations.findMany({
		where: and(
			eq(managedCorporations.isActive, true),
			or(
				eq(managedCorporations.isMemberCorporation, true),
				eq(managedCorporations.isSpecialPurpose, true)
			),
			...(parsed.ids
				? [or(...parsed.ids.map((id) => eq(managedCorporations.corporationId, id)))]
				: [])
		),
		columns: {
			corporationId: true,
			name: true,
		},
	})

	const tokenStore = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
	const corporationResults = await mapWithConcurrency(
		corporations as Corporation[],
		CORPORATION_CONCURRENCY,
		async (
			corporation
		): Promise<
			| { result: CorporationResult; error: null }
			| { result: null; error: { corporationId: string; error: string } }
		> => {
			try {
				const corporationData = getStub<EveCorporationData>(
					c.env.EVE_CORPORATION_DATA,
					corporation.corporationId
				)
				const [characters, directors] = await Promise.all([
					database.query.userCharacters.findMany({
						where: and(
							eq(userCharacters.corporationId, corporation.corporationId),
							eq(userCharacters.isDeleted, false),
							eq(userCharacters.status, 'active'),
							eq(userCharacters.hasValidToken, true)
						),
						columns: {
							characterId: true,
							characterName: true,
							userId: true,
							hasValidToken: true,
						},
					}),
					corporationData.getDirectors(corporation.corporationId),
				])

				const directorIds = new Set(
					directors.filter((director) => director.isHealthy).map((director) => director.characterId)
				)
				const candidates = orderCandidates(
					characters.filter((character) => character.hasValidToken === true),
					directorIds
				)
				const tokensByCharacterId = new Map<string, string>()

				for (
					let offset = 0;
					offset < candidates.length && tokensByCharacterId.size < MAX_TOKENS_PER_CORPORATION;
					offset += TOKEN_BATCH_SIZE
				) {
					const batch = candidates.slice(offset, offset + TOKEN_BATCH_SIZE)
					const membershipByCharacterId = await corporationData.getCorporationIdsByCharacterIds(
						batch.map((candidate) => candidate.characterId)
					)
					const currentMemberBatch = batch.filter(
						(candidate) =>
							membershipByCharacterId[candidate.characterId] === corporation.corporationId
					)
					if (currentMemberBatch.length === 0) continue

					const tokenRows = await tokenStore.getRefreshTokensForIntegration(
						currentMemberBatch.map((candidate) => candidate.characterId)
					)
					const currentMemberIds = new Set(
						currentMemberBatch.map((candidate) => candidate.characterId)
					)
					for (const token of tokenRows) {
						if (currentMemberIds.has(token.characterId)) {
							tokensByCharacterId.set(token.characterId, token.refreshToken)
						}
					}
				}

				return {
					result: {
						corporationId: corporation.corporationId,
						corporationName: corporation.name,
						tokens: candidates
							.filter((candidate) => tokensByCharacterId.has(candidate.characterId))
							.slice(0, MAX_TOKENS_PER_CORPORATION)
							.map((candidate) => ({
								...candidate,
								refreshToken: tokensByCharacterId.get(candidate.characterId)!,
							})),
					},
					error: null,
				}
			} catch (error) {
				logger.error('[MemberRefreshTokenExport] Failed to load corporation tokens', {
					corporationId: corporation.corporationId,
					error: error instanceof Error ? error.message : String(error),
				})
				return {
					result: null,
					error: {
						corporationId: corporation.corporationId,
						error: 'Unable to retrieve refresh tokens for this corporation',
					},
				}
			}
		}
	)
	const results = corporationResults.flatMap((entry) => (entry.result ? [entry.result] : []))
	const errors = corporationResults.flatMap((entry) => (entry.error ? [entry.error] : []))

	return c.json(
		{
			corporations: results,
			errors,
			requestedCorporationIds: parsed.ids,
		},
		200,
		{ 'Cache-Control': 'no-store' }
	)
})

export default app
