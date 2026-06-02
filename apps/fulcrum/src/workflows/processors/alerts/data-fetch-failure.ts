/**
 * Data Fetch Failure Alert
 *
 * Checks all section step results for failures and generates
 * a critical alert for each one, so reviewers know which data
 * is missing from the report.
 */

import type { StepResult } from '../../utils/storage'
import type { ReportSectionName } from '@repo/fulcrum'
import type { ReportAlert } from './types'

/** Human-readable labels for workflow step names */
const STEP_LABELS: Record<string, string> = {
    'fetch-public-info': 'Public Info',
    'process-public-info': 'Public Info',
    'fetch-assets': 'Assets',
    'process-assets': 'Assets',
    'fetch-asset-names': 'Asset Names',
    'process-fitted-ships': 'Fitted Ships',
    'fetch-wallet-transactions': 'Wallet Transactions',
    'process-wallet-transactions': 'Wallet Transactions',
    'fetch-wallet-journal': 'Wallet Journal',
    'process-wallet-journal': 'Wallet Journal',
    'fetch-mails': 'Mails',
    'process-mails': 'Mails',
    'fetch-contacts': 'Contacts',
    'process-contacts': 'Contacts',
    'fetch-corp-history': 'Corporation History',
    'process-corp-history': 'Corporation History',
    'fetch-skills': 'Skills',
    'process-skills': 'Skills',
    'fetch-contracts': 'Contracts',
    'process-contracts': 'Contracts',
    'fetch-notifications': 'Notifications',
    'process-notifications': 'Notifications',
    'fetch-clones': 'Clones',
    'process-clones': 'Clones',
    'apply-asset-custom-names': 'Asset Custom Names',
    'apply-market-prices': 'Market Prices',
}

/**
 * Non-critical steps produce low-severity alerts instead of critical.
 * These are "nice to have" enrichments, not core data sections.
 */
const NON_CRITICAL_STEPS = new Set(['fetch-asset-names', 'apply-asset-custom-names', 'apply-market-prices'])

const STEP_SECTION_MAP: Record<string, ReportSectionName[]> = {
    'fetch-public-info': ['public-info'],
    'process-public-info': ['public-info'],
    'fetch-assets': ['assets'],
    'process-assets': ['assets'],
    'fetch-asset-names': ['assets', 'fitted-ships'],
    'process-fitted-ships': ['fitted-ships'],
    'fetch-orders': ['orders'],
    'process-orders': ['orders'],
    'fetch-wallet-transactions': ['wallet-transactions'],
    'process-wallet-transactions': ['wallet-transactions'],
    'fetch-wallet-journal': ['wallet-journal'],
    'process-wallet-journal': ['wallet-journal'],
    'fetch-mails': ['mails'],
    'process-mails': ['mails'],
    'fetch-contacts': ['contacts'],
    'process-contacts': ['contacts'],
    'fetch-corp-history': ['corp-history'],
    'process-corp-history': ['corp-history'],
    'fetch-skills': ['skills'],
    'process-skills': ['skills'],
    'fetch-contracts': ['contracts'],
    'process-contracts': ['contracts'],
    'fetch-notifications': ['notifications'],
    'process-notifications': ['notifications'],
    'fetch-clones': ['clones'],
    'process-clones': ['clones'],
}

/**
 * Check all section results for failures and return alerts.
 * Groups fetch+process failures for the same section into a single alert.
 * Non-critical enrichment failures produce low-severity alerts.
 */
export function checkDataFetchFailures(
	sectionResults: Record<string, StepResult>,
): ReportAlert[] {
	// Group failures by their label so fetch-skills + process-skills = one "Skills" alert
	const failuresByLabel = new Map<string, { steps: string[]; errors: string[]; nonCritical: boolean }>()

	for (const [stepName, result] of Object.entries(sectionResults)) {
		if (result.success) continue

		const label = STEP_LABELS[stepName] ?? stepName
		const error = result.source === 'none' ? result.error : 'Unknown failure'
		const nonCritical = NON_CRITICAL_STEPS.has(stepName)

		const existing = failuresByLabel.get(label)
		if (existing) {
			existing.steps.push(stepName)
			existing.errors.push(error)
			// A group is non-critical only if ALL steps in it are non-critical
			existing.nonCritical = existing.nonCritical && nonCritical
		} else {
			failuresByLabel.set(label, { steps: [stepName], errors: [error], nonCritical })
		}
	}

	const alerts: ReportAlert[] = []

	for (const [label, { steps, errors, nonCritical }] of failuresByLabel) {
		const primaryError = errors[0]
		const surfaceSections = Array.from(
			new Set(steps.flatMap((step) => STEP_SECTION_MAP[step] ?? [])),
		)

		alerts.push({
			id: `data-fetch-failure-${steps[0]}`,
			type: 'data-fetch-failure',
			severity: nonCritical ? 'low' : 'critical',
			title: nonCritical ? `Failed to enrich ${label}` : `Failed to load ${label}`,
			description: nonCritical
				? `The ${label} enrichment could not be applied. ${primaryError}`
				: `The ${label} section could not be loaded. ${primaryError}`,
			details: {
				failedSteps: steps,
				errors,
			},
			...(surfaceSections.length > 0 ? { surfaceSections } : {}),
		})
	}

	return alerts
}
