/**
 * Doctrine Detail Page
 *
 * View a single doctrine with its associated fittings
 */

import { ArrowLeft, Edit, Plus, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { DestructiveButton } from '@/components/ui/destructive-button'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'

import { FittingCard } from '../components/FittingCard'
import { useDeleteDoctrine, useDoctrine } from '../hooks'

export default function DoctrineDetailPage() {
	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const { user } = useAuth()
	const { data: doctrine, isLoading, error } = useDoctrine(id)
	const deleteMutation = useDeleteDoctrine()

	usePageTitle(doctrine?.name || 'Doctrine Details')

	// Check permissions
	const canEdit = user?.permissions?.some((p) => p.urn === 'urn:doctrines:edit') || user?.is_admin
	const canDelete =
		user?.permissions?.some((p) => p.urn === 'urn:doctrines:delete') || user?.is_admin

	const handleDelete = async () => {
		if (!id || !confirm('Are you sure you want to delete this doctrine?')) return

		try {
			await deleteMutation.mutateAsync(id)
			navigate('/doctrines')
		} catch (error) {
			console.error('Failed to delete doctrine:', error)
		}
	}

	if (isLoading) {
		return (
			<Container>
				<LoadingSpinner />
			</Container>
		)
	}

	if (error || !doctrine) {
		return (
			<Container>
				<PageHeader title="Doctrine Not Found" />
				<Section>
					<div className="text-center">
						<p className="text-muted-foreground mb-4">
							The doctrine you're looking for doesn't exist or you don't have permission to view it.
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
				<Link to="/doctrines">
					<ArrowLeft className="h-4 w-4 mr-2" />
					Back to Doctrines
				</Link>
			</Button>

			<PageHeader
				title={doctrine.name}
				description={`Category: ${doctrine.category} • Maintained by ${doctrine.maintainer}`}
				action={
					<div className="flex gap-2">
						{canEdit && (
							<Button asChild variant="outline">
								<Link to={`/doctrines/${id}/edit`}>
									<Edit className="h-4 w-4 mr-2" />
									Edit
								</Link>
							</Button>
						)}
						{canDelete && (
							<DestructiveButton
								onClick={handleDelete}
								loading={deleteMutation.isPending}
								loadingText="Deleting..."
							>
								<Trash2 className="h-4 w-4 mr-2" />
								Delete
							</DestructiveButton>
						)}
					</div>
				}
			/>

			<Section title="Fittings" description="Ship fittings for this doctrine">
				{doctrine.fittings.length === 0 ? (
					<div className="text-center py-12">
						<p className="text-muted-foreground mb-4">No fittings added yet.</p>
						{canEdit && (
							<Button asChild variant="outline">
								<Link to="/doctrines/fittings/create">
									<Plus className="h-4 w-4 mr-2" />
									Add Fitting
								</Link>
							</Button>
						)}
					</div>
				) : (
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{doctrine.fittings.map((fitting) => (
							<FittingCard key={fitting.id} fitting={fitting} />
						))}
					</div>
				)}
			</Section>
		</Container>
	)
}
