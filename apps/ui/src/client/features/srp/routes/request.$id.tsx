import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/useAuth'
import { Copy } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CommentForm } from '../components/CommentForm'
import { CommentsList } from '../components/CommentsList'
import { PaymentStatusBadge } from '../components/PaymentStatusBadge'
import { RequestHistory } from '../components/RequestHistory'
import { RequestStatusBadge } from '../components/RequestStatusBadge'
import { useRequest, useRequestComments } from '../hooks'
import { canSeeInternalComments, formatFullDate, formatISK, getKillmailUrl } from '../utils'

export default function RequestDetails() {
	const { id } = useParams<{ id: string }>()
	const { user } = useAuth()

	const { data: request, isLoading, error } = useRequest(id)

	const canSeeInternal = canSeeInternalComments(user)
	const {
		data: comments = [],
		refetch: refetchComments,
		isLoading: commentsLoading,
	} = useRequestComments(id, canSeeInternal)

	if (!id) {
		return <Navigate to="/srp" replace />
	}

	if (isLoading) {
		return (
			<Container>
				<div className="flex min-h-[400px] items-center justify-center">
					<div className="text-center">
						<div className="mb-2 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
						<p className="text-sm text-muted-foreground">Loading request...</p>
					</div>
				</div>
			</Container>
		)
	}

	if (error || !request) {
		return (
			<Container>
				<PageHeader title="Request Not Found" />
				<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
					<p className="text-sm text-red-500">Failed to load request</p>
					<p className="text-xs text-muted-foreground">
						{error instanceof Error ? error.message : 'Request not found'}
					</p>
					<Button variant="outline" className="mt-4" asChild>
						<Link to="/srp">Back to Dashboard</Link>
					</Button>
				</div>
			</Container>
		)
	}

	const copyToken = () => {
		if (request.paymentToken) {
			navigator.clipboard.writeText(request.paymentToken)
			toast.success('Payment token copied to clipboard')
		}
	}

	return (
		<Container>
			<PageHeader
				title={`SRP Request #${request.id.slice(0, 8)}`}
				description={request.shipTypeName}
			/>

			<div className="grid gap-6 lg:grid-cols-3">
				{/* Main Content - 2/3 width */}
				<div className="space-y-6 lg:col-span-2">
					{/* Killmail Details */}
					<Card className="p-6">
						<h3 className="mb-4 font-semibold">Loss Details</h3>
						<div className="grid gap-4 sm:grid-cols-2">
							<div>
								<div className="text-sm text-muted-foreground">Ship</div>
								<div className="font-medium">{request.shipTypeName}</div>
							</div>
							<div>
								<div className="text-sm text-muted-foreground">Ship Value</div>
								<div className="font-medium tabular-nums">{formatISK(request.shipValue)} ISK</div>
							</div>
							<div>
								<div className="text-sm text-muted-foreground">Character</div>
								<div className="font-medium">{request.characterName}</div>
							</div>
							<div>
								<div className="text-sm text-muted-foreground">Corporation</div>
								<div className="font-medium">{request.corporationName}</div>
							</div>
							<div>
								<div className="text-sm text-muted-foreground">Loss Date</div>
								<div className="font-medium">{formatFullDate(request.lossDate)}</div>
							</div>
							<div>
								<Button variant="outline" size="sm" asChild>
									<a
										href={getKillmailUrl(request.killmailId)}
										target="_blank"
										rel="noopener noreferrer"
									>
										View on zKillboard →
									</a>
								</Button>
							</div>
						</div>
					</Card>

					{/* Timeline */}
					{request.history && request.history.length > 0 && (
						<RequestHistory history={request.history} />
					)}

					{/* Comments */}
					<Card className="p-6">
						<h3 className="mb-4 font-semibold">Comments</h3>
						<Tabs defaultValue="public">
							<TabsList>
								<TabsTrigger value="public">Public</TabsTrigger>
								{canSeeInternal && <TabsTrigger value="internal">Internal</TabsTrigger>}
							</TabsList>

							<TabsContent value="public" className="space-y-4">
								<CommentsList
									comments={comments.filter((c: any) => c.visibility === 'public')}
									requestId={id}
									canAddInternal={canSeeInternal}
									onCommentAdded={() => refetchComments()}
								/>
								<Separator />
								<CommentForm
									requestId={id}
									canAddInternal={canSeeInternal}
									onSuccess={() => refetchComments()}
								/>
							</TabsContent>

							{canSeeInternal && (
								<TabsContent value="internal" className="space-y-4">
									<CommentsList
										comments={comments.filter((c: any) => c.visibility === 'internal')}
										requestId={id}
										canAddInternal={canSeeInternal}
										onCommentAdded={() => refetchComments()}
									/>
									<Separator />
									<CommentForm
										requestId={id}
										canAddInternal={canSeeInternal}
										onSuccess={() => refetchComments()}
									/>
								</TabsContent>
							)}
						</Tabs>
					</Card>
				</div>

				{/* Sidebar - 1/3 width */}
				<div className="space-y-6">
					{/* Quick Info */}
					<Card className="p-6">
						<h3 className="mb-4 font-semibold">Status</h3>
						<div className="space-y-3">
							<div>
								<div className="text-sm text-muted-foreground">Request Status</div>
								<RequestStatusBadge status={request.requestStatus} />
							</div>
							<div>
								<div className="text-sm text-muted-foreground">Payment Status</div>
								<PaymentStatusBadge status={request.paymentStatus} />
							</div>
						</div>
					</Card>

					{/* Amounts */}
					<Card className="p-6">
						<h3 className="mb-4 font-semibold">Amounts</h3>
						<div className="space-y-3">
							{request.requestedAmount && (
								<div>
									<div className="text-sm text-muted-foreground">Requested</div>
									<div className="font-medium tabular-nums">
										{formatISK(request.requestedAmount)} ISK
									</div>
								</div>
							)}
							{request.approvedAmount && (
								<div>
									<div className="text-sm text-muted-foreground">Approved</div>
									<div className="font-medium tabular-nums">
										{formatISK(request.approvedAmount)} ISK
									</div>
								</div>
							)}
						</div>
					</Card>

					{/* Payment Token */}
					{request.paymentToken && (
						<Card className="p-6">
							<h3 className="mb-4 font-semibold">Payment Token</h3>
							<div className="space-y-2">
								<div className="rounded-md border bg-muted/50 p-3 font-mono text-sm">
									{request.paymentToken}
								</div>
								<Button variant="outline" size="sm" className="w-full" onClick={copyToken}>
									<Copy className="mr-2 h-4 w-4" />
									Copy Token
								</Button>
								<p className="text-xs text-muted-foreground">
									Provide this token to the payer to confirm payment receipt.
								</p>
							</div>
						</Card>
					)}

					{/* Timestamps */}
					<Card className="p-6">
						<h3 className="mb-4 font-semibold">Timeline</h3>
						<div className="space-y-2 text-sm">
							<div>
								<div className="text-muted-foreground">Submitted</div>
								<div>{formatFullDate(request.createdAt)}</div>
							</div>
							{request.reviewedAt && (
								<div>
									<div className="text-muted-foreground">Reviewed</div>
									<div>{formatFullDate(request.reviewedAt)}</div>
								</div>
							)}
							{request.paymentDate && (
								<div>
									<div className="text-muted-foreground">Paid</div>
									<div>{formatFullDate(request.paymentDate)}</div>
								</div>
							)}
						</div>
					</Card>
				</div>
			</div>
		</Container>
	)
}
