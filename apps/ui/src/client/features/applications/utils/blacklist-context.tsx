import type { ReactNode } from 'react'

import { formatStandingLabel, getStandingColorClass } from './standing'

const CONTACT_STANDING_PATTERN =
	/^In contacts with standing\s+(?:<span\s+style="[^"]+">)?([+-]?\d+(?:\.\d+)?)(?:<\/span>)?$/i

export function renderBlacklistContextLine(context: string): ReactNode {
	const trimmed = context.trim()
	if (!trimmed) return null

	const standingMatch = trimmed.match(CONTACT_STANDING_PATTERN)
	if (standingMatch) {
		const standing = Number.parseFloat(standingMatch[1])
		if (Number.isFinite(standing)) {
			return (
				<>
					In contacts with standing{' '}
					<span className={getStandingColorClass(standing)}>{formatStandingLabel(standing)}</span>
				</>
			)
		}
	}

	return trimmed
}
