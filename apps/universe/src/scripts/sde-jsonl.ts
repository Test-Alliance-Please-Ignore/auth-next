import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const CCP_SDE_JSONL_URL =
	'https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip'
const execFileAsync = promisify(execFile)

type RawSdeMetadata = {
	buildNumber?: unknown
	releaseDate?: unknown
}

export type SdeMetadata = {
	version: string
	buildNumber: number | null
	releaseDate: string | null
}

export function toBoolean(value: number | boolean | null | undefined): boolean {
	return value === true || value === 1
}

export function getEnglishName(
	name: string | Record<string, string> | null | undefined,
	fallback = ''
): string {
	if (typeof name === 'string') {
		return name
	}
	if (name && typeof name === 'object') {
		return name.en ?? Object.values(name)[0] ?? fallback
	}
	return fallback
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await fs.access(path)
		return true
	} catch {
		return false
	}
}

export async function readSdeJsonlTable<T>(sdeDataDir: string, jsonlName: string): Promise<T[]> {
	const jsonlPath = join(sdeDataDir, jsonlName)
	if (!(await fileExists(jsonlPath))) {
		throw new Error(`Could not find required JSONL file ${jsonlName} in ${sdeDataDir}`)
	}

	const content = await fs.readFile(jsonlPath, 'utf-8')
	return content
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as T)
}

export async function readSdeMetadata(sdeDataDir: string): Promise<SdeMetadata | null> {
	const rows = await readSdeJsonlTable<unknown>(sdeDataDir, '_sde.jsonl')
	const first = rows[0]

	if (!first || typeof first !== 'object') {
		return null
	}

	const metadata = first as RawSdeMetadata
	const buildNumber =
		typeof metadata.buildNumber === 'number' && Number.isFinite(metadata.buildNumber)
			? metadata.buildNumber
			: null
	const releaseDate =
		typeof metadata.releaseDate === 'string' && metadata.releaseDate.trim().length > 0
			? metadata.releaseDate
			: null

	if (buildNumber === null && releaseDate === null) {
		return null
	}

	return {
		version: buildNumber !== null ? String(buildNumber) : releaseDate!,
		buildNumber,
		releaseDate,
	}
}

async function downloadFile(url: string, destinationPath: string): Promise<void> {
	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
	}

	await fs.mkdir(dirname(destinationPath), { recursive: true })
	const fileBytes = Buffer.from(await response.arrayBuffer())
	await fs.writeFile(destinationPath, fileBytes)
}

async function extractZip(zipPath: string, outputDir: string): Promise<void> {
	await fs.mkdir(outputDir, { recursive: true })
	try {
		await execFileAsync('unzip', ['-o', zipPath, '-d', outputDir])
	} catch (error) {
		throw new Error(
			`Failed to unzip ${zipPath}. Ensure 'unzip' is installed. ` +
				`${error instanceof Error ? error.message : String(error)}`
		)
	}
}

async function findSdeDataDirectory(rootDir: string, maxDepth = 4): Promise<string | null> {
	const requiredFiles = [
		'_sde.jsonl',
		'categories.jsonl',
		'groups.jsonl',
		'marketGroups.jsonl',
		'types.jsonl',
	]
	const hasRequiredFiles = await Promise.all(requiredFiles.map((name) => fileExists(join(rootDir, name))))
	if (hasRequiredFiles.every(Boolean)) {
		return rootDir
	}

	if (maxDepth <= 0) {
		return null
	}

	const entries = await fs.readdir(rootDir, { withFileTypes: true })
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue
		}
		const candidate = await findSdeDataDirectory(join(rootDir, entry.name), maxDepth - 1)
		if (candidate) {
			return candidate
		}
	}

	return null
}

export async function prepareSdeDataDir(): Promise<string> {
	// eslint-disable-next-line turbo/no-undeclared-env-vars
	const configuredDir = process.env.SDE_DATA_DIR
	if (configuredDir) {
		return configuredDir
	}

	const tempRoot = join(tmpdir(), 'eve-sde-jsonl-latest')
	const zipPath = join(tempRoot, 'eve-online-static-data-latest-jsonl.zip')
	const extractRoot = join(tempRoot, 'extract')

	await fs.mkdir(tempRoot, { recursive: true })

	// Reuse prior extraction if available (avoids re-download/re-extract between import scripts).
	if (await fileExists(extractRoot)) {
		const cachedDetectedDir = await findSdeDataDirectory(extractRoot)
		if (cachedDetectedDir) {
			console.log(`SDE_DATA_DIR not set; reusing extracted CCP JSONL SDE at ${cachedDetectedDir}`)
			return cachedDetectedDir
		}
	}

	if (!(await fileExists(zipPath))) {
		console.log(`SDE_DATA_DIR not set; downloading latest CCP JSONL SDE from ${CCP_SDE_JSONL_URL}`)
		await downloadFile(CCP_SDE_JSONL_URL, zipPath)
	} else {
		console.log(`SDE_DATA_DIR not set; reusing downloaded CCP JSONL zip at ${zipPath}`)
	}

	await fs.rm(extractRoot, { recursive: true, force: true })
	await extractZip(zipPath, extractRoot)

	const detectedDir = await findSdeDataDirectory(extractRoot)
	if (!detectedDir) {
		throw new Error(
			`Unable to locate extracted SDE JSONL directory under ${extractRoot}. ` +
				`Expected files: _sde.jsonl, categories.jsonl, groups.jsonl, marketGroups.jsonl, types.jsonl`
		)
	}

	return detectedDir
}
