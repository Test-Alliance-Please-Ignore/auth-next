import { Hono } from 'hono'

import { and, eq, notInArray, or, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { managedCorporations, userCharacters } from '../db/schema'

import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { DecryptedAccessToken, EveTokenStore } from '@repo/eve-token-store'
import type { App } from '../context'

const DEFAULT_TOKENS_PER_CORPORATION = 15
const MAX_TOKENS_PER_CORPORATION = 60
const TOKEN_BATCH_SIZE = 100
const CORPORATION_CONCURRENCY = 4

type Candidate = {
	characterId: string
}

type Corporation = {
	corporationId: string
	name: string
}

type Database = ReturnType<typeof createDb>

type IntegrationAuthFailure = {
	error: string
	status: 401 | 500
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

function parseRequestedTokenCount(url: URL): { count: number; error?: string } {
	const values = url.searchParams.getAll('count')
	if (values.length === 0) return { count: DEFAULT_TOKENS_PER_CORPORATION }
	if (values.length !== 1 || !/^\d+$/.test(values[0].trim())) {
		return {
			count: DEFAULT_TOKENS_PER_CORPORATION,
			error: 'count must be an integer between 1 and 60',
		}
	}

	const count = Number(values[0])
	if (!Number.isSafeInteger(count) || count < 1 || count > MAX_TOKENS_PER_CORPORATION) {
		return {
			count: DEFAULT_TOKENS_PER_CORPORATION,
			error: 'count must be an integer between 1 and 60',
		}
	}
	return { count }
}

function getIntegrationAuthFailure(
	expectedToken: string | undefined,
	authorization: string | undefined
): IntegrationAuthFailure | null {
	if (!expectedToken) {
		return { error: 'Member refresh token export is not configured', status: 500 }
	}
	if (getBearerToken(authorization) !== expectedToken) {
		return { error: 'Unauthorized', status: 401 }
	}
	return null
}

async function findEligibleCorporations(
	database: Database,
	requestedIds: string[] | null
): Promise<Corporation[]> {
	return (await database.query.managedCorporations.findMany({
		where: and(
			eq(managedCorporations.isActive, true),
			or(
				eq(managedCorporations.isMemberCorporation, true),
				eq(managedCorporations.isSpecialPurpose, true)
			),
			...(requestedIds
				? [or(...requestedIds.map((id) => eq(managedCorporations.corporationId, id)))]
				: [])
		),
		columns: {
			corporationId: true,
			name: true,
		},
	})) as Corporation[]
}

async function findRandomCandidates(
	database: Database,
	corporationId: string,
	excludedCharacterIds: readonly string[],
	limit: number
): Promise<Candidate[]> {
	const conditions = [
		eq(userCharacters.corporationId, corporationId),
		eq(userCharacters.isDeleted, false),
		eq(userCharacters.status, 'active'),
		eq(userCharacters.hasValidToken, true),
	]
	if (excludedCharacterIds.length > 0) {
		conditions.push(notInArray(userCharacters.characterId, [...excludedCharacterIds]))
	}

	return (await database.query.userCharacters.findMany({
		where: and(...conditions),
		columns: {
			characterId: true,
		},
		orderBy: sql`random()`,
		limit,
	})) as Candidate[]
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

async function resolveCorporationTokens(
	database: Database,
	tokenStore: EveTokenStore,
	corporationData: EveCorporationData,
	corporationId: string,
	count: number
): Promise<Array<Candidate & DecryptedAccessToken>> {
	const selected: Array<Candidate & DecryptedAccessToken> = []
	const attemptedCharacterIds = new Set<string>()

	// Let PostgreSQL choose a bounded random batch. Candidates that are no longer
	// members or cannot produce an access token are excluded from replacements.
	while (selected.length < count) {
		const remaining = count - selected.length
		const batch = await findRandomCandidates(
			database,
			corporationId,
			[...attemptedCharacterIds],
			Math.min(TOKEN_BATCH_SIZE, remaining)
		)
		if (batch.length === 0) break
		const freshBatch = batch.filter(
			(candidate) => !attemptedCharacterIds.has(candidate.characterId)
		)
		if (freshBatch.length === 0) break
		for (const candidate of freshBatch) attemptedCharacterIds.add(candidate.characterId)

		const membershipByCharacterId = await corporationData.getCorporationIdsByCharacterIds(
			freshBatch.map((candidate) => candidate.characterId)
		)
		const currentMemberCandidates = freshBatch.filter(
			(candidate) => membershipByCharacterId[candidate.characterId] === corporationId
		)
		if (currentMemberCandidates.length === 0) continue

		const tokenRows = await tokenStore.getAccessTokensForIntegration(
			currentMemberCandidates.map((candidate) => candidate.characterId),
			{ forceRefresh: true }
		)
		const tokensByCharacterId = new Map<string, DecryptedAccessToken>()
		for (const token of tokenRows) {
			if (
				typeof token.accessToken === 'string' &&
				token.accessToken.length > 0 &&
				typeof token.expiresAt === 'string' &&
				!tokensByCharacterId.has(token.characterId)
			) {
				tokensByCharacterId.set(token.characterId, token)
			}
		}

		for (const candidate of currentMemberCandidates) {
			const token = tokensByCharacterId.get(candidate.characterId)
			if (!token) continue
			selected.push({ ...candidate, ...token })
			if (selected.length === count) break
		}
	}

	return selected
}

const app = new Hono<App>()

app.get('/corporations', async (c) => {
	const authFailure = getIntegrationAuthFailure(
		c.env.MEMBER_REFRESH_TOKEN_EXPORT_TOKEN?.trim(),
		c.req.header('Authorization')
	)
	if (authFailure) return c.json({ error: authFailure.error }, authFailure.status)

	const database = c.get('db') ?? createDb(c.env.DATABASE_URL)
	const corporations = await findEligibleCorporations(database, null)
	return c.json(
		{ corporationIds: corporations.map((corporation) => corporation.corporationId) },
		200,
		{ 'Cache-Control': 'no-store' }
	)
})

app.get('/', async (c) => {
	const authFailure = getIntegrationAuthFailure(
		c.env.MEMBER_REFRESH_TOKEN_EXPORT_TOKEN?.trim(),
		c.req.header('Authorization')
	)
	if (authFailure) return c.json({ error: authFailure.error }, authFailure.status)

	const parsed = parseRequestedCorporationIds(new URL(c.req.url))
	if (parsed.error) return c.json({ error: parsed.error }, 400)
	const requestedCount = parseRequestedTokenCount(new URL(c.req.url))
	if (requestedCount.error) return c.json({ error: requestedCount.error }, 400)

	const database = c.get('db') ?? createDb(c.env.DATABASE_URL)
	const corporations = await findEligibleCorporations(database, parsed.ids)

	const tokenStore = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
	const resolvedCorporations = await mapWithConcurrency(
		corporations as Corporation[],
		CORPORATION_CONCURRENCY,
		async (
			corporation
		): Promise<
			| {
					result: { corporation: Corporation; candidates: Array<Candidate & DecryptedAccessToken> }
					error: null
			  }
			| { result: null; error: { corporationId: string; error: string } }
		> => {
			try {
				const corporationData = getStub<EveCorporationData>(
					c.env.EVE_CORPORATION_DATA,
					corporation.corporationId
				)
				const tokens = await resolveCorporationTokens(
					database,
					tokenStore,
					corporationData,
					corporation.corporationId,
					requestedCount.count
				)
				return {
					result: {
						corporation,
						candidates: tokens,
					},
					error: null,
				}
			} catch (error) {
				logger.error('[MemberAccessTokenExport] Failed to resolve corporation access tokens', {
					corporationId: corporation.corporationId,
					error: error instanceof Error ? error.message : String(error),
				})
				return {
					result: null,
					error: {
						corporationId: corporation.corporationId,
						error: 'Unable to retrieve access tokens for this corporation',
					},
				}
			}
		}
	)
	const results = resolvedCorporations.flatMap((entry) => {
		if (!entry.result) return []
		const { corporation, candidates } = entry.result
		return [
			{
				corporationId: corporation.corporationId,
				corporationName: corporation.name,
				tokens: candidates,
			},
		]
	})
	const errors = resolvedCorporations.flatMap((entry) => (entry.error ? [entry.error] : []))

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
