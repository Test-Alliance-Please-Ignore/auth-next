import { getRandomHumanReadable } from '@marianmeres/random-human-readable'

function toPascalCase(word: string): string {
	const normalized = word.replace(/[^a-zA-Z0-9]+/g, ' ').trim()
	if (!normalized) return 'Friendly'
	return normalized
		.split(/\s+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
		.join('')
}

export function generateSrpFriendlyToken(): string {
	const generatedParts = getRandomHumanReadable({
		adjCount: 1,
		colorsCount: 0,
		nounsCount: 2,
		syllablesCount: 0,
		digitsCount: 0,
		specialCharsCount: 0,
		randomizeCase: false,
		joinWith: false,
	}) as string[]
	return generatedParts.map((part) => toPascalCase(part)).join('')
}
