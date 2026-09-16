import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Textarea } from '@/components/ui/textarea'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'

import { useParseScan, useSubmitScan } from '../hooks'
import { useMoonScanPermissions } from '../permissions'
import { securityStatusTextClass } from '../security-status'

import type { AnnotatedScan } from '../types'

function ScanPreviewRow({ scan }: { scan: AnnotatedScan }) {
	const { t } = useAppTranslation()

	const secColor = securityStatusTextClass(scan.secStatus)

	return (
		<div
			className={`flex items-center justify-between rounded border px-3 py-2 text-sm ${scan.eligible ? '' : 'opacity-50'}`}
		>
			<span className="font-mono text-xs text-muted-foreground">{scan.moonId}</span>
			<div className="flex items-center gap-2">
				<span className={`font-mono text-xs ${secColor}`}>
					{scan.secStatus !== null ? scan.secStatus.toFixed(1) : '?'}
				</span>
				{scan.eligible ? (
					<Badge variant="ghost" className="text-green-400 border-green-400/50">
						{t('moonScan.eligible')}
					</Badge>
				) : (
					<Badge variant="ghost" className="text-muted-foreground">
						{t('moonScan.highSec')}
					</Badge>
				)}
			</div>
		</div>
	)
}

export default function SubmitScanPage() {
	const { t } = useAppTranslation()

	usePageTitle(t('moonScan.submitMoonScan'))

	const { canSubmit } = useMoonScanPermissions()

	const [raw, setRaw] = useState('')
	const parseMutation = useParseScan()
	const submitMutation = useSubmitScan()

	if (!canSubmit) {
		return (
			<Container>
				<PageHeader
					title={t('moonScan.submitMoonScan')}
					description={t('moonScan.youDoNotHavePermissionToSubmitScans')}
				/>
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
				title={t('moonScan.submitMoonScan')}
				description={t('moonScan.pasteMoonScanDataFromTheEveClientCtrlA')}
			/>

			<div className="mt-section space-y-4">
				<Card>
					<CardContent className="space-y-4 p-4">
						<Textarea
							placeholder={t('moonScan.pasteScanDataHere')}
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
								variant="ghost"
								onClick={handleParse}
								disabled={!raw.trim() || parseMutation.isPending}
							>
								{parseMutation.isPending ? t('moonScan.parsing') : t('moonScan.preview')}
							</Button>
							<Button onClick={handleSubmit} disabled={!raw.trim() || submitMutation.isPending}>
								{submitMutation.isPending ? t('moonScan.submitting') : t('moonScan.submit')}
							</Button>
						</div>

						{parseMutation.error && (
							<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-400">
								{parseMutation.error instanceof Error
									? parseMutation.error.message
									: t('moonScan.parseFailed')}
							</div>
						)}

						{submitMutation.error && (
							<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-400">
								{submitMutation.error instanceof Error
									? submitMutation.error.message
									: t('moonScan.submitFailed')}
							</div>
						)}

						{submitResult && (
							<div className="rounded-lg border border-green-500/50 bg-green-500/10 p-4 space-y-1">
								<p className="text-sm font-medium text-green-400">
									{t('moonScan.submitted2')}
									{t('moonScan.scanCount', { count: submitResult.submitted })}
									{submitResult.autoVerified > 0 &&
										t('moonScan.autoVerifiedCount', { value1: submitResult.autoVerified })}
								</p>
								{submitResult.rejected > 0 && (
									<p className="text-xs text-muted-foreground">
										{t('moonScan.skippedHighSecSystems', { value1: submitResult.rejected })}
									</p>
								)}
								{submitResult.parseErrors.length > 0 && (
									<ul className="mt-2 space-y-0.5">
										{submitResult.parseErrors.map((e, i) => (
											<li key={i} className="text-xs text-yellow-400">
												{e}
											</li>
										))}
									</ul>
								)}
							</div>
						)}
					</CardContent>
				</Card>

				{hasPreview && previewResult.scans.length > 0 && (
					<Card>
						<CardContent className="space-y-3 p-4">
							<p className="text-sm font-medium">
								{t('moonScan.previewMoonCounts', {
									value1: previewResult.scans.length,
									value2: previewResult.scans.filter((s) => s.eligible).length,
								})}
							</p>
							<div className="space-y-1.5">
								{previewResult.scans.map((scan) => (
									<ScanPreviewRow key={scan.moonId} scan={scan} />
								))}
							</div>
							{previewResult.errors.length > 0 && (
								<div className="pt-2 border-t space-y-0.5">
									{previewResult.errors.map((e, i) => (
										<p key={i} className="text-xs text-yellow-400">
											{e}
										</p>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				)}

				{hasPreview && previewResult.scans.length === 0 && (
					<div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-400">
						{t('moonScan.noValidMoonScansFoundInThePastedData')}
						{previewResult.errors.length > 0 && (
							<ul className="mt-1 space-y-0.5">
								{previewResult.errors.map((e, i) => (
									<li key={i} className="text-xs">
										{e}
									</li>
								))}
							</ul>
						)}
					</div>
				)}
			</div>
		</Container>
	)
}
