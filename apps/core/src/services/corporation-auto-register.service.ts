import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import { logger } from '@repo/hono-helpers'
import type { createDb } from '../db'
import { managedCorporations } from '../db/schema'

interface AutoRegistrationResult {
	success: boolean
	corporationRegistered?: {
		corporationId: string
		corporationName: string
		ticker: string
		wasNew: boolean
	}
	directorAdded?: {
		characterId: string
		characterName: string
		priority: number
	}
	reason?: string
}

/**
 * Automatically register a corporation and add character as director
 * if the character has Director role in their corporation
 */
export async function autoRegisterDirectorCorporation(
	characterId: string,
	characterName: string,
	userId: string,
	db: ReturnType<typeof createDb>,
	tokenStore: EveTokenStore,
	eveCorporationDataNamespace: DurableObjectNamespace<EveCorporationData>
): Promise<AutoRegistrationResult> {
	try {
		logger.info('[AutoReg] Checking if character is a director', {
			characterId,
			characterName,
		})

		// Step 1: Check if token has the required scope
		const tokenInfo = await tokenStore.getTokenInfo(characterId)
		if (!tokenInfo.scopes.includes('esi-characters.read_corporation_roles.v1')) {
			logger.info('[AutoReg] Character missing corporation roles scope, skipping', {
				characterId,
				scopes: tokenInfo.scopes,
			})
			return {
				success: false,
				reason: 'missing_scope',
			}
		}

		// Step 2: Fetch character's corporation roles
		let roles: string[]
		try {
			const rolesResponse = await tokenStore.fetchEsi<{
				roles?: string[]
				roles_at_hq?: string[]
				roles_at_base?: string[]
				roles_at_other?: string[]
			}>(`/characters/${characterId}/roles`, characterId)

			roles = rolesResponse.data.roles || []

			logger.info('[AutoReg] Fetched character roles', {
				characterId,
				roles,
			})
		} catch (error) {
			logger.error('[AutoReg] Failed to fetch character roles', {
				characterId,
				error: error instanceof Error ? error.message : String(error),
			})
			return {
				success: false,
				reason: 'failed_to_fetch_roles',
			}
		}

		// Step 3: Check if character has Director role
		if (!roles.includes('Director')) {
			logger.info('[AutoReg] Character does not have Director role, skipping', {
				characterId,
				roles,
			})
			return {
				success: false,
				reason: 'not_a_director',
			}
		}

		logger.info('[AutoReg] Director role detected!', {
			characterId,
			characterName,
		})

		// Step 4: Get character's corporation ID
		let corporationId: string
		try {
			const characterInfo = await tokenStore.fetchPublicEsi<{
				corporation_id: number
				name: string
			}>(`/characters/${characterId}/`)

			// ESI returns numbers, convert to string
			corporationId = String(characterInfo.data.corporation_id)

			logger.info('[AutoReg] Got character corporation', {
				characterId,
				corporationId,
			})
		} catch (error) {
			logger.error('[AutoReg] Failed to fetch character info', {
				characterId,
				error: error instanceof Error ? error.message : String(error),
			})
			return {
				success: false,
				reason: 'failed_to_fetch_character_info',
			}
		}

		// Step 5: Fetch corporation details
		let corpName: string
		let corpTicker: string
		try {
			const corpInfo = await tokenStore.getCorporationById(corporationId)

			if (!corpInfo) {
				logger.error('[AutoReg] Corporation not found', { corporationId })
				return {
					success: false,
					reason: 'failed_to_fetch_corporation_info',
				}
			}

			corpName = corpInfo.name
			corpTicker = corpInfo.ticker

			logger.info('[AutoReg] Fetched corporation details', {
				corporationId,
				name: corpName,
				ticker: corpTicker,
			})
		} catch (error) {
			logger.error('[AutoReg] Failed to fetch corporation info', {
				corporationId,
				error: error instanceof Error ? error.message : String(error),
			})
			return {
				success: false,
				reason: 'failed_to_fetch_corporation_info',
			}
		}

		// Step 6: Check if corporation already managed
		const existingCorp = await db.query.managedCorporations.findFirst({
			where: eq(managedCorporations.corporationId, corporationId),
		})

		let wasNew = false

		// Step 7: Create managed corporation if it doesn't exist
		if (!existingCorp) {
			logger.info('[AutoReg] Creating new managed corporation', {
				corporationId,
				name: corpName,
				ticker: corpTicker,
			})

			try {
				await db.insert(managedCorporations).values({
					corporationId,
					name: corpName,
					ticker: corpTicker,
					assignedCharacterId: characterId,
					assignedCharacterName: characterName,
					isActive: true,
					isVerified: false,
					healthyDirectorCount: 0,
					configuredBy: userId,
				})

				wasNew = true

				logger.info('[AutoReg] Created managed corporation', {
					corporationId,
					name: corpName,
				})
			} catch (error) {
				logger.error('[AutoReg] Failed to create managed corporation', {
					corporationId,
					error: error instanceof Error ? error.message : String(error),
				})
				return {
					success: false,
					reason: 'failed_to_create_corporation',
				}
			}
		} else {
			logger.info('[AutoReg] Corporation already managed', {
				corporationId,
				name: corpName,
			})
		}

		// Step 8: Add character as director via eve-corporation-data DO
		try {
			const stub = getStub<EveCorporationData>(
				eveCorporationDataNamespace,
				corporationId
			)

			// This will silently succeed if director already exists (uses ON CONFLICT DO NOTHING)
			await stub.addDirector(corporationId, characterId, characterName, 100)

			logger.info('[AutoReg] Added character as director', {
				corporationId,
				characterId,
				characterName,
			})

			// Step 9: Trigger director verification (fire and forget)
			stub.verifyAllDirectorsHealth(corporationId).catch((error) => {
				logger.error('[AutoReg] Failed to verify director health (async)', {
					corporationId,
					characterId,
					error: error instanceof Error ? error.message : String(error),
				})
			})

			return {
				success: true,
				corporationRegistered: {
					corporationId,
					corporationName: corpName,
					ticker: corpTicker,
					wasNew,
				},
				directorAdded: {
					characterId,
					characterName,
					priority: 100,
				},
			}
		} catch (error) {
			// If there's an unexpected error, log it
			const errorMessage = error instanceof Error ? error.message : String(error)

			logger.error('[AutoReg] Failed to add director', {
				corporationId,
				characterId,
				error: errorMessage,
			})

			// Still return success if corporation was registered
			return {
				success: true,
				corporationRegistered: wasNew
					? {
							corporationId,
							corporationName: corpName,
							ticker: corpTicker,
							wasNew,
						}
					: undefined,
				reason: 'director_add_failed',
			}
		}
	} catch (error) {
		logger.error('[AutoReg] Unexpected error during auto-registration', {
			characterId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})

		return {
			success: false,
			reason: 'unexpected_error',
		}
	}
}
