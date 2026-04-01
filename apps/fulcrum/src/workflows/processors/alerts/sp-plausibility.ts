/**
 * SP Plausibility Check
 *
 * Compares character total SP against what's plausible for their account age.
 * Base training rate: 2,700 SP/hr (no implants, remaps for worst case).
 * Bonus budget: ~2.75M for tutorials, events, free SP.
 *
 * Thresholds:
 *   > 110% of max plausible → high
 *   > 125% of max plausible → critical
 */

import type { ProcessedPublicInfo } from '../helpers/public-info'
import type { ProcessedSkillsData } from '../helpers/skills'
import type { ReportAlert } from './types'

/** Base training rate without implants (SP per hour) */
const BASE_SP_PER_HOUR = 2_700

/** Bonus SP budget for tutorials, events, free unallocated SP etc. */
const BONUS_SP_BUDGET = 2_750_000

/** Thresholds as multipliers of max plausible SP */
const HIGH_THRESHOLD = 1.10
const CRITICAL_THRESHOLD = 1.25

export function checkSpPlausibility(
    publicInfo: ProcessedPublicInfo,
    skills: ProcessedSkillsData,
): ReportAlert | null {
    if (!publicInfo.birthday || !skills.totalSp) {
        return null
    }

    const birthday = new Date(publicInfo.birthday)
    const now = new Date()
    const ageMs = now.getTime() - birthday.getTime()
    if (ageMs <= 0) return null

    const ageHours = ageMs / (1000 * 60 * 60)
    const ageYears = ageHours / (24 * 365.25)
    const maxPlausibleSp = Math.floor(ageHours * BASE_SP_PER_HOUR) + BONUS_SP_BUDGET
    const totalSp = skills.totalSp
    const ratio = totalSp / maxPlausibleSp

    if (ratio <= HIGH_THRESHOLD) {
        return null
    }

    const severity = ratio > CRITICAL_THRESHOLD ? 'critical' as const : 'high' as const
    const pctOver = Math.round((ratio - 1) * 100)

    return {
        id: 'sp-plausibility',
        type: 'sp-plausibility',
        severity,
        title: 'SP Plausibility Warning',
        description: `Character has ${pctOver}% more SP than the maximum plausible for a ${ageYears.toFixed(1)}-year-old account (${formatSp(totalSp)} SP vs ${formatSp(maxPlausibleSp)} max plausible).`,
        details: {
            totalSp,
            unallocatedSp: skills.unallocatedSp ?? 0,
            accountAgeYears: Math.round(ageYears * 10) / 10,
            maxPlausibleSp,
            ratio: Math.round(ratio * 100) / 100,
        },
    }
}

function formatSp(sp: number): string {
    if (sp >= 1_000_000_000) return `${(sp / 1_000_000_000).toFixed(1)}B`
    if (sp >= 1_000_000) return `${(sp / 1_000_000).toFixed(1)}M`
    if (sp >= 1_000) return `${(sp / 1_000).toFixed(1)}K`
    return String(sp)
}
