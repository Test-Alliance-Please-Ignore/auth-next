import { useQuery } from '@tanstack/react-query'
import { Download, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'

import { fleetTrackingApi } from '../api'
import { fleetStatsKeys, useCorporationParticipationExportMonths } from '../hooks'

interface CorporationParticipationExportDialogProps {
	corporationId: string
	open: boolean
	onOpenChange: (open: boolean) => void
}

function monthRange(year: number, monthIndex: number): { from: string; to: string } {
	return {
		from: new Date(Date.UTC(year, monthIndex, 1)).toISOString(),
		to: new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString(),
	}
}

export function CorporationParticipationExportDialog({
	corporationId,
	open,
	onOpenChange,
}: CorporationParticipationExportDialogProps) {
	const { data: monthData, isLoading: monthsLoading } = useCorporationParticipationExportMonths(
		corporationId,
		{ enabled: open }
	)
	const [period, setPeriod] = useState('month-to-date')
	const [pending, setPending] = useState<{ workflowInstanceId: string; fileName: string } | null>(
		null
	)
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const months = monthData?.months ?? []
	const periodOptions = useMemo(() => {
		const now = new Date()
		const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
		const previousMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
		const previousMonth = `${previousMonthDate.getUTCFullYear()}-${String(
			previousMonthDate.getUTCMonth() + 1
		).padStart(2, '0')}`
		const representedMonths = new Set([currentMonth, previousMonth])

		return [
			{ value: 'month-to-date', label: 'Month to date' },
			{ value: 'last-month', label: 'Last month' },
			...months
				.filter((month) => !representedMonths.has(month.month))
				.map((month) => ({
					value: `month:${month.month}`,
					label: new Date(`${month.month}-01T00:00:00Z`).toLocaleDateString(undefined, {
						month: 'long',
						year: 'numeric',
						timeZone: 'UTC',
					}),
				})),
		]
	}, [months])

	const selectedRange = useMemo(() => {
		const now = new Date()
		if (period === 'month-to-date') {
			return monthRange(now.getUTCFullYear(), now.getUTCMonth())
		}
		if (period === 'last-month') {
			return monthRange(now.getUTCFullYear(), now.getUTCMonth() - 1)
		}
		if (!period.startsWith('month:')) return null
		return months.find((month) => `month:${month.month}` === period) ?? null
	}, [months, period])

	const statusQuery = useQuery({
		queryKey: fleetStatsKeys.corporationExportStatus(
			corporationId,
			pending?.workflowInstanceId ?? ''
		),
		queryFn: () =>
			fleetTrackingApi.getCorporationParticipationExportStatus(
				corporationId,
				pending!.workflowInstanceId
			),
		enabled: open && Boolean(pending),
		refetchInterval: (query) =>
			query.state.data?.status === 'queued' || query.state.data?.status === 'running'
				? 3000
				: false,
		refetchOnWindowFocus: false,
	})

	useEffect(() => {
		if (!pending || statusQuery.data?.status !== 'completed') return
		void fleetTrackingApi
			.downloadCorporationParticipationExport(
				corporationId,
				pending.workflowInstanceId,
				pending.fileName
			)
			.then(() => onOpenChange(false))
			.catch((downloadError: unknown) => {
				setError(downloadError instanceof Error ? downloadError.message : 'Download failed')
			})
			.finally(() => setPending(null))
	}, [corporationId, onOpenChange, pending, statusQuery.data?.status])

	useEffect(() => {
		if (statusQuery.data?.status === 'failed' || statusQuery.data?.status === 'unknown') {
			setError('The fleet participation export failed.')
			setPending(null)
		}
	}, [statusQuery.data?.status])

	const handleSubmit = async () => {
		if (!selectedRange || submitting || pending) return
		setSubmitting(true)
		setError(null)
		try {
			const result = await fleetTrackingApi.startCorporationParticipationExport(
				corporationId,
				selectedRange.from,
				selectedRange.to
			)
			setPending({ workflowInstanceId: result.workflowInstanceId, fileName: result.fileName })
		} catch (submitError: unknown) {
			setError(submitError instanceof Error ? submitError.message : 'Unable to start export')
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Export fleet participation</DialogTitle>
					<DialogDescription>
						Export one row per corporation member and tracked fleet session for the selected period.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<label className="block text-sm font-medium" htmlFor="fleet-export-period">
						Period
					</label>
					<Select
						inputId="fleet-export-period"
						options={periodOptions}
						value={period}
						onValueChange={setPeriod}
						searchable
						placeholder="Select period"
						loading={monthsLoading}
						disabled={Boolean(pending)}
						className="w-full"
					/>
					{pending && <p className="text-sm text-muted-foreground">Preparing your CSV...</p>}
					{error && <p className="text-sm text-destructive">{error}</p>}
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
						Cancel
					</Button>
					<Button
						onClick={() => void handleSubmit()}
						disabled={!selectedRange || submitting || Boolean(pending)}
					>
						{submitting || pending ? <Loader2 className="animate-spin" /> : <Download />}
						{pending ? 'Exporting...' : 'Export CSV'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
