/**
 * Create Doctrine Page
 *
 * Form to create a new doctrine
 */

import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { usePageTitle } from '@/hooks/usePageTitle'

import { DoctrineForm } from '../components/DoctrineForm'
import { useCreateDoctrine } from '../hooks'

import type { CreateDoctrineRequest, UpdateDoctrineRequest } from '../types'

export default function DoctrineCreatePage() {
	usePageTitle('Create Doctrine')
	const navigate = useNavigate()
	const createMutation = useCreateDoctrine()

	const handleSubmit = async (data: CreateDoctrineRequest | UpdateDoctrineRequest) => {
		try {
			const result = await createMutation.mutateAsync(data as CreateDoctrineRequest)
			navigate(`/doctrines/${result.id}`)
		} catch (error) {
			console.error('Failed to create doctrine:', error)
		}
	}

	const handleCancel = () => {
		navigate('/doctrines')
	}

	return (
		<Container>
			<Button asChild variant="ghost" size="sm" className="mb-4">
				<Link to="/doctrines">
					<ArrowLeft className="h-4 w-4 mr-2" />
					Back to Doctrines
				</Link>
			</Button>

			<PageHeader title="Create Doctrine" description="Define a new fleet doctrine" />

			<Section>
				<div className="max-w-2xl">
					<DoctrineForm
						onSubmit={handleSubmit}
						onCancel={handleCancel}
						isSubmitting={createMutation.isPending}
					/>
				</div>
			</Section>
		</Container>
	)
}
