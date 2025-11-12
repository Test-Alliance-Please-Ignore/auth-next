/**
 * Doctrines Landing Page
 *
 * Browse all doctrines grouped by category
 */

import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'

import { CategorySection } from '../components/CategorySection'
import { useDoctrines } from '../hooks'
import { groupDoctrinesByCategory } from '../utils'

export default function DoctrinesPage() {
	usePageTitle('Doctrines')
	const { user } = useAuth()
	const { data: doctrines, isLoading, error } = useDoctrines()

	// Check if user has create permission
	const canCreate =
		user?.permissions?.some((p) => p.urn === 'urn:doctrines:create') || user?.is_admin

	if (isLoading) {
		return (
			<Container>
				<PageHeader title="Doctrines" description="Browse fleet doctrines" />
				<Section>
					<LoadingSpinner />
				</Section>
			</Container>
		)
	}

	if (error) {
		return (
			<Container>
				<PageHeader title="Doctrines" description="Browse fleet doctrines" />
				<Section>
					<div className="text-center text-destructive">
						Failed to load doctrines. Please try again later.
					</div>
				</Section>
			</Container>
		)
	}

	const grouped = doctrines ? groupDoctrinesByCategory(doctrines) : {}
	const categories = Object.keys(grouped).sort()

	return (
		<Container>
			<PageHeader
				title="Doctrines"
				description="Browse and manage fleet doctrines"
				action={
					canCreate && (
						<Button asChild>
							<Link to="/doctrines/create">
								<Plus className="h-4 w-4 mr-2" />
								New Doctrine
							</Link>
						</Button>
					)
				}
			/>

			<Section>
				{categories.length === 0 ? (
					<div className="text-center py-12">
						<p className="text-muted-foreground mb-4">No doctrines found.</p>
						{canCreate && (
							<Button asChild>
								<Link to="/doctrines/create">
									<Plus className="h-4 w-4 mr-2" />
									Create First Doctrine
								</Link>
							</Button>
						)}
					</div>
				) : (
					<div className="space-y-6">
						{categories.map((category) => (
							<CategorySection key={category} category={category} doctrines={grouped[category]} />
						))}
					</div>
				)}
			</Section>
		</Container>
	)
}
