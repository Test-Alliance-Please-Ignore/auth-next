import { useState } from 'react'

import { Button } from '@/components/ui/button'
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

	return (
		<div className="space-y-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Prediction Markets</h1>
					<p className="mt-1 max-w-2xl text-muted-foreground">
						Create a market for the community. It’s posted to the predictions forum channel, where
						members place bets and a resolver settles it. You can’t bet on or resolve a market you
						create.
					</p>
				</div>
				{canCreate ? (
					<Button variant="primary" onClick={() => setCreateOpen(true)}>
						New market
					</Button>
				) : null}
			</div>

			{!canCreate ? (
				<p className="text-sm text-muted-foreground">
					You don’t have permission to create prediction markets. Ask an admin for the “markets
					creator” role.
				</p>
			) : null}

			<CreateMarketDialog open={createOpen} onOpenChange={setCreateOpen} scope="member" />
		</div>
	)
}
