import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { PageHeader } from '@/components/ui/page-header'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { useMarkPaid, usePendingPayoutTotal, useRequestsByStatus } from '../hooks'
import { formatISK, formatISKShort, formatRelativeTime } from '../utils'

import type { SRPRequestResponse } from '../types'

export default function PaymentsQueue() {
	const { hasAnyPermission } = useUserPermissions()

	if (!hasAnyPermission('urn:srp:payer', 'urn:srp:manager')) {
		return <Navigate to="/srp" replace />
	}

	return (
		<Container>
			<PageHeader title="Payment Queue" description="Submit approved SRP payouts for payment validation" />
			<div className="mt-section">
				<PaymentStack />
			</div>
		</Container>
	)
}

function PaymentStack() {
	const { data, isLoading, error } = useRequestsByStatus('approved', { limit: 100 })
	const { data: payoutTotalData } = usePendingPayoutTotal()
	const [dismissing, setDismissing] = useState<Set<string>>(new Set())
	const markPaid = useMarkPaid()

	if (isLoading) {
		return (
			<div className="space-y-3 pt-4">
				{[...Array(3)].map((_, i) => (
					<div key={i} className="h-32 animate-pulse rounded-lg bg-muted/30" />
				))}
			</div>
		)
	}

	if (error) {
		return (
			<div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
				<p className="text-sm text-red-500">Failed to load payment queue</p>
			</div>
		)
	}

	const requests = (data?.requests ?? [] as SRPRequestResponse[]).filter((r: SRPRequestResponse) => !dismissing.has(r.id))
	const pendingPayoutTotal = payoutTotalData?.pendingPayoutTotal ?? '0'

	if (requests.length === 0) {
		return (
			<div className="mt-4 rounded-lg border border-dashed p-12 text-center">
				<h3 className="mb-2 font-semibold">All caught up!</h3>
				<p className="text-sm text-muted-foreground">No approved requests awaiting payment submission.</p>
			</div>
		)
	}

	const handleMarkPaid = async (request: SRPRequestResponse) => {
		setDismissing((prev) => new Set([...prev, request.id]))
		try {
			await markPaid.mutateAsync(request.id)
			toast.success(`Marked as payment pending: ${request.shipTypeName}`)
		} catch (e: any) {
			setDismissing((prev) => {
				const next = new Set(prev)
				next.delete(request.id)
				return next
			})
			toast.error('Failed to mark as paid', { description: e.message })
		}
	}

	return (
		<div className="mt-4 space-y-3">
			<Card className="p-4">
				<div className="text-sm text-muted-foreground">Pending Payout Total</div>
				<div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-success">
					{formatISKShort(pendingPayoutTotal)}
				</div>
			</Card>
			{requests.map((req: SRPRequestResponse) => (
				<PaymentCard key={req.id} request={req} onMarkPaid={handleMarkPaid} />
			))}
		</div>
	)
}

function PaymentCard({
	request,
	onMarkPaid,
}: {
	request: SRPRequestResponse
	onMarkPaid: (r: SRPRequestResponse) => void
}) {
	const [copiedField, setCopiedField] = useState<string | null>(null)

	const copyToClipboard = (text: string, field: string, label: string) => {
		void navigator.clipboard.writeText(text).then(() => {
			toast.success(`${label} copied`)
			setCopiedField(field)
			setTimeout(() => setCopiedField(null), 2000)
		})
	}

	const recipient = request.characterName
	const amount = request.approvedAmount ?? '0'
	const reason = `SRP - KM#${request.id}`

	return (
		<Card className="p-4">
			<div className="space-y-1.5">
				<CopyRow
					label="Recipient"
					value={recipient}
					copied={copiedField === 'recipient'}
					onCopy={() => copyToClipboard(recipient, 'recipient', 'Recipient')}
				/>
				<CopyRow
					label="Amount"
					value={amount}
					display={formatISK(amount)}
					copied={copiedField === 'amount'}
					onCopy={() => copyToClipboard(amount, 'amount', 'Amount')}
				/>
				<CopyRow
					label="Reason"
					value={reason}
					copied={copiedField === 'reason'}
					onCopy={() => copyToClipboard(reason, 'reason', 'Reason')}
				/>
			</div>

			<div className="mt-3 flex items-center gap-3 border-t border-border/40 pt-3">
				<Button size="sm" onClick={() => onMarkPaid(request)} className="shrink-0 gap-1">
					<Check className="h-4 w-4" /> Mark Paid
				</Button>
				<div className="text-sm text-muted-foreground">
					<Link
						to={`/srp/review/${request.id}`}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-2 underline-offset-4 hover:underline focus-visible:underline"
					>
						<span className="font-medium">{request.shipTypeName}</span>
						{request.corporationName && <span>· {request.corporationName}</span>}
						<span className="inline-flex items-center gap-1">
							<span>· Lost</span>
							<EveTimeDisplay dateStr={request.lossDate} format="compact" className="text-sm" />
						</span>
						{request.reviewedAt && (
							<span>· Reviewed {formatRelativeTime(request.reviewedAt)}</span>
						)}
					</Link>
				</div>
			</div>
		</Card>
	)
}

function CopyRow({
	label,
	value,
	display,
	copied,
	onCopy,
}: {
	label: string
	value: string
	display?: string
	copied: boolean
	onCopy: () => void
}) {
	return (
		<div className="flex items-center gap-2">
			<span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
			<div
				role="button"
				tabIndex={0}
				onClick={onCopy}
				onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCopy() } }}
				className={`flex cursor-pointer items-center gap-2.5 rounded-md border-2 px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
					copied
						? 'border-teal-500 bg-teal-500/30 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]'
						: 'border-zinc-500/50 bg-zinc-500/20 shadow-sm hover:border-zinc-500/70 hover:bg-zinc-500/30'
				}`}
			>
				<Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
				<span className="font-mono text-base">{display ?? value}</span>
			</div>
		</div>
	)
}
