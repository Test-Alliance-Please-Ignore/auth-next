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
import { useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import { SRPFeedback } from '../components/SRPFeedback'
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

import type { AppTranslationKey } from '@/i18n'
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
	const { t } = useAppTranslation()
	usePageTitle(t('srp.payments.pageTitle'))

	const { hasAnyPermission } = useUserPermissions()

	if (!hasAnyPermission('urn:srp:payer', 'urn:srp:manager')) {
		return <Navigate to="/srp" replace />
	}

	return (
		<Container>
			<PageHeader title={t('srp.payments.title')} description={t('srp.payments.description')} />
			<div className="mt-section">
				<PaymentStack />
			</div>
		</Container>
	)
}

function PaymentStack() {
	const { t } = useAppTranslation()
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
					<p className="text-sm text-muted-foreground">{t('srp.payments.slow')}</p>
					<Button variant="secondary" size="sm" className="mt-3" onClick={() => void refetch()}>
						{t('srp.common.retryQueue')}
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
				<p className="text-sm text-red-500">{t('srp.payments.loadFailed')}</p>
			</div>
		)
	}

	const refreshButton = (
		<Button
			variant="secondary"
			size="sm"
			onClick={() => void refetch()}
			loading={isFetching}
			loadingText={t('srp.common.refreshing')}
		>
			{t('srp.payments.refresh')}
		</Button>
	)
	const queueSummaryCard = (
		<Card className="p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="text-sm text-muted-foreground">{t('srp.payments.pendingTotal')}</div>
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
					<h3 className="text-lg font-semibold">{t('srp.payments.caughtUp')}</h3>
					<p className="mt-2 text-sm text-muted-foreground">{t('srp.payments.empty')}</p>
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
			toast.success(
				<SRPFeedback messageKey="srp.payments.pending" values={{ ship: request.shipTypeName }} />
			)
		} catch (e: any) {
			window.clearTimeout(finalizeTimeout)
			setGhosts((prev) => {
				const next = new Map(prev)
				next.delete(request.id)
				return next
			})
			// Keep the request dismissed until the page is refreshed so the operator
			// does not lose their place during manual third-party entry.
			toast.error(<SRPFeedback messageKey="srp.payments.markFailed" />, {
				description: e.message,
			})
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
	const { t } = useAppTranslation()
	const recipient = request.characterName
	const amount = request.approvedAmount ?? '0'
	// The wallet matching service requires this exact payment reference.
	const reason = `SRP - KM#${request.id}`

	return (
		<div
			ref={registerCardRef}
			className={`transition-opacity ${isPendingRemoval ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
		>
			<Card className="p-4">
				<div className="space-y-1.5">
					<CopyRow labelKey="srp.common.recipient" value={recipient} />
					<CopyRow labelKey="srp.common.amount" value={amount} display={formatISK(amount)} />
					<CopyRow labelKey="srp.common.reason" value={reason} />
				</div>

				<div className="mt-3 flex items-center gap-3 border-t border-border/40 pt-3">
					<Button
						type="button"
						size="sm"
						onClick={() => onMarkPaid(request)}
						disabled={Boolean(isPendingRemoval)}
						className="shrink-0 gap-1"
					>
						<Check className="h-4 w-4" /> {t('srp.payments.markPaid')}
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
								<span>{t('srp.payments.lost')} </span>
								<EveTimeDisplay dateStr={request.lossDate} format="compact" className="text-sm" />
							</span>
							{request.reviewedAt && (
								<span>
									{t('srp.payments.reviewed')} {formatRelativeTime(request.reviewedAt)}
								</span>
							)}
						</Link>
					</div>
				</div>
			</Card>
		</div>
	)
}

function GhostPaymentCard({ request, top }: { request: SRPRequestResponse; top: number }) {
	const { t } = useAppTranslation()
	const recipient = request.characterName
	const amount = request.approvedAmount ?? '0'
	// The wallet matching service requires this exact payment reference.
	const reason = `SRP - KM#${request.id}`

	return (
		<div
			className="pointer-events-none absolute left-0 right-0 z-20 animate-[srp-pay-exit_240ms_ease-out_forwards]"
			style={{ top }}
		>
			<Card className="p-4">
				<div className="space-y-1.5">
					<GhostCopyRow label={t('srp.common.recipient')} value={recipient} />
					<GhostCopyRow label={t('srp.common.amount')} value={formatISK(amount)} />
					<GhostCopyRow label={t('srp.common.reason')} value={reason} />
				</div>
				<div className="mt-3 flex items-center gap-3 border-t border-border/40 pt-3 text-sm text-muted-foreground">
					<span className="font-medium">{request.shipTypeName}</span>
					{request.corporationName && <span>· {request.corporationName}</span>}
					<span className="inline-flex items-center gap-1">
						<span>{t('srp.payments.lost')} </span>
						<EveTimeDisplay dateStr={request.lossDate} format="compact" className="text-sm" />
					</span>
					{request.reviewedAt && (
						<span>
							{t('srp.payments.reviewed')} {formatRelativeTime(request.reviewedAt)}
						</span>
					)}
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

function CopyRow({
	labelKey,
	value,
	display,
}: {
	labelKey: AppTranslationKey
	value: string
	display?: string
}) {
	const { t } = useAppTranslation()
	const [copied, setCopied] = useState(false)
	const resetTimerRef = useRef<number | null>(null)

	useEffect(() => {
		return () => {
			if (resetTimerRef.current !== null) {
				window.clearTimeout(resetTimerRef.current)
			}
		}
	}, [])

	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(value)
			toast.success(<SRPFeedback messageKey="srp.common.copied" labelKey={labelKey} />)
			setCopied(true)
			if (resetTimerRef.current !== null) {
				window.clearTimeout(resetTimerRef.current)
			}
			resetTimerRef.current = window.setTimeout(() => {
				setCopied(false)
				resetTimerRef.current = null
			}, 2000)
		} catch {
			toast.error(<SRPFeedback messageKey="srp.common.copyFailed" labelKey={labelKey} />)
		}
	}

	return (
		<div className="flex items-center gap-2">
			<span className="w-20 shrink-0 text-xs text-muted-foreground">{t(labelKey)}</span>
			<div
				role="button"
				aria-label={t('srp.common.copy', { label: t(labelKey) })}
				tabIndex={0}
				onClick={onCopy}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault()
						void onCopy()
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
