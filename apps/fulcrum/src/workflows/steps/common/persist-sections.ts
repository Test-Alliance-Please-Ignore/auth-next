/**
 * Persist processed section data to permanent R2 paths
 *
 * Instead of generating HTML, this step saves each section's processed JSON
 * to a permanent R2 location so the React SPA can fetch them individually.
 *
 * R2 layout: character-reports/{characterId}/{reportId}/sections/{sectionName}.json
 */

import { generateReportPath, retrieveData } from '../../utils/storage'
import { safeJsonStringify } from '../../utils/json'

import type { StepResult } from '../../utils/storage'

/**
 * Section mapping: process step result variable name -> section slug
 */
interface SectionInput {
	name: string
	result: StepResult
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
	const successfulSections: string[] = []

	await Promise.all(
		sections.map(async ({ name, result }) => {
			if (!result.success) {
				console.log(`[persistSections] Skipping section '${name}': fetch/process failed`)
				return
			}

			try {
				const data = await retrieveData(getBucket, result)
				if (!data) {
					console.log(`[persistSections] Skipping section '${name}': no data`)
					return
				}

				const sectionKey = `${baseKey}/sections/${name}.json`
				const json = safeJsonStringify(data)

				// Retry section writes up to 2 times on transient R2 failures
				for (let attempt = 0; attempt < 3; attempt++) {
					try {
						await bucket.put(sectionKey, json, {
							httpMetadata: {
								contentType: 'application/json',
							},
						})
						break
					} catch (putError) {
						if (attempt === 2) throw putError
						console.warn(`[persistSections] Section '${name}' write attempt ${attempt + 1} failed, retrying...`)
					}
				}

				successfulSections.push(name)
			} catch (error) {
				console.error(`[persistSections] Failed to persist section '${name}':`, {
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}),
	)

	// Store a manifest listing available sections (with retry on failure)
	const manifestKey = `${baseKey}/manifest.json`
	const manifestJson = safeJsonStringify({
		reportId,
		characterId,
		sections: successfulSections,
		createdAt: new Date().toISOString(),
	})

	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await bucket.put(manifestKey, manifestJson, {
				httpMetadata: {
					contentType: 'application/json',
				},
			})
			break
		} catch (error) {
			if (attempt === 2) {
				console.error('[persistSections] Failed to write manifest after 3 attempts:', {
					error: error instanceof Error ? error.message : String(error),
				})
				throw error
			}
			console.warn(`[persistSections] Manifest write attempt ${attempt + 1} failed, retrying...`)
		}
	}

	console.log(`[persistSections] Persisted ${successfulSections.length}/${sections.length} sections`, {
		successful: successfulSections,
	})

	return {
		bucket: 'CHARACTER_REPORTS',
		key: baseKey,
		sectionNames: successfulSections,
	}
}
