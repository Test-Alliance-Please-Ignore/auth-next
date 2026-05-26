import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import type { StatsRange } from '../types'

export type RangePreset = '7d' | '30d' | '90d' | '1y' | 'all'

const PRESETS: Array<{ key: RangePreset; label: string; days: number | null }> = [
	{ key: '7d', label: 'Last 7 days', days: 7 },
	{ key: '30d', label: 'Last 30 days', days: 30 },
	{ key: '90d', label: 'Last 90 days', days: 90 },
	{ key: '1y', label: 'Last year', days: 365 },
	{ key: 'all', label: 'All time', days: null },
]

/**
 * Compute the effective from/to from URL search params.
 * If neither is set, defaults to 30 days back.
 */
export function useRangeFromSearchParams(): { range: Partial<StatsRange>; activePreset: RangePreset | 'custom' } {
	const [params] = useSearchParams()
	const from = params.get('from') ?? undefined
	const to = params.get('to') ?? undefined
	const preset = (params.get('preset') as RangePreset | null) ?? null

	return useMemo(() => {
		const now = new Date()
		if (preset) {
			const p = PRESETS.find((x) => x.key === preset)
			if (p) {
				if (p.days === null) return { range: { from: undefined, to: undefined }, activePreset: 'all' }
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
