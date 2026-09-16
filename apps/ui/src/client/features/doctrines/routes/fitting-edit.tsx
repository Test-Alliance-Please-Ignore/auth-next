/**
 * Edit Fitting Page
 *
 * Form to edit an existing fitting
 */

import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import { FittingForm } from '../components/FittingForm'
import { FittingPanel } from '../components/FittingPanel'
import { FittingSlotList } from '../components/FittingSlotList'
import { useFitting, useUpdateFitting } from '../hooks'

import type { UpdateFittingRequest } from '../types'

export default function FittingEditPage() {
	const { t } = useAppTranslation()

	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const { hasPermission, isAdmin } = useUserPermissions()
	const [searchParams] = useSearchParams()
	const doctrineId = searchParams.get('doctrineId')
	const { data: fitting, isLoading } = useFitting(id)
	const updateMutation = useUpdateFitting()
	const canManage = isAdmin || hasPermission('urn:doctrines:manager')

	usePageTitle(
		fitting ? t('doctrines.editValue1', { value1: fitting.shipName }) : t('doctrines.editFitting')
	)

	const handleSubmit = async (data: UpdateFittingRequest) => {
		if (!id) return

		try {
			await updateMutation.mutateAsync({ id, data })
			toast.success(t('doctrines.fittingUpdated'))
			void navigate(`/doctrines/fittings/${id}${doctrineId ? `?doctrineId=${doctrineId}` : ''}`)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t('doctrines.failedToUpdateFitting'))
		}
	}

	const handleCancel = () => {
		void navigate(`/doctrines/fittings/${id}${doctrineId ? `?doctrineId=${doctrineId}` : ''}`)
	}

	if (isLoading) {
		return (
			<Container>
				<LoadingSpinner />
			</Container>
		)
	}

	if (!fitting) {
		return (
			<Container>
				<PageHeader title={t('doctrines.fittingNotFound')} />
				<Card>
					<CardContent className="pt-6">
						<div className="text-center">
							<p className="text-muted-foreground mb-4">
								{t('doctrines.theFittingYouReTryingToEditDoesnTExist')}
							</p>
							<Button asChild variant="ghost">
								<Link to="/doctrines">
									<ArrowLeft className="h-4 w-4" />
									{t('doctrines.backToDoctrines')}
								</Link>
							</Button>
						</div>
					</CardContent>
				</Card>
			</Container>
		)
	}

	return (
		<Container>
			<Button asChild variant="ghost" size="sm" className="mb-4">
				<Link to={`/doctrines/fittings/${id}${doctrineId ? `?doctrineId=${doctrineId}` : ''}`}>
					<ArrowLeft className="h-4 w-4" />
					{t('doctrines.backToFitting')}
				</Link>
			</Button>

			<PageHeader
				title={t('doctrines.editValue1', { value1: fitting.shipName })}
				description={t('doctrines.updateFittingDetailsAndEftFormat')}
			/>

			{canManage ? (
				<div className="grid gap-6 lg:grid-cols-2">
					{/* Left — Form */}
					<Card>
						<CardContent className="pt-6">
							<FittingForm
								fitting={fitting}
								onSubmit={handleSubmit}
								onCancel={handleCancel}
								isSubmitting={updateMutation.isPending}
							/>
						</CardContent>
					</Card>

					{/* Right — Visual Preview */}
					{fitting.fittingItems && fitting.fittingItems.length > 0 && (
						<div className="space-y-6">
							<Card>
								<CardContent className="pt-6">
									<FittingPanel
										fittingItems={fitting.fittingItems}
										shipTypeId={fitting.shipTypeId}
										shipName={fitting.shipName}
									/>
								</CardContent>
							</Card>
							<Card>
								<CardContent className="pt-6">
									<FittingSlotList fittingItems={fitting.fittingItems} />
								</CardContent>
							</Card>
						</div>
					)}
				</div>
			) : (
				<Card>
					<CardContent className="pt-6">
						<p className="text-sm text-muted-foreground">
							{t('doctrines.youDoNotHavePermissionToPerformThisAction')}
						</p>
					</CardContent>
				</Card>
			)}
		</Container>
	)
}
