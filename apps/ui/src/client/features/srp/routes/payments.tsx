import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { RequestStatusBadge } from '../components/RequestStatusBadge'
import { useMarkPaid, useRequestsByStatus } from '../hooks'
import { formatISK, formatRelativeTime } from '../utils'

import type { SRPRequestResponse } from '../types'

export default function PaymentsQueue() {
	const { hasPermission } = useUserPermissions()

	if (!hasPermission('urn:srp:payer')) {
		return <Navigate to="/srp" replace />
	}

	return (
		<Container>
			<PageHeader title="Payment Queue" description="Process approved ship replacement payments" />

			<Tabs defaultValue="approved" className="mt-section">
				<TabsList>
					<TabsTrigger value="approved">To Pay</TabsTrigger>
					<TabsTrigger value="paid">Paid</TabsTrigger>
				</TabsList>

				<TabsContent value="approved">
					<PaymentStack />
				</TabsContent>

				<TabsContent value="paid">
					<PaidList />
				</TabsContent>
			</Tabs>
		</Container>
	)
}

function PaymentStack() {
	const { data, isLoading, error } = useRequestsByStatus('approved', { limit: 100 })
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

	if (requests.length === 0) {
		return (
			<div className="mt-4 rounded-lg border border-dashed p-12 text-center">
				<h3 className="mb-2 font-semibold">All caught up!</h3>
				<p className="text-sm text-muted-foreground">No approved requests awaiting payment.</p>
			</div>
		)
	}

	const handleMarkPaid = async (request: SRPRequestResponse) => {
		if (!request.paymentToken) {
			toast.error('No payment token on this request')
			return
		}
		setDismissing((prev) => new Set([...prev, request.id]))
		try {
			await markPaid.mutateAsync({ id: request.id, paymentToken: request.paymentToken })
			toast.success(`Marked as paid: ${request.shipTypeName}`)
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
	const copyToClipboard = (text: string, label: string) => {
		void navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`))
	}

	const recipient = request.characterName
	const amount = request.approvedAmount ?? '0'
	const reason = `SRP - KM#${request.killmailId}`

	return (
		<Card className="p-4">
			<div className="space-y-2">
				<CopyRow
					label="Recipient"
					value={recipient}
					onCopy={() => copyToClipboard(recipient, 'Recipient')}
				/>
				<CopyRow
					label="Amount"
					value={amount}
					display={formatISK(amount)}
					onCopy={() => copyToClipboard(amount, 'Amount')}
				/>
				<CopyRow label="Reason" value={reason} onCopy={() => copyToClipboard(reason, 'Reason')} />
			</div>

			<div className="mt-3 flex items-center justify-between border-t border-border/40 pt-3">
				<div className="text-xs text-muted-foreground">
					<span className="font-medium">{request.shipTypeName}</span>
					{request.corporationName && (
						<span className="ml-2 text-muted-foreground">· {request.corporationName}</span>
					)}
					<span className="ml-2">· Lost {formatRelativeTime(request.lossDate)}</span>
					{request.reviewedAt && (
						<span className="ml-2">· Reviewed {formatRelativeTime(request.reviewedAt)}</span>
					)}
				</div>
				<Button size="sm" onClick={() => onMarkPaid(request)} className="gap-1">
					<Check className="h-4 w-4" /> Mark Paid
				</Button>
			</div>
		</Card>
	)
}

function CopyRow({
	label,
	value,
	display,
	onCopy,
}: {
	label: string
	value: string
	display?: string
	onCopy: () => void
}) {
	return (
		<div className="flex items-center gap-2">
			<span className="w-20 text-xs text-muted-foreground">{label}</span>
			<button
				type="button"
				onClick={onCopy}
				className="flex items-center gap-1.5 rounded border border-border/40 bg-muted/20 px-2 py-1 text-xs hover:bg-muted/40 transition-colors"
				title="Click to copy"
			>
				<Copy className="h-3 w-3 text-muted-foreground" />
				<span className="font-mono">{display ?? value}</span>
			</button>
		</div>
	)
}

function PaidList() {
	const { data, isLoading } = useRequestsByStatus('paid', { limit: 50 })

	if (isLoading) {
		return (
			<div className="space-y-2 pt-4">
				{[...Array(3)].map((_, i) => (
					<div key={i} className="h-12 animate-pulse rounded-md bg-muted/30" />
				))}
			</div>
		)
	}

	const requests: SRPRequestResponse[] = data?.requests ?? []

	if (requests.length === 0) {
		return (
			<div className="mt-4 rounded-lg border border-dashed p-8 text-center">
				<p className="text-sm text-muted-foreground">No paid requests yet</p>
			</div>
		)
	}

	return (
		<div className="mt-4 overflow-hidden rounded-lg border border-border/50 bg-card">
			<table className="w-full">
				<thead>
					<tr className="border-b border-border/50 bg-muted/20">
						<th className="p-3 text-left text-xs font-semibold text-muted-foreground">Ship</th>
						<th className="p-3 text-left text-xs font-semibold text-muted-foreground">Pilot</th>
						<th className="p-3 text-right text-xs font-semibold text-muted-foreground">Paid</th>
						<th className="p-3 text-left text-xs font-semibold text-muted-foreground">When</th>
						<th className="p-3 text-left text-xs font-semibold text-muted-foreground">Status</th>
					</tr>
				</thead>
				<tbody>
					{requests.map((req) => (
						<tr key={req.id} className="border-b border-border/30 hover:bg-muted/10">
							<td className="p-3 text-sm font-medium">{req.shipTypeName}</td>
							<td className="p-3 text-sm">{req.characterName}</td>
							<td className="p-3 text-right font-mono text-sm tabular-nums">
								{req.approvedAmount ? formatISK(req.approvedAmount) : '—'}
							</td>
							<td className="p-3 text-sm text-muted-foreground">
								{req.paymentDate ? formatRelativeTime(req.paymentDate) : '—'}
							</td>
							<td className="p-3">
								<RequestStatusBadge status={req.requestStatus as any} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}
