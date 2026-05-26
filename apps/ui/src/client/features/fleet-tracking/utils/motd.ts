/**
 * Convert EVE's pseudo-HTML MOTD into a plain text representation safe for
 * display on the web.
 *
 * EVE MOTDs use <font color="...">, <br>, and <a href="showinfo:..." />
 * /<a href="joinChannel:..." />. None of those work outside the EVE client.
 * We discard font colors, turn <br> into newlines, and unwrap anchors to
 * keep just their visible labels.
 */
export function motdToPlainText(motd: string): string {
	if (!motd) return ''
	let out = motd
	// Normalize line breaks
	out = out.replace(/<br\s*\/?>/gi, '\n')
	// Drop <font ...> open and close tags (keep their inner text)
	out = out.replace(/<font[^>]*>/gi, '')
	out = out.replace(/<\/font>/gi, '')
	// Unwrap anchors — they're EVE-client links that won't work on the web.
	out = out.replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '$1')
	// Strip any remaining HTML tags (defensive)
	out = out.replace(/<[^>]+>/g, '')
	// Decode the most common HTML entities
	out = out
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
	// Collapse 3+ blank lines into max 2
	out = out.replace(/\n{3,}/g, '\n\n')
	return out.trim()
}
