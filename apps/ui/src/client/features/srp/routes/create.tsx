import { Link, Navigate, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'

import { CreateRequestForm } from '../components/CreateRequestForm'
import { useKillmailPreview, useRecentLosses } from '../hooks'

export default function CreateRequest() {
	const [searchParams] = useSearchParams()

	const killmailId = searchParams.get('killmailId')
	const killmailHash = searchParams.get('killmailHash')

	const { data: losses, isLoading: lossesLoading } = useRecentLosses(60)
	const loss = losses?.find((l: any) => l.killmailId === killmailId)

	const { data: preview, isLoading: previewLoading } = useKillmailPreview(
		killmailId,
		killmailHash,
		loss?.victimCharacterId ?? null
	)

	if (!killmailId || !killmailHash) {
		return <Navigate to="/srp" replace />
	}

	if (lossesLoading) {
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
				shipTypeId={loss.shipTypeId}
				shipTypeName={loss.shipTypeName || `Ship ${loss.shipTypeId}`}
				lossDate={loss.killmailTime}
				preview={preview ?? null}
				previewLoading={previewLoading}
			/>
		</Container>
	)
}
