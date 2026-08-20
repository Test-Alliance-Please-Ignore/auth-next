import { getEsiInstanceForCharacter } from '@repo/esi'
import { logger } from '@repo/hono-helpers'
import { parseEsiErrorMetadata, retryWithBackoff } from '@repo/workflow-utils'

function getErrorStatus(error: unknown): number | null {
	if (!(error instanceof Error)) return null
	const metadata = parseEsiErrorMetadata(error.message)
	const status = metadata?.status
	return typeof status === 'number' ? status : null
}

function isForbiddenStructureError(error: unknown): boolean {
	const status = getErrorStatus(error)
	if (status === 403) return true
	if (!(error instanceof Error)) return false
	const message = error.message.toLowerCase()
	return message.includes('esi request failed: 403') || message.includes('forbidden')
}

export class StructureResolutionCoordinator {
	private readonly resolvedStructureNames = new Map<string, string>()
	private readonly deniedStructureIds = new Set<string>()

	async resolveStructureNames(
		env: {
			ESI: DurableObjectNamespace
		},
		characterId: string,
		structureIds: Iterable<string>,
		label: string
	): Promise<Record<string, string>> {
		const resolved: Record<string, string> = {}
		const esiStub = getEsiInstanceForCharacter(env.ESI, characterId)
		const DELAY_MS = 200
		const uniqueStructureIds = Array.from(new Set(structureIds))
		let processed = 0

		for (const structureId of uniqueStructureIds) {
			processed += 1

			if (this.deniedStructureIds.has(structureId)) {
				continue
			}

			const cachedName = this.resolvedStructureNames.get(structureId)
			if (cachedName) {
				resolved[structureId] = cachedName
				continue
			}

			try {
				const structureInfo = await retryWithBackoff(
					async () => esiStub.fetchStructureInfo(characterId, structureId),
					{
						maxRetries: 3,
						initialDelayMs: 1000,
						maxDelayMs: 30000,
						backoffMultiplier: 2,
						onRetry: (attempt, error, delayMs) => {
							logger.warn(`[${label}] Retrying structure fetch after rate limit`, {
								structureId,
								attempt,
								delayMs,
								error: error.message,
							})
						},
					}
				)
				if (structureInfo) {
					this.resolvedStructureNames.set(structureId, structureInfo.name)
					resolved[structureId] = structureInfo.name
				}
			} catch (error) {
				if (isForbiddenStructureError(error)) {
					this.deniedStructureIds.add(structureId)
					logger.warn(`[${label}] Structure access denied, skipping future lookups`, {
						structureId,
						characterId,
						error: error instanceof Error ? error.message : String(error),
					})
				} else {
					logger.warn(`[${label}] Failed to fetch structure info`, {
						structureId,
						characterId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}

			if (processed < uniqueStructureIds.length) {
				await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
			}
		}

		return resolved
	}

	getDeniedCount(): number {
		return this.deniedStructureIds.size
	}
}
