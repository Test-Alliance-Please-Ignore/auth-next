/**
 * Edit Fitting Page
 *
 * Form to edit an existing fitting
 */

import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { usePageTitle } from '@/hooks/usePageTitle'
import toast from '@/lib/toast'

import { FittingForm } from '../components/FittingForm'
import { FittingPanel } from '../components/FittingPanel'
import { FittingSlotList } from '../components/FittingSlotList'
import { useFitting, useUpdateFitting } from '../hooks'

import type { UpdateFittingRequest } from '../types'

export default function FittingEditPage() {
	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const [searchParams] = useSearchParams()
	const doctrineId = searchParams.get('doctrineId')
	const { data: fitting, isLoading } = useFitting(id)
	const updateMutation = useUpdateFitting()

	usePageTitle(fitting ? `Edit ${fitting.shipName}` : 'Edit Fitting')

	const handleSubmit = async (data: UpdateFittingRequest) => {
		if (!id) return

		try {
			await updateMutation.mutateAsync({ id, data })
			toast.success('Fitting updated')
			navigate(`/doctrines/fittings/${id}${doctrineId ? `?doctrineId=${doctrineId}` : ''}`)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to update fitting')
		}
	}

	const handleCancel = () => {
		navigate(`/doctrines/fittings/${id}${doctrineId ? `?doctrineId=${doctrineId}` : ''}`)
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
				<PageHeader title="Fitting Not Found" />
				<Card>
					<CardContent className="pt-6">
						<div className="text-center">
							<p className="text-muted-foreground mb-4">
								The fitting you're trying to edit doesn't exist.
							</p>
							<Button asChild variant="ghost">
								<Link to="/doctrines">
									<ArrowLeft className="h-4 w-4 mr-2" />
									Back to Doctrines
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
					<ArrowLeft className="h-4 w-4 mr-2" />
					Back to Fitting
				</Link>
			</Button>

			<PageHeader
				title={`Edit ${fitting.shipName}`}
				description="Update fitting details and EFT format"
			/>

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
		</Container>
	)
}
