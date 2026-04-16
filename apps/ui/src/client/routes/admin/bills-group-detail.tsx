import { ArrowLeft, Edit, Users } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useGroupBillAggregate } from '@/hooks/useBills'
import { usePageTitle } from '@/hooks/usePageTitle'

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
	return new Intl.NumberFormat('en-US').format(Number(amount))
}

function formatDate(date: Date) {
	return new Date(date).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	})
}

function formatDateTime(date: Date) {
	return new Date(date).toLocaleString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}

export default function AdminBillsGroupDetailPage() {
	const { groupBillId } = useParams<{ groupBillId: string }>()
	const { data: groupAggregate, isLoading } = useGroupBillAggregate(groupBillId)

	usePageTitle(groupAggregate ? `Bill Group - ${groupAggregate.title}` : 'Bill Group Details')

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-3xl font-bold gradient-text">Loading Group Bill...</h1>
					</div>
					<Button variant="ghost" asChild>
						<Link to="/admin/bills">
							<ArrowLeft className="h-4 w-4" />
							Back to Bills
						</Link>
					</Button>
				</div>
			</div>
		)
	}

	if (!groupBillId || !groupAggregate) {
		return (
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-3xl font-bold gradient-text">Group Bill Not Found</h1>
						<p className="text-muted-foreground mt-2">
							The group bill you're looking for doesn't exist or you don't have permission to view
							it.
						</p>
					</div>
					<Button variant="ghost" asChild>
						<Link to="/admin/bills">
							<ArrowLeft className="h-4 w-4" />
							Back to Bills
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

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">{groupAggregate.title}</h1>
					<p className="text-muted-foreground mt-2">
						Group Bill · {groupAggregate.groupName ?? groupAggregate.groupId}
					</p>
				</div>
				<div className="flex gap-2">
					<Button variant="ghost" asChild>
						<Link to="/admin/bills">
							<ArrowLeft className="h-4 w-4" />
							Back to Bills
						</Link>
					</Button>
					<Button variant="ghost" asChild>
						<Link to={`/admin/bills/group/${groupBillId}/edit`}>
							<Edit className="h-4 w-4" />
							Edit Group
						</Link>
					</Button>
				</div>
			</div>

			<div className="flex items-center gap-2">
				<span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-sm font-medium text-blue-500">
					<Users className="h-3.5 w-3.5" />
					Group Bill
				</span>
				<span className="text-sm text-muted-foreground">
					Issued by {groupAggregate.issuerName ?? groupAggregate.issuerId}
				</span>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Bill Details</CardTitle>
					<CardDescription>Shared details for all members of this group bill</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Amount (per member)</h3>
							<p className="text-2xl font-bold">{formatAmount(groupAggregate.amount)} ISK</p>
						</div>
						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Due Date</h3>
							<p className="text-lg">{formatDate(groupAggregate.dueDate)}</p>
						</div>
						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Group</h3>
							<p className="text-lg">{groupAggregate.groupName ?? groupAggregate.groupId}</p>
						</div>
						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Created</h3>
							<p className="text-lg">{formatDate(groupAggregate.createdAt)}</p>
						</div>
						{groupAggregate.description && (
							<div className="md:col-span-2">
								<h3 className="text-sm font-medium text-muted-foreground mb-1">Description</h3>
								<p className="text-lg">{groupAggregate.description}</p>
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Group Payment Progress</CardTitle>
					<CardDescription>
						<span className="font-semibold text-foreground">{groupAggregate.paidBills}</span> of{' '}
						<span className="font-semibold text-foreground">{groupAggregate.totalBills}</span> members
						paid
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<div className="flex justify-between text-sm">
							<span className="text-muted-foreground">Overall Progress</span>
							<span className="font-medium">{groupProgress}%</span>
						</div>
						<Progress value={groupProgress} className="h-2 bg-warning/70" />
					</div>

					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Member</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Amount Due</TableHead>
								<TableHead>Amount Paid</TableHead>
								<TableHead>Paid At</TableHead>
								<TableHead>Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{groupAggregate.bills.map((entry) => (
								<TableRow key={entry.billId}>
									<TableCell>{entry.payerName ?? entry.payerId}</TableCell>
									<TableCell>
										<span
											className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(entry.status)}`}
										>
											{entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
										</span>
									</TableCell>
									<TableCell>{formatAmount(entry.totalDue)} ISK</TableCell>
									<TableCell className="text-green-500">
										{formatAmount(entry.totalPaid)} ISK
									</TableCell>
									<TableCell>{entry.paidAt ? formatDateTime(entry.paidAt) : '—'}</TableCell>
									<TableCell>
										<Button variant="ghost" asChild>
											<Link to={`/admin/bills/${entry.billId}`}>View Bill</Link>
										</Button>
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
