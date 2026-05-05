import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Textarea } from '@/components/ui/textarea'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { useParseScan, useSubmitScan } from '../hooks'

import type { AnnotatedScan } from '../types'

function ScanPreviewRow({ scan }: { scan: AnnotatedScan }) {
	const secColor =
		scan.secStatus === null
			? 'text-muted-foreground'
			: scan.secStatus < 0.0
				? 'text-red-400'
				: scan.secStatus < 0.5
					? 'text-yellow-400'
					: 'text-green-400'

	return (
		<div className={`flex items-center justify-between rounded border px-3 py-2 text-sm ${scan.eligible ? '' : 'opacity-50'}`}>
			<span className="font-mono text-xs text-muted-foreground">{scan.moonId}</span>
			<div className="flex items-center gap-2">
				<span className={`font-mono text-xs ${secColor}`}>
					{scan.secStatus !== null ? scan.secStatus.toFixed(1) : '?'}
				</span>
				{scan.eligible ? (
					<Badge variant="outline" className="text-green-400 border-green-400/50">eligible</Badge>
				) : (
					<Badge variant="outline" className="text-muted-foreground">high-sec</Badge>
				)}
			</div>
		</div>
	)
}

export default function SubmitScanPage() {
	const { hasPermission, isAdmin } = useUserPermissions()
	const canSubmit = isAdmin || hasPermission('urn:moons:submit')

	const [raw, setRaw] = useState('')
	const parseMutation = useParseScan()
	const submitMutation = useSubmitScan()

	if (!canSubmit) {
		return (
			<Container>
				<PageHeader title="Submit Moon Scan" description="You do not have permission to submit scans." />
			</Container>
		)
	}

	const previewResult = parseMutation.data
	const submitResult = submitMutation.data
	const hasPreview = !!previewResult && !submitResult

	function handleParse() {
		if (!raw.trim()) return
		parseMutation.mutate(raw)
		submitMutation.reset()
	}

	function handleSubmit() {
		if (!raw.trim()) return
		submitMutation.mutate(raw, {
			onSuccess: () => {
				setRaw('')
				parseMutation.reset()
			},
		})
	}

	return (
		<Container>
			<PageHeader
				title="Submit Moon Scan"
				description="Paste moon scan data from the EVE client (Ctrl+A, Ctrl+C in the probe scanner result)"
			/>

			<div className="mt-section space-y-4">
				<Textarea
					placeholder="Paste scan data here..."
					className="min-h-48 font-mono text-xs"
					value={raw}
					onChange={(e) => {
						setRaw(e.target.value)
						parseMutation.reset()
						submitMutation.reset()
					}}
				/>

				<div className="flex gap-2">
					<Button
						variant="outline"
						onClick={handleParse}
						disabled={!raw.trim() || parseMutation.isPending}
					>
						{parseMutation.isPending ? 'Parsing…' : 'Preview'}
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={!raw.trim() || submitMutation.isPending}
					>
						{submitMutation.isPending ? 'Submitting…' : 'Submit'}
					</Button>
				</div>

				{parseMutation.error && (
					<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-400">
						{parseMutation.error instanceof Error ? parseMutation.error.message : 'Parse failed'}
					</div>
				)}

				{submitMutation.error && (
					<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-400">
						{submitMutation.error instanceof Error ? submitMutation.error.message : 'Submit failed'}
					</div>
				)}

				{submitResult && (
					<div className="rounded-lg border border-green-500/50 bg-green-500/10 p-4 space-y-1">
						<p className="text-sm font-medium text-green-400">
							Submitted {submitResult.submitted} scan{submitResult.submitted !== 1 ? 's' : ''}
							{submitResult.autoVerified > 0 && ` (${submitResult.autoVerified} auto-verified)`}
						</p>
						{submitResult.rejected > 0 && (
							<p className="text-xs text-muted-foreground">
								{submitResult.rejected} high-sec system{submitResult.rejected !== 1 ? 's' : ''} skipped
							</p>
						)}
						{submitResult.parseErrors.length > 0 && (
							<ul className="mt-2 space-y-0.5">
								{submitResult.parseErrors.map((e, i) => (
									<li key={i} className="text-xs text-yellow-400">{e}</li>
								))}
							</ul>
						)}
					</div>
				)}

				{hasPreview && previewResult.scans.length > 0 && (
					<div className="rounded-md border bg-card p-4 space-y-3">
						<p className="text-sm font-medium">
							{previewResult.scans.length} moon{previewResult.scans.length !== 1 ? 's' : ''} found
							{' '}({previewResult.scans.filter((s) => s.eligible).length} eligible)
						</p>
						<div className="space-y-1.5">
							{previewResult.scans.map((scan) => (
								<ScanPreviewRow key={scan.moonId} scan={scan} />
							))}
						</div>
						{previewResult.errors.length > 0 && (
							<div className="pt-2 border-t space-y-0.5">
								{previewResult.errors.map((e, i) => (
									<p key={i} className="text-xs text-yellow-400">{e}</p>
								))}
							</div>
						)}
					</div>
				)}

				{hasPreview && previewResult.scans.length === 0 && (
					<div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-400">
						No valid moon scans found in the pasted data.
						{previewResult.errors.length > 0 && (
							<ul className="mt-1 space-y-0.5">
								{previewResult.errors.map((e, i) => (
									<li key={i} className="text-xs">{e}</li>
								))}
							</ul>
						)}
					</div>
				)}
			</div>
		</Container>
	)
}
