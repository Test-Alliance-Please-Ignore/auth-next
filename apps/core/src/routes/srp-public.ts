import { Hono } from 'hono'
import type { Context } from 'hono'

import { and, eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import type { SRPPublicRequestSummaryResponse, Srp } from '@repo/srp'

import { createDb } from '../db'
import { userCharacters, users } from '../db/schema'

import type { App } from '../context'

type PublicSrpRequestSummaryResponse = SRPPublicRequestSummaryResponse & {
	mainCharacterName: string | null
}

const app = new Hono<App>()

function getApiToken(c: Context<App>): string | null {
	const authHeader = c.req.header('Authorization')?.trim()
	if (authHeader?.startsWith('Bearer ')) {
		return authHeader.slice(7).trim() || null
	}
	return null
}

app.get('/:killmailId', async (c) => {
	const expectedToken = c.env.SRP_PUBLIC_API_TOKEN?.trim()
	if (!expectedToken) {
		return c.json({ error: 'SRP public API token is not configured' }, 500)
	}

	const providedToken = getApiToken(c)
	if (!providedToken || providedToken !== expectedToken) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const killmailId = c.req.param('killmailId').trim()
	if (!/^\d+$/.test(killmailId)) {
		return c.json({ error: 'Invalid killmail id' }, 400)
	}

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
	const request = await srpStub.getPublicRequestSummary(killmailId)

	if (!request) {
		return c.json({ error: 'Request not found' }, 404)
	}

	const db = createDb(c.env.DATABASE_URL)
	const requestor = await db.query.users.findFirst({
		where: eq(users.id, request.userId),
		columns: {
			id: true,
			mainCharacterId: true,
		},
	})

	const mainCharacterName = requestor?.mainCharacterId
		? (
				await db.query.userCharacters.findFirst({
					where: and(
						eq(userCharacters.userId, requestor.id),
						eq(userCharacters.characterId, requestor.mainCharacterId),
						eq(userCharacters.isDeleted, false)
					),
					columns: {
						characterName: true,
					},
				})
		  )?.characterName ?? null
		: null

	const response: PublicSrpRequestSummaryResponse = {
		killmailId: request.killmailId,
		userId: request.userId,
		mainCharacterName,
		shipTypeId: request.shipTypeId,
		shipTypeName: request.shipTypeName,
		requestStatus: request.requestStatus,
		approvedAmount: request.approvedAmount,
	}

	return c.json(response)
})

export default app
