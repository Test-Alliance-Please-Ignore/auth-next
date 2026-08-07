import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as cliProgress from 'cli-progress'
import { config } from 'dotenv'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../.env') })

/**
 * Download all EVE Online SDE JSON tables from https://sde.zzeve.com
 *
 * This script fetches the table index and downloads all JSON tables
 * to a local directory for offline processing.
 */

interface TableInfo {
	name: string
	href: string
}

async function fetchSDEData(
	url: string,
	onProgress?: (received: number, total: number) => void,
	timeoutMs = 1800000 // 30 minutes for large files
) {
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(timeoutMs),
		})
		if (!response.ok) {
			throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
		}

		const contentLength = response.headers.get('content-length')
		const total = contentLength ? parseInt(contentLength) : 0

		if (!response.body) {
			throw new Error('Response body is null')
		}

		const reader = response.body.getReader()
		const chunks: Uint8Array[] = []
		let received = 0

		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			chunks.push(value)
			received += value.length

			if (onProgress) {
				onProgress(received, total)
			}
		}

		// Concatenate all chunks into a single Uint8Array
		const allChunks = new Uint8Array(received)
		let position = 0
		for (const chunk of chunks) {
			allChunks.set(chunk, position)
			position += chunk.length
		}

		// Convert to string
		return new TextDecoder().decode(allChunks)
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new Error(`Timeout fetching ${url} - file may be too large`)
		}
		throw error
	}
}

async function downloadTable(table: TableInfo, outputDir: string, multibar: cliProgress.MultiBar) {
	const fileName = `${table.name}.json`
	const outputPath = resolve(outputDir, fileName)

	const progressState: { bar: cliProgress.SingleBar | null; total: number } = {
		bar: null,
		total: 0,
	}

	const jsonText = await fetchSDEData(table.href, (received, total) => {
		// Create the progress bar on first update with the correct total
		if (!progressState.bar && total > 0) {
			progressState.total = total
			progressState.bar = multibar.create(total, 0, {
				filename: fileName,
				size: '0 / 0 MB',
			})
		}

		if (progressState.bar) {
			const receivedMB = (received / 1024 / 1024).toFixed(2)
			const totalMB = (progressState.total / 1024 / 1024).toFixed(2)
			progressState.bar.update(received, {
				size: `${receivedMB} / ${totalMB} MB`,
			})
		}
	})

	// Ensure the bar is complete
	if (progressState.bar && progressState.total > 0) {
		progressState.bar.update(progressState.total)
		progressState.bar.stop()
	}

	await writeFile(outputPath, jsonText, 'utf-8')
}

async function main() {
	const outputDir = resolve(__dirname, '../../../tmp/sde-data')

	console.log('Starting EVE SDE download...')
	console.log(`Output directory: ${outputDir}\n`)

	try {
		// Create output directory if it doesn't exist
		await mkdir(outputDir, { recursive: true })

		// Fetch table index
		console.log('Fetching table index...')
		const indexText = await fetchSDEData('https://sde.zzeve.com/tables.json')
		const tables: TableInfo[] = JSON.parse(indexText)

		console.log(`Found ${tables.length} tables to download\n`)

		// Create a multi-bar container for overall progress
		const multibar = new cliProgress.MultiBar(
			{
				clearOnComplete: false,
				hideCursor: true,
				format: ' {bar} | {filename} | {size} | {value}/{total} ({percentage}%) | ETA: {eta}s',
			},
			cliProgress.Presets.shades_classic
		)

		// Create overall progress bar
		const overallBar = multibar.create(tables.length, 0, {
			filename: 'Overall Progress',
		})

		// Download all tables
		let successCount = 0
		let failureCount = 0

		for (const table of tables) {
			try {
				await downloadTable(table, outputDir, multibar)

				// Update overall progress
				successCount++
				overallBar.increment()
			} catch (error) {
				console.error(`  ✗ Failed to download ${table.name}:`, error)
				failureCount++
				overallBar.increment()
			}
		}

		// Stop all bars
		multibar.stop()

		console.log('\n' + '='.repeat(80))
		console.log(`Download complete!`)
		console.log(`  Successful: ${successCount}`)
		console.log(`  Failed: ${failureCount}`)
		console.log(`  Total: ${tables.length}`)
		console.log(`\nFiles saved to: ${outputDir}`)

		if (failureCount > 0) {
			process.exit(1)
		}
	} catch (error) {
		console.error('Download failed:', error)
		process.exit(1)
	}

	process.exit(0)
}

void main()
