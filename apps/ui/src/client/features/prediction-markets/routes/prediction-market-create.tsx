import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useAppTranslation } from '@/i18n'

import { CreateMarketDialog } from '../components/create-market-dialog'

/**
 * Member-facing market creation. Gated on `urn:markets:creator` (managers + site admins also pass);
 * this is cosmetic — the /api/prediction-markets/markets route is the real gate. Created markets are
 * posted to the predictions forum channel where members bet and a resolver settles them.
 */
export default function PredictionMarketCreate() {
	const { t } = useAppTranslation()

	usePageTitle(t('predictionMarkets.predictionMarkets'))
	const [createOpen, setCreateOpen] = useState(false)
	const { hasAnyPermission } = useUserPermissions()
	const canCreate = hasAnyPermission('urn:markets:creator', 'urn:markets:manager')
	// Managers/admins get the full param set; a lower-trust creator sees only question/outcomes/close
	// (economic params default from config server-side).
	const isManager = hasAnyPermission('urn:markets:manager')

	return (
		<Container>
			<PageHeader
				title={t('predictionMarkets.predictionMarkets')}
				description={<>{t('predictionMarkets.createAMarketForTheCommunityItSPostedTo')}</>}
				action={
					canCreate ? (
						<Button variant="primary" onClick={() => setCreateOpen(true)}>
							{t('predictionMarkets.newMarket')}
						</Button>
					) : undefined
				}
			/>

			<Card>
				<CardContent className="py-6 text-sm text-muted-foreground">
					{canCreate
						? t('predictionMarkets.noMarketsHaveBeenCreatedFromThisPageYetUse')
						: t('predictionMarkets.youDonTHavePermissionToCreatePredictionMarketsAsk')}
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
