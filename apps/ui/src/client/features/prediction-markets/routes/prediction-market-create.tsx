import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { CreateMarketDialog } from '../components/create-market-dialog'

/**
 * Member-facing market creation. Gated on `urn:markets:creator` (managers + site admins also pass);
 * this is cosmetic — the /api/prediction-markets/markets route is the real gate. Created markets are
 * posted to the predictions forum channel where members bet and a resolver settles them.
 */
export default function PredictionMarketCreate() {
	usePageTitle('Prediction Markets')
	const [createOpen, setCreateOpen] = useState(false)
	const { hasAnyPermission } = useUserPermissions()
	const canCreate = hasAnyPermission('urn:markets:creator', 'urn:markets:manager')
	// Managers/admins get the full param set; a lower-trust creator sees only question/outcomes/close
	// (economic params default from config server-side).
	const isManager = hasAnyPermission('urn:markets:manager')

	return (
		<Container>
			<PageHeader
				title="Prediction Markets"
				description={
					<>
						Create a market for the community. It’s posted to the predictions forum channel, where
						members place bets and a resolver settles it. You can bet on your own market, but you
						can’t resolve it.
					</>
				}
				action={
					canCreate ? (
						<Button variant="primary" onClick={() => setCreateOpen(true)}>
							New market
						</Button>
					) : undefined
				}
			/>

			<Card>
				<CardContent className="py-6 text-sm text-muted-foreground">
					{canCreate
						? 'No markets have been created from this page yet. Use New market to create one.'
						: 'You don’t have permission to create prediction markets. Ask an admin for the “markets creator” role.'}
				</CardContent>
			</Card>

			<CreateMarketDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				scope="member"
				showAdvanced={isManager}
			/>
		</Container>
	)
}
