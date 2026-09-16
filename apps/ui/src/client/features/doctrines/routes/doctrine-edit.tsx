/**
 * Edit Doctrine Page
 *
 * Form to edit an existing doctrine
 */

import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import { DoctrineForm } from '../components/DoctrineForm'
import { useDoctrine, useUpdateDoctrine } from '../hooks'

import type { UpdateDoctrineRequest } from '../types'

export default function DoctrineEditPage() {
	const { t } = useAppTranslation()

	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const { hasPermission, isAdmin } = useUserPermissions()
	const { data: doctrine, isLoading } = useDoctrine(id)
	const updateMutation = useUpdateDoctrine()
	const canManage = isAdmin || hasPermission('urn:doctrines:manager')

	usePageTitle(
		doctrine ? t('doctrines.editValue1', { value1: doctrine.name }) : t('doctrines.editDoctrine')
	)

	const handleSubmit = async (data: UpdateDoctrineRequest) => {
		if (!id) return

		try {
			await updateMutation.mutateAsync({ id, data })
			toast.success(t('doctrines.doctrineUpdated'))
			void navigate(`/doctrines/${id}`)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t('doctrines.failedToUpdateDoctrine'))
		}
	}

	const handleCancel = () => {
		void navigate(`/doctrines/${id}`)
	}

	if (isLoading) {
		return (
			<Container>
				<LoadingSpinner />
			</Container>
		)
	}

	if (!doctrine) {
		return (
			<Container>
				<PageHeader title={t('doctrines.doctrineNotFound')} />
				<Card>
					<CardContent className="pt-6">
						<div className="text-center">
							<p className="text-muted-foreground mb-4">
								{t('doctrines.theDoctrineYouReTryingToEditDoesnTExist')}
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
				<Link to={`/doctrines/${id}`}>
					<ArrowLeft className="h-4 w-4" />
					{t('doctrines.backToDoctrine')}
				</Link>
			</Button>

			<PageHeader
				title={t('doctrines.editValue1', { value1: doctrine.name })}
				description={t('doctrines.updateDoctrineDetails')}
			/>

			{canManage ? (
				<Card>
					<CardContent className="pt-6">
						<div className="max-w-2xl">
							<DoctrineForm
								doctrine={doctrine}
								onSubmit={handleSubmit}
								onCancel={handleCancel}
								isSubmitting={updateMutation.isPending}
							/>
						</div>
					</CardContent>
				</Card>
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
