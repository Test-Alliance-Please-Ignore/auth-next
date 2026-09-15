import { ArrowLeft, Users } from 'lucide-react'
import { Trans } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'

import { BillActionsMenu } from '@/components/bills/bill-actions-menu'
import { BillFeedback } from '@/components/bills/bill-feedback'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
	stickyTableActionCellClassName,
	stickyTableActionHeaderClassName,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useMarkIssuedBillPaid } from '@/features/bills/hooks'
import {
	useCancelGroupBill,
	useDeleteGroupBill,
	useGroupBillAggregate,
	useIssueGroupBill,
	useMarkBillPaid,
	useRevertGroupBillToDraft,
} from '@/hooks/useBills'
import { usePageTitle } from '@/hooks/usePageTitle'
import {
	formatNumber,
	formatDate as localizedDate,
	formatDateTime as localizedDateTime,
	useAppTranslation,
} from '@/i18n'
import { formatBillStatus, formatISK } from '@/lib/bills-utils'
import toast from '@/lib/toast'

import type { GroupBillAccessScope } from '@/lib/bills-api'

function getStatusBadgeClass(status: string) {
	switch (status) {
		case 'draft':
			return 'bg-muted text-muted-foreground'
		case 'issued':
			return 'bg-blue-500/10 text-blue-500'
		case 'paid':
			return 'bg-green-500/10 text-green-500'
		case 'cancelled':
			return 'bg-destructive/10 text-destructive'
		case 'overdue':
			return 'bg-orange-500/10 text-orange-500'
		default:
			return 'bg-muted text-muted-foreground'
	}
}

function formatAmount(amount: string) {
	return formatISK(amount)
}

function formatDate(date: Date) {
	return localizedDate(date, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	})
}

function formatDateTime(date: Date) {
	return localizedDateTime(date, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}

export default function AdminBillsGroupDetailPage({
	scope = 'admin',
}: {
	scope?: GroupBillAccessScope
}) {
	const { t } = useAppTranslation()
	const { groupBillId } = useParams<{ groupBillId: string }>()
	const navigate = useNavigate()
	const { data: groupAggregate, isLoading } = useGroupBillAggregate(groupBillId, scope)
	const issueGroupBill = useIssueGroupBill(scope)
	const cancelGroupBill = useCancelGroupBill(scope)
	const deleteGroupBill = useDeleteGroupBill(scope)
	const revertGroupBill = useRevertGroupBillToDraft(scope)
	const markIssuedBillPaid = useMarkIssuedBillPaid()
	const markAdminBillPaid = useMarkBillPaid()
	const markBillPaid = scope === 'issuer' ? markIssuedBillPaid : markAdminBillPaid
	const basePath = scope === 'issuer' ? '/my-bills' : '/admin/bills'
	const billHref = (billId: string) => `${basePath}/${billId}`
	const groupHref = `${basePath}/group/${groupBillId}`
	const groupEditHref = `${groupHref}/edit`

	usePageTitle(
		groupAggregate
			? t('bills.group.pageTitle', { title: groupAggregate.title })
			: t('bills.group.details')
	)

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
					<div>
						<h1 className="text-3xl font-bold gradient-text">{t('bills.group.loading')}</h1>
					</div>
					<Button variant="ghost" asChild>
						<Link to={basePath}>
							<ArrowLeft className="h-4 w-4" />
							{t('bills.back')}
						</Link>
					</Button>
				</div>
			</div>
		)
	}

	if (!groupBillId || !groupAggregate) {
		return (
			<div className="space-y-6">
				<div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
					<div>
						<h1 className="text-3xl font-bold gradient-text">{t('bills.group.notFound')}</h1>
						<p className="text-muted-foreground mt-2">{t('bills.group.unavailable')}</p>
					</div>
					<Button variant="ghost" asChild>
						<Link to={basePath}>
							<ArrowLeft className="h-4 w-4" />
							{t('bills.back')}
						</Link>
					</Button>
				</div>
			</div>
		)
	}

	const groupProgress =
		groupAggregate.totalBills > 0
			? Math.min(100, Math.floor((groupAggregate.paidBills / groupAggregate.totalBills) * 100))
			: 0
	const hasEditableBills = groupAggregate.bills.some(
		(entry) => entry.status !== 'paid' && !entry.hasPayments
	)
	const draftCount = groupAggregate.bills.filter((entry) => entry.status === 'draft').length
	const cancellableCount = groupAggregate.bills.filter(
		(entry) => entry.status !== 'paid' && entry.status !== 'cancelled'
	).length
	const revertibleCount = groupAggregate.bills.filter(
		(entry) => entry.status !== 'draft' && entry.status !== 'paid' && !entry.hasPayments
	).length
	const runGroupAction = async (operation: () => Promise<unknown>) => {
		try {
			await operation()
		} catch (error) {
			toast.error(
				error instanceof Error ? (
					error.message
				) : (
					<BillFeedback messageKey="bills.group.updateFailed" />
				)
			)
		}
	}
	const groupActions = [
		{
			label: t('bills.actions.edit'),
			intent: 'secondary' as const,
			href: groupEditHref,
			hidden: !hasEditableBills,
		},
		{
			label: t('bills.actions.issue'),
			intent: 'confirm' as const,
			hidden: draftCount === 0,
			loading: issueGroupBill.isPending,
			onClick: () => void runGroupAction(() => issueGroupBill.mutateAsync(groupBillId)),
		},
		{
			label: t('bills.actions.draft'),
			intent: 'secondary' as const,
			hidden: revertibleCount === 0,
			loading: revertGroupBill.isPending,
			onClick: () => void runGroupAction(() => revertGroupBill.mutateAsync(groupBillId)),
		},
		{
			label: t('bills.actions.cancel'),
			intent: 'muted' as const,
			hidden: cancellableCount === 0,
			loading: cancelGroupBill.isPending,
			onClick: () => void runGroupAction(() => cancelGroupBill.mutateAsync(groupBillId)),
		},
		{
			label: t('bills.actions.delete'),
			intent: 'destructive' as const,
			hidden: draftCount === 0,
			loading: deleteGroupBill.isPending,
			onClick: () => void runGroupAction(() => deleteGroupBill.mutateAsync(groupBillId)),
		},
	]

	return (
		<div className="space-y-6">
			<div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
				<div>
					<h1 className="text-3xl font-bold gradient-text">{groupAggregate.title}</h1>
					<p className="text-muted-foreground mt-2">
						{t('bills.group.subtitle', {
							group: groupAggregate.groupName ?? groupAggregate.groupId,
						})}
					</p>
				</div>
				<div className="flex gap-2">
					<Button variant="ghost" asChild>
						<Link to={basePath}>
							<ArrowLeft className="h-4 w-4" />
							{t('bills.back')}
						</Link>
					</Button>
					<BillActionsMenu items={groupActions} />
				</div>
			</div>

			<div className="flex items-center gap-2">
				<span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-sm font-medium text-blue-500">
					<Users className="h-3.5 w-3.5" />
					{t('bills.group.title')}
				</span>
				<span className="text-sm text-muted-foreground">
					{t('bills.group.issuer', {
						issuer: groupAggregate.issuerName ?? groupAggregate.issuerId,
					})}
				</span>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{t('bills.details')}</CardTitle>
					<CardDescription>{t('bills.group.description')}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">
								{t('bills.group.amount')}
							</h3>
							<p className="text-2xl font-bold">{formatAmount(groupAggregate.amount)}</p>
						</div>
						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">
								{t('bills.columns.dueDate')}
							</h3>
							<p className="text-lg">{formatDate(groupAggregate.dueDate)}</p>
						</div>
						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">
								{t('bills.entity.group')}
							</h3>
							<p className="text-lg">{groupAggregate.groupName ?? groupAggregate.groupId}</p>
						</div>
						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">
								{t('bills.columns.created')}
							</h3>
							<p className="text-lg">{formatDate(groupAggregate.createdAt)}</p>
						</div>
						{groupAggregate.description && (
							<div className="md:col-span-2">
								<h3 className="text-sm font-medium text-muted-foreground mb-1">
									{t('bills.columns.description')}
								</h3>
								<p className="text-lg">{groupAggregate.description}</p>
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t('bills.group.progressTitle')}</CardTitle>
					<CardDescription>
						<Trans
							i18nKey="bills.group.paid"
							values={{
								paid: formatNumber(groupAggregate.paidBills),
								total: formatNumber(groupAggregate.totalBills),
							}}
							components={{
								paid: <span className="font-semibold text-foreground" />,
								total: <span className="font-semibold text-foreground" />,
							}}
						/>
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<div className="flex justify-between text-sm">
							<span className="text-muted-foreground">{t('bills.group.progress')}</span>
							<span className="font-medium">
								{formatNumber(groupProgress / 100, { style: 'percent' })}
							</span>
						</div>
						<Progress value={groupProgress} className="h-2 bg-warning/70" />
					</div>

					<Table className="whitespace-nowrap">
						<TableHeader>
							<TableRow>
								<TableHead>{t('bills.group.member')}</TableHead>
								<TableHead>{t('bills.columns.status')}</TableHead>
								<TableHead>{t('bills.group.amountDue')}</TableHead>
								<TableHead>{t('bills.group.amountPaid')}</TableHead>
								<TableHead>{t('bills.columns.paidAt')}</TableHead>
								<TableHead className={`${stickyTableActionHeaderClassName} text-right`}>
									{t('bills.columns.actions')}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{groupAggregate.bills.map((entry) => (
								<TableRow
									key={entry.billId}
									className="cursor-pointer"
									onClick={(event) => {
										const target = event.target as HTMLElement | null
										if (target?.closest('a, button, [role="button"]')) return
										const href = billHref(entry.billId)
										if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
											event.preventDefault()
											window.open(href, '_blank', 'noopener,noreferrer')
											return
										}
										void navigate(href)
									}}
									onAuxClick={(event) => {
										if (event.button !== 1) return
										const target = event.target as HTMLElement | null
										if (target?.closest('a, button, [role="button"]')) return
										event.preventDefault()
										window.open(billHref(entry.billId), '_blank', 'noopener,noreferrer')
									}}
								>
									<TableCell>
										<Link
											to={billHref(entry.billId)}
											className="block no-underline hover:no-underline"
										>
											{entry.payerName ?? entry.payerId}
										</Link>
									</TableCell>
									<TableCell>
										<Link
											to={billHref(entry.billId)}
											className="block no-underline hover:no-underline"
										>
											<span
												className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(entry.status)}`}
											>
												{formatBillStatus(entry.status)}
											</span>
										</Link>
									</TableCell>
									<TableCell>
										<Link
											to={billHref(entry.billId)}
											className="block no-underline hover:no-underline"
										>
											{formatAmount(entry.totalDue)}
										</Link>
									</TableCell>
									<TableCell className="text-green-500">
										<Link
											to={billHref(entry.billId)}
											className="block no-underline hover:no-underline"
										>
											{formatAmount(entry.totalPaid)}
										</Link>
									</TableCell>
									<TableCell>
										<Link
											to={billHref(entry.billId)}
											className="block no-underline hover:no-underline"
										>
											{entry.paidAt ? formatDateTime(entry.paidAt) : '—'}
										</Link>
									</TableCell>
									<TableCell className={`${stickyTableActionCellClassName} text-right`}>
										<BillActionsMenu
											items={[
												{
													label: t('bills.actions.view'),
													intent: 'primary',
													href: billHref(entry.billId),
												},
												{
													label: t('bills.actions.markPaid'),
													intent: 'confirm',
													hidden: entry.status !== 'issued' && entry.status !== 'overdue',
													loading: markBillPaid.isPending,
													onClick: () =>
														void runGroupAction(() => markBillPaid.mutateAsync(entry.billId)),
												},
											]}
										/>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	)
}
