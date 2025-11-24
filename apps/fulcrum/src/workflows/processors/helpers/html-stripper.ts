/**
 * Shared utility for stripping HTML tags from text content
 * Used across various processors to convert HTML content to plain text
 */

/**
 * Strip HTML tags and convert content to plain text
 * Handles common HTML entities and EVE Online specific formatting
 *
 * @param html - HTML content to strip
 * @returns Plain text with HTML removed and formatting preserved
 */
export function stripHtmlToPlainText(html?: string): string | undefined {
	if (!html) return undefined

	// First, decode HTML entities
	let plainText = html
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ')

	// Strip HTML tags but preserve line breaks
	plainText = plainText
		.replace(/<br\s*\/?>/gi, '\n')  // Convert <br> to newlines
		.replace(/<\/p>/gi, '\n\n')     // Convert </p> to double newline
		.replace(/<\/div>/gi, '\n')     // Convert </div> to newline
		.replace(/<\/tr>/gi, '\n')      // Convert </tr> to newline (for tables)
		.replace(/<li>/gi, '• ')        // Convert <li> to bullet points
		.replace(/<\/li>/gi, '\n')      // Convert </li> to newline
		.replace(/<[^>]*>/g, '')        // Remove all remaining HTML tags

	// Convert EVE mail links to plain text
	// Example: showinfo:1377//98765432 -> [character: 98765432]
	plainText = plainText.replace(
		/showinfo:(\d+)\/\/(\d+)/g,
		(match, typeId, entityId) => {
			// Type 1377 is character, 2 is corporation, 16159 is alliance
			const entityType =
				typeId === '1377' ? 'character' :
				typeId === '2' ? 'corporation' :
				typeId === '16159' ? 'alliance' :
				typeId === '1373' ? 'agent' :
				typeId === '1378' ? 'NPC' :
				typeId === '30' ? 'station' :
				typeId === '5' ? 'system' : 'entity'
			return `[${entityType}: ${entityId}]`
		}
	)

	// Clean up excessive whitespace
	plainText = plainText
		.replace(/\n{3,}/g, '\n\n')     // Limit to max 2 consecutive newlines
		.replace(/[ \t]+/g, ' ')         // Collapse multiple spaces/tabs to single space
		.replace(/\n[ \t]+/g, '\n')      // Remove leading spaces on lines
		.trim()                          // Remove leading/trailing whitespace

	return plainText
}

/**
 * Strip HTML from text but preserve it for safe display in HTML context
 * Escapes HTML tags instead of removing them
 *
 * @param html - HTML content to escape
 * @returns HTML-escaped text safe for display
 */
export function escapeHtmlForDisplay(html?: string): string | undefined {
	if (!html) return undefined

	return html
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}