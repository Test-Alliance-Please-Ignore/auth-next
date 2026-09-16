import { useMemo } from 'react'
import { useSearchParams } from 'react-router'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { i18n } from '@/i18n'

import type { StatsRangeInput } from '../types'

export type RangePreset = '7d' | '30d' | '90d' | '1y' | 'all'

const PRESETS: Array<{ key: RangePreset; label: string; days: number | null }> = [
	{
		key: '7d',
		get label() {
			return i18n.t('fleetTracking.last7Days')
		},
		days: 7,
	},
	{
		key: '30d',
		get label() {
			return i18n.t('fleetTracking.last30Days')
		},
		days: 30,
	},
	{
		key: '90d',
		get label() {
			return i18n.t('fleetTracking.last90Days')
		},
		days: 90,
	},
	{
		key: '1y',
		get label() {
			return i18n.t('fleetTracking.lastYear')
		},
		days: 365,
	},
	{
		key: 'all',
		get label() {
			return i18n.t('fleetTracking.allTime')
		},
		days: null,
	},
]

/**
 * Compute the effective from/to from URL search params.
 * If neither is set, defaults to 30 days back.
 */
export function useRangeFromSearchParams(): {
	range: StatsRangeInput
	activePreset: RangePreset | 'custom'
} {
	const [params] = useSearchParams()
	const from = params.get('from') ?? undefined
	const to = params.get('to') ?? undefined
	const preset = (params.get('preset') as RangePreset | null) ?? null

	return useMemo(() => {
		const now = new Date()
		if (preset) {
			const p = PRESETS.find((x) => x.key === preset)
			if (p) {
				if (p.days === null) return { range: { allTime: true }, activePreset: 'all' }
				const start = new Date(now.getTime() - p.days * 24 * 60 * 60 * 1000)
				return {
					range: { from: start.toISOString(), to: now.toISOString() },
					activePreset: p.key,
				}
			}
		}
		if (from || to) {
			return { range: { from, to }, activePreset: 'custom' as const }
		}
		const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
		return {
			range: { from: start.toISOString(), to: now.toISOString() },
			activePreset: '30d',
		}
	}, [from, to, preset])
}

export function StatsRangePicker() {
	const [params, setParams] = useSearchParams()
	const { activePreset } = useRangeFromSearchParams()

	const setPreset = (key: RangePreset) => {
		const next = new URLSearchParams(params)
		next.set('preset', key)
		next.delete('from')
		next.delete('to')
		setParams(next)
	}

	// activePreset can be 'custom' (when from/to are set explicitly); Tabs is fine with
	// an unmatched value — it just renders no active trigger.
	return (
		<Tabs value={activePreset} onValueChange={(v) => setPreset(v as RangePreset)}>
			<TabsList>
				{PRESETS.map((p) => (
					<TabsTrigger key={p.key} value={p.key}>
						{p.label}
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	)
}
