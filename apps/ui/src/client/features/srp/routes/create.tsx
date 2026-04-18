import { Link, Navigate, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'

import { CreateRequestForm } from '../components/CreateRequestForm'
import { useRecentLosses } from '../hooks'

export default function CreateRequest() {
	const [searchParams] = useSearchParams()

	const killmailId = searchParams.get('killmailId')
	const killmailHash = searchParams.get('killmailHash')

	// Fetch recent losses to find the killmail details
	const { data: losses, isLoading } = useRecentLosses(30)

	// If missing required params, redirect to dashboard
	if (!killmailId || !killmailHash) {
		return <Navigate to="/srp" replace />
	}

	// Find the specific loss
	const loss = losses?.find((l: any) => l.killmailId === killmailId)

	if (isLoading) {
		return (
			<Container>
				<div className="flex min-h-[400px] items-center justify-center">
					<div className="text-center">
						<div className="mb-2 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
						<p className="text-sm text-muted-foreground">Loading killmail details...</p>
					</div>
				</div>
			</Container>
		)
	}

	if (!loss) {
		return (
			<Container>
				<PageHeader title="Submit SRP Request" description="Request ship replacement" />
				<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
					<p className="text-sm text-red-500">Killmail not found</p>
					<p className="text-xs text-muted-foreground">
						This killmail was not found in your recent losses. It may be too old or not belong to
						your character.
					</p>
					<Button variant="ghost" className="mt-4" asChild>
						<Link to="/srp">Back to Dashboard</Link>
					</Button>
				</div>
			</Container>
		)
	}

	// Check if already has a request
	if (loss.hasSRPRequest) {
		return (
			<Container>
				<PageHeader title="Submit SRP Request" description="Request ship replacement" />
				<div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-6 text-center">
					<p className="text-sm text-amber-500">Request already exists</p>
					<p className="text-xs text-muted-foreground">
						You've already submitted an SRP request for this loss.
					</p>
					<Button variant="ghost" className="mt-4" asChild>
						<Link to={`/srp/request/${loss.srpRequestId}`}>View Request</Link>
					</Button>
				</div>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader title="Submit SRP Request" description="Request ship replacement for your loss" />
			<CreateRequestForm
				killmailId={killmailId}
				killmailHash={killmailHash}
				characterId={loss.victimCharacterId}
				shipValue={loss.totalValue}
				shipTypeName={loss.shipTypeName || `Ship ${loss.shipTypeId}`}
				lossDate={loss.killmailTime}
			/>
		</Container>
	)
}
