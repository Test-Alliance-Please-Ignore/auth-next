import { Link, Navigate, useSearchParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'

import { CreateRequestForm } from '../components/CreateRequestForm'
import { useKillmailPreview, useRecentLosses } from '../hooks'

export default function CreateRequest() {
	const { t } = useAppTranslation()
	usePageTitle(t('srp.create.pageTitle'))

	const [searchParams] = useSearchParams()

	const killmailId = searchParams.get('killmailId')
	const killmailHash = searchParams.get('killmailHash')

	const { data: losses, isLoading: lossesLoading } = useRecentLosses()
	const loss = losses?.losses?.find((l) => l.killmailId === killmailId)

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
						<p className="text-sm text-muted-foreground">{t('srp.create.loading')}</p>
					</div>
				</div>
			</Container>
		)
	}

	if (!loss) {
		return (
			<Container>
				<PageHeader title={t('srp.create.title')} description={t('srp.create.description')} />
				<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
					<p className="text-sm text-red-500">{t('srp.create.notFound')}</p>
					<p className="text-xs text-muted-foreground">{t('srp.create.notFoundDescription')}</p>
					<Button variant="ghost" className="mt-4" asChild>
						<Link to="/srp">{t('srp.common.backDashboard')}</Link>
					</Button>
				</div>
			</Container>
		)
	}

	if (loss.hasSRPRequest) {
		if (loss.srpRequestId) {
			return <Navigate to={`/srp/request/${loss.srpRequestId}`} replace />
		}

		return (
			<Container>
				<PageHeader title={t('srp.create.title')} description={t('srp.create.description')} />
				<div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-6 text-center">
					<p className="text-sm text-amber-500">{t('srp.create.exists')}</p>
					<p className="text-xs text-muted-foreground">{t('srp.create.existsDescription')}</p>
					<Button variant="ghost" className="mt-4" asChild>
						<Link to={`/srp/request/${loss.srpRequestId}`}>{t('srp.common.viewRequest')}</Link>
					</Button>
				</div>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader title={t('srp.create.title')} description={t('srp.create.lossDescription')} />
			<CreateRequestForm
				killmailId={killmailId}
				killmailHash={killmailHash}
				characterId={loss.victimCharacterId}
				shipTypeId={loss.shipTypeId}
				shipTypeName={loss.shipTypeName || t('srp.common.shipId', { id: loss.shipTypeId })}
				lossDate={loss.killmailTime}
				lossVictimItems={loss.victimItems}
				preview={preview ?? null}
				previewLoading={previewLoading}
			/>
		</Container>
	)
}
