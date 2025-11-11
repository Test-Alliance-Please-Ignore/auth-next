import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { and, createDbClient, eq, gte, ilike, inArray, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { schema as coreSchema } from '../../../core/src/db/schema'
import { schema } from '../db'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { Killmail } from '@repo/universe'

// Load .env from monorepo root - done manually to avoid dotenv debug output
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../../../../.env')

// Manually load .env without using dotenv to avoid any debug output
import { readFileSync } from 'node:fs'
try {
	const envContent = readFileSync(envPath, 'utf-8')
	for (const line of envContent.split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		const match = trimmed.match(/^([^=]+)=(.*)$/)
		if (match) {
			const key = match[1].trim()
			let value = match[2].trim()
			// Remove quotes if present
			if ((value.startsWith('"') && value.endsWith('"')) ||
			    (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1)
			}
			process.env[key] = value
		}
	}
} catch (error) {
	// .env file not found or not readable - that's okay, env vars might be set elsewhere
}

/**
 * Query corporation killmails with full details
 *
 * Usage: pnpm -F eve-corporation-data query-killmails [options]
 *
 * Entity Options (choose one):
 *   --corporation, --corp <name-or-id>  Query killmails for a corporation
 *   --alliance <id>                     Query killmails for all corps in an alliance
 *   --character, --char <id>            Query killmails for a character's corporation
 *
 * Filter Options:
 *   --limit, -l <number>                Number of killmails to fetch (default: 100)
 *   --offset, -o <number>               Skip this many killmails (for pagination, default: 0)
 *   --days, -d <number>                 Only show killmails from the past N days
 *   --kills                             Only show kills (exclude losses)
 *   --output                            Silence all output except final JSON (for piping)
 *   --help, -h                          Show help message
 *
 * Output Format:
 *   JSON Lines (NDJSON) - one killmail JSON object per line
 */

interface CorporationSearchResult {
	corporationId: string
	name: string
	ticker: string
}

// Global flag for quiet output (only JSON)
let quietMode = false

function log(...args: any[]) {
	if (!quietMode) {
		console.log(...args)
	}
}

function logWrite(...args: any[]) {
	if (!quietMode) {
		process.stdout.write(...args)
	}
}

async function searchCorporations(query: string): Promise<CorporationSearchResult[]> {
	const coreDatabaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!coreDatabaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	const coreDb = createDbClient(coreDatabaseUrl, coreSchema)

	// Try exact ID match first
	if (/^\d+$/.test(query)) {
		const corp = await coreDb.query.managedCorporations.findFirst({
			where: eq(coreSchema.managedCorporations.corporationId, query),
			columns: {
				corporationId: true,
				name: true,
				ticker: true,
			},
		})

		if (corp) {
			return [corp]
		}
	}

	// Search by name or ticker (case-insensitive partial match)
	const results = await coreDb.query.managedCorporations.findMany({
		where: or(
			ilike(coreSchema.managedCorporations.name, `%${query}%`),
			ilike(coreSchema.managedCorporations.ticker, `%${query}%`)
		),
		columns: {
			corporationId: true,
			name: true,
			ticker: true,
		},
		limit: 20,
	})

	return results
}

async function selectCorporation(
	results: CorporationSearchResult[]
): Promise<CorporationSearchResult | null> {
	if (results.length === 0) {
		return null
	}

	if (results.length === 1) {
		return results[0]
	}

	// Interactive selection (always show, even in quiet mode, since user needs to see it)
	// Temporarily disable quiet mode for selection
	const wasQuiet = quietMode
	quietMode = false

	console.log('\nMultiple corporations found:')
	results.forEach((corp, index) => {
		console.log(`${index + 1}. [${corp.ticker}] ${corp.name} (${corp.corporationId})`)
	})

	const rl = createInterface({ input, output })

	while (true) {
		const answer = await rl.question('\nSelect a corporation (1-' + results.length + '): ')
		const selection = parseInt(answer, 10)

		if (selection >= 1 && selection <= results.length) {
			rl.close()
			quietMode = wasQuiet
			return results[selection - 1]
		}

		console.log('Invalid selection. Please try again.')
	}
}

async function queryKillmails(
	corporationId: string,
	limit?: number,
	offset?: number,
	days?: number
): Promise<
	Array<{
		killmailId: string
		killmailHash: string
		killmailTime: Date
	}>
> {
	const eveCorporationDataDatabaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!eveCorporationDataDatabaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	const db = createDbClient(eveCorporationDataDatabaseUrl, schema)

	// Build WHERE clause
	let whereClause = eq(schema.corporationKillmails.corporationId, corporationId)

	if (days !== undefined) {
		const cutoffDate = new Date()
		cutoffDate.setDate(cutoffDate.getDate() - days)

		whereClause = and(
			whereClause,
			gte(schema.corporationKillmails.killmailTime, cutoffDate)
		) as any
	}

	const killmails = await db.query.corporationKillmails.findMany({
		where: whereClause,
		columns: {
			killmailId: true,
			killmailHash: true,
			killmailTime: true,
		},
		orderBy: (killmails, { desc }) => [desc(killmails.killmailTime)],
		limit,
		offset,
	})

	return killmails
}

async function fetchKillmailDetails(
	killmailId: string,
	killmailHash: string,
	retryCount = 0
): Promise<Killmail> {
	const maxRetries = 3

	// For scripts, we'll fetch directly from ESI public endpoint
	// Killmail details with hash don't require authentication
	const response = await fetch(
		`https://esi.evetech.net/latest/killmails/${killmailId}/${killmailHash}/`
	)

	// Handle 429 rate limiting
	if (response.status === 429) {
		const retryAfter = response.headers.get('Retry-After')
		const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 1

		if (retryCount < maxRetries) {
			logWrite(`\rRate limited, waiting ${waitSeconds}s...`)
			await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
			return fetchKillmailDetails(killmailId, killmailHash, retryCount + 1)
		} else {
			throw new Error(`Rate limit exceeded for killmail ${killmailId} after ${maxRetries} retries`)
		}
	}

	if (!response.ok) {
		throw new Error(
			`Failed to fetch killmail ${killmailId}: ${response.status} ${response.statusText}`
		)
	}

	const data = await response.json()

	// Convert all IDs to strings to match codebase pattern
	return convertKillmailIds(data)
}

function convertKillmailIds(data: any): Killmail {
	// Recursively convert all numeric IDs to strings
	if (typeof data === 'object' && data !== null) {
		if (Array.isArray(data)) {
			return data.map(convertKillmailIds) as any
		}

		const result: any = {}
		for (const [key, value] of Object.entries(data)) {
			// Convert ID fields to strings
			if (
				key.endsWith('_id') ||
				key === 'killmail_id' ||
				key === 'character_id' ||
				key === 'corporation_id' ||
				key === 'alliance_id' ||
				key === 'ship_type_id' ||
				key === 'weapon_type_id' ||
				key === 'item_type_id' ||
				key === 'type_id'
			) {
				result[key] = String(value)
			} else {
				result[key] = convertKillmailIds(value)
			}
		}
		return result
	}

	return data
}

async function resolveAndAddEntityNames(killmail: Killmail): Promise<void> {
	// Collect all entity IDs that need resolution for this killmail
	const entityIds = new Set<string>()

	// Solar system
	if (killmail.solar_system_id) {
		entityIds.add(killmail.solar_system_id)
	}

	// Victim
	if (killmail.victim?.character_id) {
		entityIds.add(killmail.victim.character_id)
	}
	if (killmail.victim?.corporation_id) {
		entityIds.add(killmail.victim.corporation_id)
	}
	if (killmail.victim?.alliance_id) {
		entityIds.add(killmail.victim.alliance_id)
	}
	if (killmail.victim?.ship_type_id) {
		entityIds.add(killmail.victim.ship_type_id)
	}

	// Attackers
	for (const attacker of killmail.attackers || []) {
		if (attacker.character_id) {
			entityIds.add(attacker.character_id)
		}
		if (attacker.corporation_id) {
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

	// Items
	for (const item of killmail.victim?.items || []) {
		if (item.item_type_id) {
			entityIds.add(item.item_type_id)
		}
	}

	if (entityIds.size === 0) {
		return
	}

	// Fetch names from ESI for this killmail with retry on 429
	const ids = Array.from(entityIds)
	const names: Record<string, string> = {}

	const fetchNamesWithRetry = async (retryCount = 0): Promise<void> => {
		const maxRetries = 3

		try {
			const response = await fetch('https://esi.evetech.net/latest/universe/names/', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(ids.map(Number)),
			})

			// Handle 429 rate limiting
			if (response.status === 429) {
				const retryAfter = response.headers.get('Retry-After')
				const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 1

				if (retryCount < maxRetries) {
					logWrite(`\rRate limited on name resolution, waiting ${waitSeconds}s...`)
					await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
					return fetchNamesWithRetry(retryCount + 1)
				}
				// Max retries exceeded, silently fail - names are optional
				return
			}

			if (response.ok) {
				const data = await response.json()
				for (const entry of data) {
					names[String(entry.id)] = entry.name
				}
			}
		} catch (error) {
			// Silently fail - names are optional
		}
	}

	await fetchNamesWithRetry()

	// Add names directly to the killmail object
	// Add solar system name
	if (killmail.solar_system_id) {
		killmail.solar_system_name = names[killmail.solar_system_id]
	}

	// Add names to victim
	if (killmail.victim) {
		if (killmail.victim.character_id) {
			killmail.victim.character_name = names[killmail.victim.character_id]
		}
		if (killmail.victim.corporation_id) {
			killmail.victim.corporation_name = names[killmail.victim.corporation_id]
		}
		if (killmail.victim.alliance_id) {
			killmail.victim.alliance_name = names[killmail.victim.alliance_id]
		}
		if (killmail.victim.ship_type_id) {
			killmail.victim.ship_type_name = names[killmail.victim.ship_type_id]
		}

		// Add names to items
		if (killmail.victim.items) {
			for (const item of killmail.victim.items) {
				if (item.item_type_id) {
					item.item_type_name = names[item.item_type_id]
				}
			}
		}
	}

	// Add names to attackers
	if (killmail.attackers) {
		for (const attacker of killmail.attackers) {
			if (attacker.character_id) {
				attacker.character_name = names[attacker.character_id]
			}
			if (attacker.corporation_id) {
				attacker.corporation_name = names[attacker.corporation_id]
			}
			if (attacker.alliance_id) {
				attacker.alliance_name = names[attacker.alliance_id]
			}
			if (attacker.ship_type_id) {
				attacker.ship_type_name = names[attacker.ship_type_id]
			}
			if (attacker.weapon_type_id) {
				attacker.weapon_type_name = names[attacker.weapon_type_id]
			}
		}
	}
}

function parseArgs() {
	const args = process.argv.slice(2)
	let corporation: string | undefined
	let alliance: string | undefined
	let character: string | undefined
	let limit: number | undefined
	let offset: number | undefined
	let days: number | undefined
	let killsOnly = false
	let outputOnly = false

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]

		if (arg === '--corporation' || arg === '--corp') {
			corporation = args[++i]
		} else if (arg === '--alliance') {
			alliance = args[++i]
		} else if (arg === '--character' || arg === '--char') {
			character = args[++i]
		} else if (arg === '--limit' || arg === '-l') {
			const value = args[++i]
			limit = parseInt(value, 10)
			if (isNaN(limit) || limit < 1) {
				console.error(`Invalid limit value: ${value}`)
				process.exit(1)
			}
		} else if (arg === '--offset' || arg === '-o') {
			const value = args[++i]
			offset = parseInt(value, 10)
			if (isNaN(offset) || offset < 0) {
				console.error(`Invalid offset value: ${value}`)
				process.exit(1)
			}
		} else if (arg === '--days' || arg === '-d') {
			const value = args[++i]
			days = parseInt(value, 10)
			if (isNaN(days) || days < 1) {
				console.error(`Invalid days value: ${value}`)
				process.exit(1)
			}
		} else if (arg === '--kills') {
			killsOnly = true
		} else if (arg === '--output') {
			outputOnly = true
		} else if (arg === '--help' || arg === '-h') {
			console.log('Usage: pnpm -F eve-corporation-data query-killmails [options]')
			console.log('\nEntity Options (choose one):')
			console.log('  --corporation, --corp <name-or-id>  Query killmails for a corporation')
			console.log('  --alliance <id>                     Query killmails for all corps in an alliance')
			console.log('  --character, --char <id>            Query killmails for a character\'s corporation')
			console.log('\nFilter Options:')
			console.log('  --limit, -l <number>                Number of killmails to fetch (default: 100)')
			console.log('  --offset, -o <number>               Skip this many killmails (for pagination, default: 0)')
			console.log('  --days, -d <number>                 Only show killmails from the past N days')
			console.log('  --kills                             Only show kills (exclude losses)')
			console.log('  --output                            Silence all output except final JSON (for piping)')
			console.log('  --help, -h                          Show this help message')
			console.log('\nOutput Format:')
			console.log('  JSON Lines (NDJSON) - one killmail JSON object per line')
			console.log('\nExamples:')
			console.log('  pnpm -F eve-corporation-data query-killmails --corporation "Test Corp"')
			console.log('  pnpm -F eve-corporation-data query-killmails --corp 98012345')
			console.log('  pnpm -F eve-corporation-data query-killmails --alliance 99000001')
			console.log('  pnpm -F eve-corporation-data query-killmails --character 123456789')
			console.log('  pnpm -F eve-corporation-data query-killmails --corp "Corp" --days 7 --kills')
			console.log('\nProcessing with jq (use --silent to suppress pnpm output):')
			console.log('  # Get all killmails with pretty printing')
			console.log('  pnpm --silent -F eve-corporation-data query-killmails --corp "Corp" --output | jq .')
			console.log('  # Filter by ship type')
			console.log('  pnpm --silent -F eve-corporation-data query-killmails --corp "Corp" --output | jq \'select(.victim.ship_type_name == "Rifter")\'')
			console.log('  # Get only victim ship names')
			console.log('  pnpm --silent -F eve-corporation-data query-killmails --corp "Corp" --output | jq -r .victim.ship_type_name')
			console.log('\nOr run directly with tsx:')
			console.log('  cd apps/eve-corporation-data && tsx src/scripts/query-killmails.ts --corp "Corp" --output | jq .')
			process.exit(0)
		} else {
			console.error(`Unknown argument: ${arg}`)
			process.exit(1)
		}
	}

	// Validate that exactly one entity type is specified
	const entityCount = [corporation, alliance, character].filter(Boolean).length
	if (entityCount === 0) {
		console.error('Error: Must specify one of --corporation, --alliance, or --character')
		console.error('Use --help for more information')
		process.exit(1)
	}
	if (entityCount > 1) {
		console.error('Error: Can only specify one of --corporation, --alliance, or --character')
		process.exit(1)
	}

	return {
		corporation,
		alliance,
		character,
		limit: limit || 100,
		offset: offset || 0,
		days,
		killsOnly,
		outputOnly,
	}
}

async function getCorporationsByAlliance(allianceId: string): Promise<CorporationSearchResult[]> {
	const eveCorporationDataDatabaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!eveCorporationDataDatabaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	const corpDataDb = createDbClient(eveCorporationDataDatabaseUrl, schema)

	// Find all corporations with this alliance ID
	const corpInfos = await corpDataDb.query.corporationInfo.findMany({
		where: eq(schema.corporationInfo.allianceId, allianceId),
		columns: {
			corporationId: true,
		},
	})

	if (corpInfos.length === 0) {
		return []
	}

	// Get the full corporation details from managed corporations
	const coreDatabaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!coreDatabaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	const coreDb = createDbClient(coreDatabaseUrl, coreSchema)

	const corporationIds = corpInfos.map((c) => c.corporationId)

	const results = await coreDb.query.managedCorporations.findMany({
		where: inArray(coreSchema.managedCorporations.corporationId, corporationIds),
		columns: {
			corporationId: true,
			name: true,
			ticker: true,
		},
	})

	return results
}

async function getCorporationByCharacter(characterId: string): Promise<CorporationSearchResult | null> {
	const coreDatabaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!coreDatabaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	const coreDb = createDbClient(coreDatabaseUrl, coreSchema)

	// Find which managed corporation this character belongs to via the members table
	const eveCorporationDataDatabaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!eveCorporationDataDatabaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	const memberDb = createDbClient(eveCorporationDataDatabaseUrl, schema)

	const member = await memberDb.query.corporationMembers.findFirst({
		where: eq(schema.corporationMembers.characterId, characterId),
		columns: {
			corporationId: true,
		},
	})

	if (!member) {
		return null
	}

	const corp = await coreDb.query.managedCorporations.findFirst({
		where: eq(coreSchema.managedCorporations.corporationId, member.corporationId),
		columns: {
			corporationId: true,
			name: true,
			ticker: true,
		},
	})

	return corp || null
}

async function main() {
	const { corporation, alliance, character, limit, offset, days, killsOnly, outputOnly } =
		parseArgs()

	// Set global quiet mode
	quietMode = outputOnly

	// Disable stdout buffering when piping
	if (!process.stdout.isTTY) {
		process.stdout.setNoDelay?.(true)
	}

	let corporations: CorporationSearchResult[] = []

	if (corporation) {
		log(`Searching for corporations matching: ${corporation}`)
		corporations = await searchCorporations(corporation)

		if (corporations.length === 0) {
			console.error(`No corporations found matching: ${corporation}`)
			process.exit(1)
		}

		// Select corporation (interactive if multiple matches)
		const selectedCorp = await selectCorporation(corporations)

		if (!selectedCorp) {
			console.error('No corporation selected')
			process.exit(1)
		}

		corporations = [selectedCorp]
	} else if (alliance) {
		log(`Searching for corporations in alliance: ${alliance}`)
		corporations = await getCorporationsByAlliance(alliance)

		if (corporations.length === 0) {
			console.error(`No managed corporations found for alliance: ${alliance}`)
			process.exit(1)
		}

		log(`Found ${corporations.length} corporations in alliance`)
	} else if (character) {
		log(`Finding corporation for character: ${character}`)
		const corp = await getCorporationByCharacter(character)

		if (!corp) {
			console.error(`No managed corporation found for character: ${character}`)
			process.exit(1)
		}

		log(`Found corporation: [${corp.ticker}] ${corp.name}`)
		corporations = [corp]
	}

	// Query killmails from all corporations
	log('\nQuerying killmails...')
	if (corporations.length === 1) {
		const corp = corporations[0]
		log(`Corporation: [${corp.ticker}] ${corp.name} (${corp.corporationId})`)
	} else {
		log(`Querying ${corporations.length} corporations`)
	}

	if (offset > 0) {
		log(`Limit: ${limit}, Offset: ${offset} (skipping first ${offset} killmails)`)
	} else {
		log(`Limit: ${limit}`)
	}
	if (days) {
		log(`Filter: Past ${days} days only`)
	}
	if (killsOnly) {
		log('Filter: Kills only (excluding losses)')
	}

	// Query killmails from all corporations and merge
	let allKillmails: Array<{
		killmailId: string
		killmailHash: string
		killmailTime: Date
	}> = []

	for (const corp of corporations) {
		const killmails = await queryKillmails(corp.corporationId, undefined, undefined, days)
		allKillmails.push(...killmails)
	}

	// Remove duplicates (can happen with alliance queries)
	const uniqueKillmails = Array.from(
		new Map(allKillmails.map((km) => [km.killmailId, km])).values()
	)

	// Sort by time (newest first) and apply offset
	uniqueKillmails.sort((a, b) => b.killmailTime.getTime() - a.killmailTime.getTime())

	// Apply offset but don't apply limit yet - we need to filter first
	const killmailList = uniqueKillmails.slice(offset)

	if (killmailList.length === 0) {
		if (offset > 0) {
			log('\nNo killmails found at this offset.')
			log('Try a smaller offset or check if more killmails are available.')
		} else {
			log('\nNo killmails found in database.')
			log(
				'Note: Killmails are only available if the corporation has been configured with a director character.'
			)
		}
		process.exit(0)
	}

	log(`\nFound ${killmailList.length} killmails. Streaming output...\n`)

	// Process and output each killmail immediately (streaming)
	// Apply limit AFTER filtering, not before
	const corporationIds = new Set(corporations.map((c) => c.corporationId))
	let outputCount = 0
	let filteredCount = 0
	let processedCount = 0

	for (const km of killmailList) {
		// Stop if we've reached the limit
		if (outputCount >= limit) {
			break
		}

		try {
			processedCount++
			logWrite(`\rProcessing killmail ${processedCount}...`)

			// Fetch full details
			const details = await fetchKillmailDetails(km.killmailId, km.killmailHash)

			// Filter to kills only if requested
			if (killsOnly && corporationIds.has(details.victim?.corporation_id || '')) {
				filteredCount++
				continue
			}

			// Resolve and add entity names
			await resolveAndAddEntityNames(details)

			// Output immediately - use console.log which properly adds newlines
			console.log(JSON.stringify(details))

			outputCount++
		} catch (error) {
			console.error(`\nWarning: Failed to fetch killmail ${km.killmailId}:`, error)
		}
	}

	if (killsOnly && filteredCount > 0) {
		log(`\n\nFiltered out ${filteredCount} losses`)
	}

	log(`\n\nTotal: ${outputCount} killmails output`)

	if (outputCount === 0 && killsOnly) {
		log('No kills found (all killmails were losses).')
	}

	// Ensure all output is flushed
	if (process.stdout.isTTY === false) {
		await new Promise<void>((resolve) => {
			process.stdout.write('', () => resolve())
		})
	}
}

main().catch((error) => {
	console.error('\nScript failed:', error)
	process.exit(1)
})
