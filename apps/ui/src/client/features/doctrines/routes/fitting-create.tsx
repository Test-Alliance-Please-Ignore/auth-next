/**
 * Create Fitting Page
 *
 * Form to create a new fitting with EFT import
 */

import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { api } from '@/lib/api'
import toast from '@/lib/toast'

import { FittingForm } from '../components/FittingForm'
import { FittingPanel } from '../components/FittingPanel'
import { FittingSlotList } from '../components/FittingSlotList'
import { useAddFittingToDoctrine, useCreateFitting } from '../hooks'

import type { CreateFittingRequest, ParsedFittingPreview, UpdateFittingRequest } from '../types'

export default function FittingCreatePage() {
	usePageTitle('Create Fitting')
	const navigate = useNavigate()
	const { hasPermission, isAdmin } = useUserPermissions()
	const [searchParams] = useSearchParams()
	const doctrineId = searchParams.get('doctrineId')
	const createMutation = useCreateFitting()
	const addToDoctrine = useAddFittingToDoctrine()
	const canManage = isAdmin || hasPermission('urn:doctrines:manager')
	const [preview, setPreview] = useState<ParsedFittingPreview | null>(null)
	const [previewLoading, setPreviewLoading] = useState(false)

	const handlePreviewChange = async (eftString: string | null) => {
		if (!eftString) {
			setPreview(null)
			return
		}
		setPreviewLoading(true)
		try {
			const result = await api.previewEft(eftString)
			setPreview(result)
		} catch (_err) {
			setPreview(null)
		} finally {
			setPreviewLoading(false)
		}
	}

	const handleSubmit = async (data: CreateFittingRequest | UpdateFittingRequest) => {
		try {
			const result = await createMutation.mutateAsync(data as CreateFittingRequest)
			if (doctrineId) {
				await addToDoctrine.mutateAsync({
					doctrineId,
					fittingId: result.id,
					fittingCategory: (data as CreateFittingRequest).category || undefined,
					sortOrder: 0,
				})
				toast.success('Fitting created and added to doctrine')
				navigate(`/doctrines/${doctrineId}`)
			} else {
				toast.success('Fitting created')
				navigate(`/doctrines/fittings/${result.id}`)
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to create fitting')
		}
	}

	const handleCancel = () => {
		if (doctrineId) {
			navigate(`/doctrines/${doctrineId}`)
		} else {
			navigate('/doctrines')
		}
	}

	return (
		<Container>
			<Button asChild variant="ghost" size="sm" className="mb-4">
				<Link to={doctrineId ? `/doctrines/${doctrineId}` : '/doctrines'}>
					<ArrowLeft className="h-4 w-4" />
					{doctrineId ? 'Back to Doctrine' : 'Back to Doctrines'}
				</Link>
			</Button>

			<PageHeader title="Create Fitting" description="Import a new ship fitting from EFT format" />

			{canManage ? (
				<div className="grid gap-6 lg:grid-cols-2">
					{/* Left — Form */}
					<Card>
						<CardContent className="pt-6">
							<FittingForm
								onSubmit={handleSubmit}
								onCancel={handleCancel}
								isSubmitting={createMutation.isPending}
								onPreviewChange={handlePreviewChange}
							/>
						</CardContent>
					</Card>

					{/* Right — Visual Preview */}
					{(preview || previewLoading) && (
						<div className="space-y-6">
							{previewLoading ? (
								<Card>
									<CardContent className="pt-6 flex justify-center">
										<LoadingSpinner />
									</CardContent>
								</Card>
							) : preview && preview.items.length > 0 ? (
								<>
									{preview.unresolvedItems?.length > 0 && (
										<Card>
											<CardContent className="pt-4 pb-4">
												<p className="text-sm text-amber-400">
													Could not resolve:{' '}
													{preview.unresolvedItems.join(', ')}
												</p>
											</CardContent>
										</Card>
									)}
									<Card>
										<CardContent className="pt-6">
											<FittingPanel
												fittingItems={preview.items}
												shipTypeId={preview.shipTypeId}
												shipName={preview.shipName}
											/>
										</CardContent>
									</Card>
									<Card>
										<CardContent className="pt-6">
											<FittingSlotList fittingItems={preview.items} />
										</CardContent>
									</Card>
								</>
							) : null}
						</div>
					)}
				</div>
			) : (
				<Card>
					<CardContent className="pt-6">
						<p className="text-sm text-muted-foreground">
							You do not have permission to perform this action.
						</p>
					</CardContent>
				</Card>
			)}
		</Container>
	)
}
