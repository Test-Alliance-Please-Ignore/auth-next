/**
 * HTML report generator using Preact SSR
 * Creates complete HTML documents with embedded data and styling
 */

import { render } from 'preact-render-to-string'
import type { ProcessedPublicInfo } from '../workflows/processors/helpers/public-info'
import { Report } from './components/Report'
import { reportStyles } from './styles/report.css'

/**
 * Generate complete HTML report from processed data
 * Uses Preact SSR to render components to HTML string
 *
 * @param results - Array of processed data from various processors
 * @returns Complete HTML document string with inline CSS and embedded data
 */
export function generateReport(results: unknown[]): string {
	// Render Preact component to HTML string
	const bodyHtml = render(<Report results={results} />)

	// Extract public info for title
	const publicInfo = results[0] as ProcessedPublicInfo | undefined

	// Build complete HTML document with inline styles
	// Note: We don't embed full data in JSON to avoid exceeding 1MiB limit
	// All data is already rendered in the HTML table for client-side filtering
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>EVE Character Report${publicInfo ? ` - ${publicInfo.characterName}` : ''}</title>
	<style>${reportStyles}</style>
</head>
<body>
	${bodyHtml}
</body>
</html>`
}
