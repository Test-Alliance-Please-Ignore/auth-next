/**
 * Bills routes - User-facing operations for viewing bills
 *
 * All endpoints require authentication (no admin required).
 * Users can view bills where they are the payer (via their characters or managed corporations).
 */

import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { userCharacters } from '../db/schema'
import { requireAllianceMember } from '../middleware/session'
import { eq } from 'drizzle-orm'

import type { Bills, BillFilters, BillWithDetails } from '@repo/bills'
import type { EsiTypeResolver } from '@repo/esi'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { App } from '../context'

const app = new Hono<App>()

/**
 * GET /bills/my-bills
 * List bills where the current user is the payer
 * (via their character IDs or corporations where they have CEO/Director roles)
 */
app.get('/my-bills', requireAllianceMember(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const status = c.req.query('status')
		const db = createDb(c.env.DATABASE_URL)

		logger.info('[bills-user] Fetching bills for user', { userId: user.id })

		// Step 1: Get all user's character IDs
		const characters = await db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, user.id),
		})

		const characterIds = characters.map((c) => c.characterId)

		logger.info('[bills-user] Found characters', {
			userId: user.id,
			characterCount: characterIds.length,
		})

		if (characterIds.length === 0) {
			// No characters means no bills
			return c.json([])
		}

		// Step 2: Get corporation IDs where user has CEO/Director roles
		const corporationIds = await getCorporationIdsWithRoles(c.env, characters)

		logger.info('[bills-user] Found managed corporations', {
			userId: user.id,
			corporationCount: corporationIds.length,
		})

		// Step 3: Combine all payer IDs
		const payerIds = [...characterIds, ...corporationIds]

		// Step 4: Query bills for all payer IDs
		const stub = getStub<Bills>(c.env.BILLS, 'default')

		// Fetch bills for each payer ID and combine results
		// Note: The Bills DO listBills method filters by single payerId,
		// so we need to fetch for each and combine
		const allBills: BillWithDetails[] = []
		const seenBillIds = new Set<string>()

		for (const payerId of payerIds) {
			const filters: BillFilters = {
				payerId,
				status: status as any,
			}

			const bills = await stub.listBills(user.id, filters)

			for (const bill of bills) {
				// Skip draft bills - users shouldn't see drafts
				if (bill.status === 'draft') continue

				// Deduplicate in case a bill appears for multiple payer IDs
				if (!seenBillIds.has(bill.id)) {
					seenBillIds.add(bill.id)
					allBills.push(bill)
				}
			}
		}

		// Step 5: Resolve entity names for payer
		if (allBills.length > 0) {
			const resolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
			const payerIdsToResolve = [...new Set(allBills.map((b) => b.payerId))]
			const nameMap = await resolver.resolveIds(payerIdsToResolve)

			for (const bill of allBills) {
				bill.payerName = nameMap[bill.payerId] || undefined
			}
		}

		// Sort by due date (upcoming first)
		allBills.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())

		logger.info('[bills-user] Bills fetched successfully', {
			userId: user.id,
			count: allBills.length,
		})

		return c.json(allBills)
	} catch (error) {
		logger.error('[bills-user] Error listing bills:', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to list bills' }, 500)
	}
})

/**
 * GET /bills/my-bills/:billId
 * Get a single bill if the current user is the payer
 */
app.get('/my-bills/:billId', requireAllianceMember(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const billId = c.req.param('billId')

	try {
		const db = createDb(c.env.DATABASE_URL)

		logger.info('[bills-user] Fetching single bill for user', { userId: user.id, billId })

		// Step 1: Get all user's character IDs
		const characters = await db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, user.id),
		})

		const characterIds = characters.map((c) => c.characterId)

		if (characterIds.length === 0) {
			return c.json({ error: 'Bill not found' }, 404)
		}

		// Step 2: Get corporation IDs where user has CEO/Director roles
		const corporationIds = await getCorporationIdsWithRoles(c.env, characters)

		// Step 3: All valid payer IDs for this user
		const validPayerIds = new Set([...characterIds, ...corporationIds])

		// Step 4: Fetch the bill
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const bill = await stub.getBill(user.id, billId)

		if (!bill) {
			return c.json({ error: 'Bill not found' }, 404)
		}

		// Step 5: Verify user is authorized (is a valid payer)
		if (!validPayerIds.has(bill.payerId)) {
			logger.warn('[bills-user] User not authorized to view bill', {
				userId: user.id,
				billId,
				payerId: bill.payerId,
			})
			return c.json({ error: 'Bill not found' }, 404)
		}

		// Step 6: Don't show draft bills to users
		if (bill.status === 'draft') {
			return c.json({ error: 'Bill not found' }, 404)
		}

		// Step 7: Resolve entity names
		const resolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')

		// Collect all IDs to resolve
		const idsToResolve = [bill.payerId, bill.issuerId]
		if (bill.payments) {
			for (const payment of bill.payments) {
				idsToResolve.push(payment.paidById)
			}
		}

		const nameMap = await resolver.resolveIds([...new Set(idsToResolve)])

		// Apply resolved names
		bill.payerName = nameMap[bill.payerId] || undefined
		bill.issuerName = nameMap[bill.issuerId] || undefined

		if (bill.payments) {
			for (const payment of bill.payments) {
				payment.paidByName = nameMap[payment.paidById] || undefined
			}
		}

		logger.info('[bills-user] Bill fetched successfully', { userId: user.id, billId })

		return c.json(bill)
	} catch (error) {
		logger.error('[bills-user] Error fetching bill:', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			billId,
		})
		return c.json({ error: 'Failed to fetch bill' }, 500)
	}
})

/**
 * Helper function to get corporation IDs where user has CEO or Director roles
 */
async function getCorporationIdsWithRoles(
	env: App['Bindings'],
	characters: Array<{ characterId: string; characterName: string | null }>
): Promise<string[]> {
	const corporationIds: string[] = []
	const charStub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, 'default')

	// Build map of character -> corporation
	const characterCorpMap = new Map<string, string>()

	for (const character of characters) {
		try {
			const charData = await charStub.getCharacterInfo(character.characterId)
			if (charData?.corporationId) {
				const corpId = String(charData.corporationId)
				characterCorpMap.set(character.characterId, corpId)
			}
		} catch (error) {
			logger.warn('[bills-user] Error fetching character data', {
				characterId: character.characterId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	// Check each unique corporation for CEO/Director role
	const uniqueCorpIds = [...new Set(characterCorpMap.values())]

	for (const corpId of uniqueCorpIds) {
		try {
			const corpStub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, corpId)

			const [corpInfo, directors] = await Promise.all([
				corpStub.getCorporationInfo(corpId),
				corpStub.getDirectors(corpId),
			])

			const directorIds = new Set(directors.map((d) => d.characterId))

			// Check if any user character is CEO or Director
			for (const [charId, charCorpId] of characterCorpMap.entries()) {
				if (charCorpId !== corpId) continue

				const isCeo = corpInfo && String(corpInfo.ceoId) === charId
				const isDirector = directorIds.has(charId)

				if (isCeo || isDirector) {
					corporationIds.push(corpId)
					break // Found a role, no need to check more characters for this corp
				}
			}
		} catch (error) {
			logger.warn('[bills-user] Error checking corporation roles', {
				corporationId: corpId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	return corporationIds
}

export default app
