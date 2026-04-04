import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/hooks/useAuth'

import { PaymentForm } from '../components/PaymentForm'
import { RequestTable } from '../components/RequestTable'
import { usePendingPayments } from '../hooks'
import { isSRPPayer } from '../utils'

import type { SRPRequestResponse } from '../types'

export default function PaymentsQueue() {
	const { user } = useAuth()
	const [selectedRequest, setSelectedRequest] = useState<SRPRequestResponse | null>(null)
	const { data, isLoading, error, refetch } = usePendingPayments({ limit: 50 })

	// Check permissions
	if (!isSRPPayer(user)) {
		return <Navigate to="/srp" replace />
	}

	const handleSuccess = () => {
		setSelectedRequest(null)
		refetch()
	}

	return (
		<Container>
			<PageHeader
				title="Pending Payments"
				description="Process approved ship replacement payments"
				action={
					<Button variant="ghost" onClick={() => refetch()}>
						Refresh
					</Button>
				}
			/>

			{error ? (
				<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
					<p className="text-sm text-red-500">Failed to load pending payments</p>
					<p className="text-xs text-muted-foreground">
						{error instanceof Error ? error.message : 'Unknown error'}
					</p>
					<Button variant="ghost" className="mt-4" onClick={() => refetch()}>
						Retry
					</Button>
				</div>
			) : data && data.requests.length === 0 ? (
				<div className="rounded-lg border border-dashed p-12 text-center">
					<h3 className="mb-2 font-semibold">All caught up!</h3>
					<p className="text-sm text-muted-foreground">
						No payments pending. All requests have been processed.
					</p>
					<Button variant="ghost" className="mt-4" asChild>
						<Link to="/srp">Back to Dashboard</Link>
					</Button>
				</div>
			) : (
				<>
					<RequestTable requests={data?.requests || []} isLoading={isLoading} />
					{data && data.total > 0 && (
						<div className="mt-4 text-sm text-muted-foreground">
							Showing {data.requests.length} of {data.total} pending payments
						</div>
					)}
				</>
			)}

			{/* Payment Dialog */}
			<Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Process Payment</DialogTitle>
					</DialogHeader>
					{selectedRequest && (
						<PaymentForm
							request={selectedRequest}
							onSuccess={handleSuccess}
							onCancel={() => setSelectedRequest(null)}
						/>
					)}
				</DialogContent>
			</Dialog>
		</Container>
	)
}
