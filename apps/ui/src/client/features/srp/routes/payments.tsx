import { Check, Copy } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { PageHeader } from '@/components/ui/page-header'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import toast from '@/lib/toast'

import { useMarkPaid, usePendingPayments, usePendingPayoutTotal } from '../hooks'
import {
	dismissPaymentQueueRequest,
	prunePaymentQueueDismissals,
	usePaymentQueueState,
} from '../state/payment-queue-store'
import {
	setReviewQueueSnapshot,
	useReviewQueueEntityMap,
} from '../state/review-queue-snapshot-store'
import { formatISK, formatISKShort, formatRelativeTime } from '../utils'

import type { SRPRequestResponse } from '../types'

const EXIT_DURATION_MS = 240
type GhostExitCard = {
	request: SRPRequestResponse
	top: number
}

function toTimestamp(value: string | null | undefined): number {
	if (!value) return 0
	const parsed = Date.parse(value)
	return Number.isNaN(parsed) ? 0 : parsed
}

export default function PaymentsQueue() {
	usePageTitle('SRP - Payment Queue')

	const { hasAnyPermission } = useUserPermissions()

	if (!hasAnyPermission('urn:srp:payer', 'urn:srp:manager')) {
		return <Navigate to="/srp" replace />
	}

	return (
		<Container>
			<PageHeader
				title="Payment Queue"
				description="Submit approved SRP payouts for payment validation"
			/>
			<div className="mt-section">
				<PaymentStack />
			</div>
		</Container>
	)
}

function PaymentStack() {
	const { data, isLoading, isFetching, error, refetch } = usePendingPayments(
		{ limit: 100 },
		{ refetchOnWindowFocus: false, refetchOnReconnect: false }
	)
	const { data: payoutTotalData } = usePendingPayoutTotal()
	const [ghosts, setGhosts] = useState<Map<string, GhostExitCard>>(new Map())
	const [showLoadWarning, setShowLoadWarning] = useState(false)
	const markPaid = useMarkPaid()
	const containerRef = useRef<HTMLDivElement>(null)
	const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
	const previousCardTopsRef = useRef<Map<string, number>>(new Map())
	const hasMountedRef = useRef(false)
	const rawRequests: SRPRequestResponse[] = (data?.requests ?? []) as SRPRequestResponse[]
	const entities = useReviewQueueEntityMap()
	const dismissedRequestIds = usePaymentQueueState((state) => state.dismissedRequestIds)
	const dismissed = useMemo(() => new Set(dismissedRequestIds), [dismissedRequestIds])

	useEffect(() => {
		if (!hasMountedRef.current) {
			hasMountedRef.current = true
			void refetch()
		}
	}, [refetch])

	useEffect(() => {
		if (!isLoading && !isFetching) {
			setShowLoadWarning(false)
			return
		}
		const timeout = window.setTimeout(() => {
			setShowLoadWarning(true)
		}, 8000)
		return () => window.clearTimeout(timeout)
	}, [isFetching, isLoading])

	useEffect(() => {
		if (!data?.requests) return
		prunePaymentQueueDismissals(data.requests.map((request) => request.id))
	}, [data?.requests])

	useEffect(() => {
		if (!data) return
		setReviewQueueSnapshot('approved', { limit: data.limit, offset: data.offset }, data)
	}, [data])

	const requests = useMemo(
		() =>
			rawRequests
				.map((request) => entities[request.id] ?? request)
				.filter((request: SRPRequestResponse) => !dismissed.has(request.id)),
		[rawRequests, entities, dismissed]
	)
	const sortedRequests = [...requests].sort((a, b) => {
		const aTime = toTimestamp(a.createdAt)
		const bTime = toTimestamp(b.createdAt)
		return aTime - bTime
	})
	const visibleRequestIds = sortedRequests.map((request) => request.id).join('|')
	const pendingPayoutTotal = payoutTotalData?.pendingPayoutTotal ?? '0'

	useLayoutEffect(() => {
		const nextCardTops = new Map<string, number>()

		for (const request of sortedRequests) {
			const element = cardRefs.current.get(request.id)
			if (!element) continue

			const nextTop = element.getBoundingClientRect().top
			nextCardTops.set(request.id, nextTop)

			const previousTop = previousCardTopsRef.current.get(request.id)
			if (previousTop == null) continue

			const delta = previousTop - nextTop
			if (Math.abs(delta) < 1) continue

			element.style.transition = 'none'
			element.style.transform = `translateY(${delta}px)`
			void element.getBoundingClientRect()
			element.style.transition = 'transform 220ms ease-out'
			element.style.transform = 'translateY(0)'

			const handleTransitionEnd = () => {
				element.style.transition = ''
				element.removeEventListener('transitionend', handleTransitionEnd)
			}
			element.addEventListener('transitionend', handleTransitionEnd)
		}

		previousCardTopsRef.current = nextCardTops
	}, [visibleRequestIds])

	if (!data && (isLoading || isFetching)) {
		if (showLoadWarning) {
			return (
				<div className="rounded-lg border border-muted p-6 text-center">
					<p className="text-sm text-muted-foreground">
						Payment queue is taking longer than expected.
					</p>
					<Button variant="secondary" size="sm" className="mt-3" onClick={() => void refetch()}>
						Retry loading queue
					</Button>
				</div>
			)
		}
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

	const refreshButton = (
		<Button
			variant="secondary"
			size="sm"
			onClick={() => void refetch()}
			loading={isFetching}
			loadingText="Refreshing..."
		>
			Refresh Queue
		</Button>
	)
	const queueSummaryCard = (
		<Card className="p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="text-sm text-muted-foreground">Pending Payout Total</div>
					<div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-success">
						{formatISKShort(pendingPayoutTotal)}
					</div>
				</div>
				{refreshButton}
			</div>
		</Card>
	)

	if (sortedRequests.length === 0) {
		return (
			<div className="relative mt-4 space-y-3">
				{queueSummaryCard}
				<Card className="border-dashed p-10 text-center">
					<h3 className="text-lg font-semibold">All caught up!</h3>
					<p className="mt-2 text-sm text-muted-foreground">
						No approved requests awaiting payment submission.
					</p>
				</Card>
			</div>
		)
	}

	const handleMarkPaid = async (request: SRPRequestResponse) => {
		const cardElement = cardRefs.current.get(request.id)
		const containerElement = containerRef.current
		if (cardElement && containerElement) {
			const cardRect = cardElement.getBoundingClientRect()
			const containerRect = containerElement.getBoundingClientRect()
			const top = cardRect.top - containerRect.top + containerElement.scrollTop
			setGhosts((prev) => {
				const next = new Map(prev)
				next.set(request.id, { request, top })
				return next
			})
		}
		const finalizeTimeout = window.setTimeout(() => {
			setGhosts((prev) => {
				const next = new Map(prev)
				next.delete(request.id)
				return next
			})
		}, EXIT_DURATION_MS)
		dismissPaymentQueueRequest(request.id)

		try {
			await markPaid.mutateAsync(request.id)
			toast.success(`Marked as payment pending: ${request.shipTypeName}`)
		} catch (e: any) {
			window.clearTimeout(finalizeTimeout)
			setGhosts((prev) => {
				const next = new Map(prev)
				next.delete(request.id)
				return next
			})
			// Keep the request dismissed until the page is refreshed so the operator
			// does not lose their place during manual third-party entry.
			toast.error('Failed to mark as paid', { description: e.message })
		}
	}

	return (
		<div ref={containerRef} className="relative mt-4 space-y-3">
			{queueSummaryCard}
			{[...ghosts.values()].map((ghost) => (
				<GhostPaymentCard key={ghost.request.id} request={ghost.request} top={ghost.top} />
			))}
			{sortedRequests.map((req: SRPRequestResponse) => (
				<PaymentCard
					key={req.id}
					request={req}
					onMarkPaid={handleMarkPaid}
					isPendingRemoval={dismissed.has(req.id)}
					registerCardRef={(el) => {
						if (!el) {
							cardRefs.current.delete(req.id)
							return
						}
						cardRefs.current.set(req.id, el)
					}}
				/>
			))}
		</div>
	)
}

function PaymentCard({
	request,
	onMarkPaid,
	isPendingRemoval,
	registerCardRef,
}: {
	request: SRPRequestResponse
	onMarkPaid: (r: SRPRequestResponse) => void
	isPendingRemoval?: boolean
	registerCardRef: (el: HTMLDivElement | null) => void
}) {
	const recipient = request.characterName
	const amount = request.approvedAmount ?? '0'
	const reason = `SRP - KM#${request.id}`

	return (
		<div
			ref={registerCardRef}
			className={`transition-opacity ${isPendingRemoval ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
		>
			<Card className="p-4">
				<div className="space-y-1.5">
					<CopyRow label="Recipient" value={recipient} />
					<CopyRow label="Amount" value={amount} display={formatISK(amount)} />
					<CopyRow label="Reason" value={reason} />
				</div>

				<div className="mt-3 flex items-center gap-3 border-t border-border/40 pt-3">
					<Button
						type="button"
						size="sm"
						onClick={() => onMarkPaid(request)}
						disabled={Boolean(isPendingRemoval)}
						className="shrink-0 gap-1"
					>
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
		</div>
	)
}

function GhostPaymentCard({ request, top }: { request: SRPRequestResponse; top: number }) {
	const recipient = request.characterName
	const amount = request.approvedAmount ?? '0'
	const reason = `SRP - KM#${request.id}`

	return (
		<div
			className="pointer-events-none absolute left-0 right-0 z-20 animate-[srp-pay-exit_240ms_ease-out_forwards]"
			style={{ top }}
		>
			<Card className="p-4">
				<div className="space-y-1.5">
					<GhostCopyRow label="Recipient" value={recipient} />
					<GhostCopyRow label="Amount" value={formatISK(amount)} />
					<GhostCopyRow label="Reason" value={reason} />
				</div>
				<div className="mt-3 flex items-center gap-3 border-t border-border/40 pt-3 text-sm text-muted-foreground">
					<span className="font-medium">{request.shipTypeName}</span>
					{request.corporationName && <span>· {request.corporationName}</span>}
					<span className="inline-flex items-center gap-1">
						<span>· Lost</span>
						<EveTimeDisplay dateStr={request.lossDate} format="compact" className="text-sm" />
					</span>
					{request.reviewedAt && <span>· Reviewed {formatRelativeTime(request.reviewedAt)}</span>}
				</div>
			</Card>
			<style>{`@keyframes srp-pay-exit { from { transform: translateX(0); opacity: 1; } to { transform: translateX(85%); opacity: 0; } }`}</style>
		</div>
	)
}

function GhostCopyRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center gap-2">
			<span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
			<div className="flex items-center gap-2.5 rounded-md border-2 border-zinc-500/50 bg-zinc-500/20 px-3 py-2 shadow-sm">
				<Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
				<span className="font-mono text-base">{value}</span>
			</div>
		</div>
	)
}

function CopyRow({ label, value, display }: { label: string; value: string; display?: string }) {
	const [copied, setCopied] = useState(false)
	const resetTimerRef = useRef<number | null>(null)

	useEffect(() => {
		return () => {
			if (resetTimerRef.current !== null) {
				window.clearTimeout(resetTimerRef.current)
			}
		}
	}, [])

	const onCopy = () => {
		void navigator.clipboard.writeText(value).then(() => {
			toast.success(`${label} copied`)
			setCopied(true)
			if (resetTimerRef.current !== null) {
				window.clearTimeout(resetTimerRef.current)
			}
			resetTimerRef.current = window.setTimeout(() => {
				setCopied(false)
				resetTimerRef.current = null
			}, 2000)
		})
	}

	return (
		<div className="flex items-center gap-2">
			<span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
			<div
				role="button"
				tabIndex={0}
				onClick={onCopy}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault()
						onCopy()
					}
				}}
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
