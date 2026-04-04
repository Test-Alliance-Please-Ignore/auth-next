/**
 * Edit Fitting Page
 *
 * Form to edit an existing fitting
 */

import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { usePageTitle } from '@/hooks/usePageTitle'

import { FittingForm } from '../components/FittingForm'
import { useFitting, useUpdateFitting } from '../hooks'

import type { UpdateFittingRequest } from '../types'

export default function FittingEditPage() {
	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const { data: fitting, isLoading } = useFitting(id)
	const updateMutation = useUpdateFitting()

	usePageTitle(fitting ? `Edit ${fitting.shipName}` : 'Edit Fitting')

	const handleSubmit = async (data: UpdateFittingRequest) => {
		if (!id) return

		try {
			await updateMutation.mutateAsync({ id, data })
			navigate(`/doctrines/fittings/${id}`)
		} catch (error) {
			console.error('Failed to update fitting:', error)
		}
	}

	const handleCancel = () => {
		navigate(`/doctrines/fittings/${id}`)
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
				<Section>
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
				</Section>
			</Container>
		)
	}

	return (
		<Container>
			<Button asChild variant="ghost" size="sm" className="mb-4">
				<Link to={`/doctrines/fittings/${id}`}>
					<ArrowLeft className="h-4 w-4 mr-2" />
					Back to Fitting
				</Link>
			</Button>

			<PageHeader
				title={`Edit ${fitting.shipName}`}
				description="Update fitting details and EFT format"
			/>

			<Section>
				<div className="max-w-2xl">
					<FittingForm
						fitting={fitting}
						onSubmit={handleSubmit}
						onCancel={handleCancel}
						isSubmitting={updateMutation.isPending}
					/>
				</div>
			</Section>
		</Container>
	)
}
