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

import { ALERT_THRESHOLDS } from '../../../config/alert-thresholds'

import type { ProcessedPublicInfo } from '../helpers/public-info'
import type { ProcessedSkillsData } from '../helpers/skills'
import type { ReportAlert } from './types'

const BASE_SP_PER_HOUR = ALERT_THRESHOLDS.SP_RATE_MAX_PER_HOUR
const BONUS_SP_BUDGET = ALERT_THRESHOLDS.SP_BONUS_THRESHOLD
const HIGH_THRESHOLD = ALERT_THRESHOLDS.SP_HIGH_MULTIPLIER
const CRITICAL_THRESHOLD = ALERT_THRESHOLDS.SP_CRITICAL_MULTIPLIER

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
        surfaceSections: ['public-info'],
    }
}

function formatSp(sp: number): string {
    if (sp >= 1_000_000_000) return `${(sp / 1_000_000_000).toFixed(1)}B`
    if (sp >= 1_000_000) return `${(sp / 1_000_000).toFixed(1)}M`
    if (sp >= 1_000) return `${(sp / 1_000).toFixed(1)}K`
    return String(sp)
}
