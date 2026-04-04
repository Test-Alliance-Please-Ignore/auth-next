#!/usr/bin/env node
/**
 * Codemod: Migrate Badge className color patterns to variant props
 * - Converts hardcoded color classNames on <Badge> elements to variant props
 * - Renames variant="outline" to variant="ghost"
 * - Strips color-related classes from className, preserving structural ones
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

// ─── Color → variant mapping ─────────────────────────────────────────────────
const COLOR_TO_VARIANT = [
	[/bg-green-/, 'success'],
	[/bg-yellow-|bg-amber-/, 'warning'],
	[/bg-red-/, 'destructive'],
	[/bg-blue-/, 'default'],
	[/bg-purple-/, 'purple'],
	[/bg-gray-|bg-grey-/, 'ghost'],
	[/bg-primary/, 'default'],
	[/bg-warning/, 'warning'],
	[/bg-success/, 'success'],
	[/bg-destructive/, 'destructive'],
	[/bg-secondary/, 'secondary'],
	[/bg-muted/, 'ghost'],
]

// Classes to strip (color-related)
const COLOR_CLASS_PATTERNS = [
	/^bg-\S+$/,
	/^text-(primary|secondary|success|warning|destructive|muted-foreground|foreground|green-\d+|red-\d+|blue-\d+|yellow-\d+|amber-\d+|purple-\d+|gray-\d+)$/,
	/^border-(primary|secondary|success|warning|destructive|muted|green-\d+|red-\d+|blue-\d+|yellow-\d+|amber-\d+|purple-\d+|gray-\d+|transparent)[\S]*$/,
	/^hover:bg-\S+$/,
]

function isColorClass(cls) {
	return COLOR_CLASS_PATTERNS.some((p) => p.test(cls))
}

function detectVariant(className) {
	for (const [pattern, variant] of COLOR_TO_VARIANT) {
		if (pattern.test(className)) return variant
	}
	return null
}

function stripColorClasses(className) {
	return className
		.split(/\s+/)
		.filter((cls) => cls && !isColorClass(cls))
		.join(' ')
}

/**
 * Process a single file content. Returns modified content and change count.
 */
function processFile(content) {
	let changes = 0

	// Pass 1: variant="outline" → variant="ghost" on Badge elements
	// Match the pattern specifically on Badge JSX attributes
	const outlineReplaced = content.replace(
		/(<Badge\b[^>]*?)\bvariant="outline"([^>]*?>)/g,
		(match, before, after) => {
			changes++
			return `${before}variant="ghost"${after}`
		}
	)
	if (outlineReplaced !== content) content = outlineReplaced

	// Pass 2: Detect Badge elements with color className and add/replace variant
	// We process Badge JSX elements with a static string className
	// Match: <Badge (attrs) className="...color classes..." (more attrs)>
	// Strategy: find Badge opening tags with className containing bg- patterns
	content = content.replace(
		// Match <Badge ...className="<something with bg->"...>
		/<Badge(\s[^>]*?)className="([^"]*bg-[^"]*)"([^>]*?)>/g,
		(match, before, classValue, after) => {
			const variant = detectVariant(classValue)
			if (!variant) return match // no color detected, skip

			const remaining = stripColorClasses(classValue)

			// Check if a variant prop already exists in the element
			const hasVariant = /\bvariant=/.test(before) || /\bvariant=/.test(after)

			let newBefore = before
			let newAfter = after

			if (!hasVariant) {
				// Insert variant just before className
				newBefore = before + ` variant="${variant}"`
			} else {
				// Replace existing variant value
				const replaceVariant = (s) => s.replace(/\bvariant="[^"]*"/, `variant="${variant}"`)
				newBefore = replaceVariant(newBefore)
				newAfter = replaceVariant(newAfter)
			}

			changes++

			if (remaining.trim()) {
				return `<Badge${newBefore}className="${remaining.trim()}"${newAfter}>`
			} else {
				// Remove className entirely (trim surrounding spaces)
				return `<Badge${newBefore.replace(/\s+$/, '')}${newAfter.trimStart()}>`
			}
		}
	)

	return { content, changes }
}

// ─── File walker ─────────────────────────────────────────────────────────────
function walkTsx(dir, results = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules') continue
		const full = join(dir, entry)
		const stat = statSync(full)
		if (stat.isDirectory()) {
			walkTsx(full, results)
		} else if (entry.endsWith('.tsx') && !entry.includes('.bak')) {
			results.push(full)
		}
	}
	return results
}

// ─── Main ────────────────────────────────────────────────────────────────────
const files = walkTsx('apps/ui/src/client')

let totalFiles = 0
let totalChanges = 0
const changed = []

for (const file of files) {
	const original = readFileSync(file, 'utf8')
	const { content, changes } = processFile(original)

	if (changes > 0 && content !== original) {
		writeFileSync(file, content, 'utf8')
		changed.push({ file, changes })
		totalFiles++
		totalChanges += changes
	}
}

console.log(`\nBadge variant codemod complete:`)
console.log(`  Files modified: ${totalFiles}`)
console.log(`  Total changes:  ${totalChanges}`)
if (changed.length > 0) {
	console.log('\nChanged files:')
	for (const { file, changes } of changed) {
		console.log(`  ${changes}x  ${file}`)
	}
}
