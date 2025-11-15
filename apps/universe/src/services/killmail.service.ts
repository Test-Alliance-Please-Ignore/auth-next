import { and, eq, gte, lte, or, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { killmailDetailSchema } from '@repo/universe'

import { killmails, schema } from '../db/schema'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { Killmail, KillmailDetail } from '@repo/universe'
import type { Env } from '../context'
import type { DbClient } from '@repo/db-utils'

/**
 * Killmail Service
 *
 * Handles all killmail-related database operations and entity name resolution
 */
export class KillmailService {
	constructor(
		private db: DbClient<typeof schema>,
		private env: Env
	) {}

	/**
	 * Store killmail data, resolving all entity names
	 */
	async storeKillmail(
		killmailId: string,
		killmailHash: string,
		killmailData: KillmailDetail
	): Promise<Killmail> {
		// Validate input with Zod schema
		const validated = killmailDetailSchema.parse(killmailData)

		// Extract all entity IDs that need resolution
		const entityIds = new Set<string>()

		// Solar system
		if (validated.solar_system_id) {
			entityIds.add(validated.solar_system_id)
		}

		// Moon
		if (validated.moon_id) {
			entityIds.add(validated.moon_id)
		}

		// War
		if (validated.war_id) {
			entityIds.add(validated.war_id)
		}

		// Victim
		if (validated.victim.character_id) {
			entityIds.add(validated.victim.character_id)
		}
		if (validated.victim.corporation_id) {
			entityIds.add(validated.victim.corporation_id)
		}
		if (validated.victim.alliance_id) {
			entityIds.add(validated.victim.alliance_id)
		}
		if (validated.victim.ship_type_id) {
			entityIds.add(validated.victim.ship_type_id)
		}

		// Attackers
		const attackerCharacterIds: string[] = []
		const attackerCorporationIds: string[] = []
		for (const attacker of validated.attackers) {
			if (attacker.character_id) {
				attackerCharacterIds.push(attacker.character_id)
				entityIds.add(attacker.character_id)
			}
			if (attacker.corporation_id) {
				attackerCorporationIds.push(attacker.corporation_id)
				entityIds.add(attacker.corporation_id)
			}
			if (attacker.alliance_id) {
				entityIds.add(attacker.alliance_id)
			}
			if (attacker.ship_type_id) {
				entityIds.add(attacker.ship_type_id)
			}
			if (attacker.weapon_type_id) {
				entityIds.add(attacker.weapon_type_id)
			}
		}

		// Resolve all IDs to names
		let resolvedNames: Record<string, string> = {}
		if (entityIds.size > 0) {
			using tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
			resolvedNames = await tokenStoreStub.resolveIds(Array.from(entityIds))
		}

		// Map resolved names to attacker arrays (matching order)
		const attackerCharacterNames = attackerCharacterIds.map(
			(id) => resolvedNames[id] ?? null
		).filter((name): name is string => name !== null)
		const attackerCorporationNames = attackerCorporationIds.map(
			(id) => resolvedNames[id] ?? null
		).filter((name): name is string => name !== null)

		// Prepare data for insertion
		const killmailTime = new Date(validated.killmail_time)

		const insertData = {
			killmailId: String(killmailId),
			killmailHash: String(killmailHash),
			killmailTime,
			solarSystemId: validated.solar_system_id,
			solarSystemName: resolvedNames[validated.solar_system_id] ?? null,
			moonId: validated.moon_id ?? null,
			moonName: validated.moon_id ? (resolvedNames[validated.moon_id] ?? null) : null,
			warId: validated.war_id ?? null,
			warName: validated.war_id ? (resolvedNames[validated.war_id] ?? null) : null,
			victimCharacterId: validated.victim.character_id ?? null,
			victimCharacterName: validated.victim.character_id
				? (resolvedNames[validated.victim.character_id] ?? null)
				: null,
			victimCorporationId: validated.victim.corporation_id ?? null,
			victimCorporationName: validated.victim.corporation_id
				? (resolvedNames[validated.victim.corporation_id] ?? null)
				: null,
			victimAllianceId: validated.victim.alliance_id ?? null,
			victimAllianceName: validated.victim.alliance_id
				? (resolvedNames[validated.victim.alliance_id] ?? null)
				: null,
			victimShipTypeId: validated.victim.ship_type_id,
			victimShipTypeName: resolvedNames[validated.victim.ship_type_id] ?? null,
			victimDamageTaken: validated.victim.damage_taken,
			attackerCharacterIds: attackerCharacterIds.length > 0 ? attackerCharacterIds : null,
			attackerCharacterNames: attackerCharacterNames.length > 0 ? attackerCharacterNames : null,
			attackerCorporationIds: attackerCorporationIds.length > 0 ? attackerCorporationIds : null,
			attackerCorporationNames: attackerCorporationNames.length > 0 ? attackerCorporationNames : null,
			killmailData: validated as unknown,
			updatedAt: new Date(),
		}

		// Insert or update with conflict resolution
		const [result] = await this.db
			.insert(killmails)
			.values(insertData)
			.onConflictDoUpdate({
				target: [killmails.killmailId, killmails.killmailHash],
				set: {
					killmailTime: sql`excluded.killmail_time`,
					solarSystemId: sql`excluded.solar_system_id`,
					solarSystemName: sql`excluded.solar_system_name`,
					moonId: sql`excluded.moon_id`,
					moonName: sql`excluded.moon_name`,
					warId: sql`excluded.war_id`,
					warName: sql`excluded.war_name`,
					victimCharacterId: sql`excluded.victim_character_id`,
					victimCharacterName: sql`excluded.victim_character_name`,
					victimCorporationId: sql`excluded.victim_corporation_id`,
					victimCorporationName: sql`excluded.victim_corporation_name`,
					victimAllianceId: sql`excluded.victim_alliance_id`,
					victimAllianceName: sql`excluded.victim_alliance_name`,
					victimShipTypeId: sql`excluded.victim_ship_type_id`,
					victimShipTypeName: sql`excluded.victim_ship_type_name`,
					victimDamageTaken: sql`excluded.victim_damage_taken`,
					attackerCharacterIds: sql`excluded.attacker_character_ids`,
					attackerCharacterNames: sql`excluded.attacker_character_names`,
					attackerCorporationIds: sql`excluded.attacker_corporation_ids`,
					attackerCorporationNames: sql`excluded.attacker_corporation_names`,
					killmailData: sql`excluded.killmail_data`,
					updatedAt: sql`excluded.updated_at`,
				},
			})
			.returning()

		return result
	}

	/**
	 * Get killmail by ID and hash
	 */
	async getKillmailById(killmailId: string, killmailHash: string): Promise<Killmail | null> {
		const [result] = await this.db
			.select()
			.from(killmails)
			.where(and(eq(killmails.killmailId, String(killmailId)), eq(killmails.killmailHash, String(killmailHash))))
			.limit(1)

		return result ?? null
	}

	/**
	 * Get killmails by character ID
	 */
	async getKillmailsByCharacter(
		characterId: string,
		filters?: { startTime?: Date; endTime?: Date; lossesOnly?: boolean }
	): Promise<Killmail[]> {
		const conditions = [
			or(
				eq(killmails.victimCharacterId, String(characterId)),
				sql`${killmails.attackerCharacterIds} ?| ARRAY[${sql.raw(String(characterId))}]::text[]`
			),
		]

		// Filter by losses only
		if (filters?.lossesOnly) {
			conditions.push(eq(killmails.victimCharacterId, String(characterId)))
		}

		// Filter by time range
		if (filters?.startTime) {
			conditions.push(gte(killmails.killmailTime, filters.startTime))
		}
		if (filters?.endTime) {
			conditions.push(lte(killmails.killmailTime, filters.endTime))
		}

		return await this.db
			.select()
			.from(killmails)
			.where(and(...conditions))
			.orderBy(sql`${killmails.killmailTime} DESC`)
	}

	/**
	 * Get killmails by corporation ID
	 */
	async getKillmailsByCorporation(
		corporationId: string,
		filters?: { startTime?: Date; endTime?: Date; lossesOnly?: boolean }
	): Promise<Killmail[]> {
		const conditions = [
			or(
				eq(killmails.victimCorporationId, String(corporationId)),
				sql`${killmails.attackerCorporationIds} ?| ARRAY[${sql.raw(String(corporationId))}]::text[]`
			),
		]

		// Filter by losses only
		if (filters?.lossesOnly) {
			conditions.push(eq(killmails.victimCorporationId, String(corporationId)))
		}

		// Filter by time range
		if (filters?.startTime) {
			conditions.push(gte(killmails.killmailTime, filters.startTime))
		}
		if (filters?.endTime) {
			conditions.push(lte(killmails.killmailTime, filters.endTime))
		}

		return await this.db
			.select()
			.from(killmails)
			.where(and(...conditions))
			.orderBy(sql`${killmails.killmailTime} DESC`)
	}

	/**
	 * Get killmails by solar system ID
	 */
	async getKillmailsBySystem(
		solarSystemId: string,
		filters?: { startTime?: Date; endTime?: Date }
	): Promise<Killmail[]> {
		const conditions = [eq(killmails.solarSystemId, String(solarSystemId))]

		// Filter by time range
		if (filters?.startTime) {
			conditions.push(gte(killmails.killmailTime, filters.startTime))
		}
		if (filters?.endTime) {
			conditions.push(lte(killmails.killmailTime, filters.endTime))
		}

		return await this.db
			.select()
			.from(killmails)
			.where(and(...conditions))
			.orderBy(sql`${killmails.killmailTime} DESC`)
	}

	/**
	 * Get killmails by time range
	 */
	async getKillmailsByTimeRange(startTime: Date, endTime: Date): Promise<Killmail[]> {
		return await this.db
			.select()
			.from(killmails)
			.where(and(gte(killmails.killmailTime, startTime), lte(killmails.killmailTime, endTime)))
			.orderBy(sql`${killmails.killmailTime} DESC`)
	}
}

