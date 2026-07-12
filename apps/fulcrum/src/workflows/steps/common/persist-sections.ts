/**
 * Persist processed section data to permanent R2 paths
 *
 * Array sections with more than CHUNK_THRESHOLD items are split into
 * chunk-{i}.json files under sections/{name}/. Smaller arrays and
 * single-object sections are written as a flat sections/{name}.json.
 *
 * R2 layout (chunked):  character-reports/{characterId}/{reportId}/sections/{name}/chunk-{i}.json
 * R2 layout (flat):     character-reports/{characterId}/{reportId}/sections/{name}.json
 */

import { generateReportPath, retrieveData } from '../../utils/storage'
import { safeJsonStringify } from '../../utils/json'

import type { ReportSectionMeta } from '@repo/fulcrum'
import type { StepResult } from '../../utils/storage'
import { logger } from '@repo/hono-helpers'

/** Maximum items per chunk file. Sections at or below this size stay flat. */
const CHUNK_THRESHOLD = 500

/**
 * Section mapping: process step result variable name -> section slug
 */
interface SectionInput {
	name: string
	result: StepResult
}

/**
 * Write a value to R2 with up to 3 attempts on transient failures.
 */
async function putWithRetry(
	bucket: R2Bucket,
	key: string,
	body: string,
	label: string,
): Promise<void> {
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await bucket.put(key, body, {
				httpMetadata: { contentType: 'application/json' },
			})
			return
		} catch (err) {
			if (attempt === 2) throw err
			logger.warn(`[persistSections] ${label} write attempt ${attempt + 1} failed, retrying...`)
		}
	}
}

/**
 * Persist a single section to R2, chunking if the data is a large array.
 * Returns the ReportSectionMeta to include in the manifest.
 */
async function persistSection(
	bucket: R2Bucket,
	baseKey: string,
	name: string,
	data: unknown,
): Promise<ReportSectionMeta> {
	// wallet-transactions is stored as { transactions: T[], truncated: boolean }
	const isWalletTransactions = name === 'wallet-transactions'
	const truncated = isWalletTransactions && typeof data === 'object' && data !== null
		? (data as { truncated?: boolean }).truncated ?? false
		: undefined

	const items: unknown[] = isWalletTransactions && typeof data === 'object' && data !== null
		? ((data as { transactions?: unknown[] }).transactions ?? [])
		: Array.isArray(data)
			? data
			: []

	const isArray = Array.isArray(data) || isWalletTransactions

	// Flat write: non-array sections or arrays within threshold
	if (!isArray || items.length <= CHUNK_THRESHOLD) {
		const key = `${baseKey}/sections/${name}.json`
		await putWithRetry(bucket, key, safeJsonStringify(data), `section '${name}'`)
		return {
			chunks: 0,
			totalCount: isArray ? items.length : 0,
			...(truncated !== undefined ? { truncated } : {}),
		}
	}

	// Chunked write: split into CHUNK_THRESHOLD-sized files written in parallel
	const chunkCount = Math.ceil(items.length / CHUNK_THRESHOLD)
	await Promise.all(
		Array.from({ length: chunkCount }, (_, i) => {
			const chunk = items.slice(i * CHUNK_THRESHOLD, (i + 1) * CHUNK_THRESHOLD)
			const key = `${baseKey}/sections/${name}/chunk-${i}.json`
			return putWithRetry(bucket, key, safeJsonStringify(chunk), `section '${name}' chunk ${i}`)
		}),
	)

	return {
		chunks: chunkCount,
		totalCount: items.length,
		...(truncated !== undefined ? { truncated } : {}),
	}
}

/**
 * Persist all processed sections to permanent R2 paths
 *
 * @param bucket - R2 bucket
 * @param getBucket - Function to get R2 bucket by name
 * @param characterId - EVE character ID
 * @param reportId - Report UUID
 * @param sections - Array of section inputs with name and step result
 * @returns Object with bucket name and base key prefix
 */
export async function persistSections(
	bucket: R2Bucket,
	getBucket: (name: string) => R2Bucket,
	characterId: string,
	reportId: string,
	sections: SectionInput[],
): Promise<{ bucket: string; key: string; sectionNames: string[] }> {
	const baseKey = generateReportPath(characterId, reportId)
	const sectionMeta: Partial<Record<string, ReportSectionMeta>> = {}

	await Promise.all(
		sections.map(async ({ name, result }) => {
			if (!result.success) {
				logger.log(`[persistSections] Skipping section '${name}': fetch/process failed`)
				return
			}

			try {
				const data = await retrieveData(getBucket, result)
				if (!data) {
					logger.log(`[persistSections] Skipping section '${name}': no data`)
					return
				}

				const meta = await persistSection(bucket, baseKey, name, data)
				sectionMeta[name] = meta
			} catch (error) {
				logger.error(`[persistSections] Failed to persist section '${name}':`, {
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}),
	)

	// Write manifest with section metadata (with retry on failure)
	const manifestKey = `${baseKey}/manifest.json`
	const manifestJson = safeJsonStringify({
		reportId,
		characterId,
		sections: sectionMeta,
		createdAt: new Date().toISOString(),
	})

	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await bucket.put(manifestKey, manifestJson, {
				httpMetadata: { contentType: 'application/json' },
			})
			break
		} catch (error) {
			if (attempt === 2) {
				logger.error('[persistSections] Failed to write manifest after 3 attempts:', {
					error: error instanceof Error ? error.message : String(error),
				})
				throw error
			}
			logger.warn(`[persistSections] Manifest write attempt ${attempt + 1} failed, retrying...`)
		}
	}

	const successfulSections = Object.keys(sectionMeta)
	logger.log(`[persistSections] Persisted ${successfulSections.length}/${sections.length} sections`, {
		successful: successfulSections,
	})

	return {
		bucket: 'CHARACTER_REPORTS',
		key: baseKey,
		sectionNames: successfulSections,
	}
}
