/**
 * Edit Doctrine Page
 *
 * Form to edit an existing doctrine
 */

import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { usePageTitle } from '@/hooks/usePageTitle'

import { DoctrineForm } from '../components/DoctrineForm'
import { useDoctrine, useUpdateDoctrine } from '../hooks'

import type { UpdateDoctrineRequest } from '../types'

export default function DoctrineEditPage() {
	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const { data: doctrine, isLoading } = useDoctrine(id)
	const updateMutation = useUpdateDoctrine()

	usePageTitle(doctrine ? `Edit ${doctrine.name}` : 'Edit Doctrine')

	const handleSubmit = async (data: UpdateDoctrineRequest) => {
		if (!id) return

		try {
			await updateMutation.mutateAsync({ id, data })
			navigate(`/doctrines/${id}`)
		} catch (error) {
			console.error('Failed to update doctrine:', error)
		}
	}

	const handleCancel = () => {
		navigate(`/doctrines/${id}`)
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
				<PageHeader title="Doctrine Not Found" />
				<Section>
					<div className="text-center">
						<p className="text-muted-foreground mb-4">
							The doctrine you're trying to edit doesn't exist.
						</p>
						<Button asChild variant="outline">
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
				<Link to={`/doctrines/${id}`}>
					<ArrowLeft className="h-4 w-4 mr-2" />
					Back to Doctrine
				</Link>
			</Button>

			<PageHeader title={`Edit ${doctrine.name}`} description="Update doctrine details" />

			<Section>
				<div className="max-w-2xl">
					<DoctrineForm
						doctrine={doctrine}
						onSubmit={handleSubmit}
						onCancel={handleCancel}
						isSubmitting={updateMutation.isPending}
					/>
				</div>
			</Section>
		</Container>
	)
}
