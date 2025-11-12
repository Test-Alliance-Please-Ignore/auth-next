/**
 * Create Fitting Page
 *
 * Form to create a new fitting with EFT import
 */

import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { usePageTitle } from '@/hooks/usePageTitle'

import { FittingForm } from '../components/FittingForm'
import { useCreateFitting } from '../hooks'

import type { CreateFittingRequest } from '../types'

export default function FittingCreatePage() {
	usePageTitle('Create Fitting')
	const navigate = useNavigate()
	const createMutation = useCreateFitting()

	const handleSubmit = async (data: CreateFittingRequest) => {
		try {
			const result = await createMutation.mutateAsync(data)
			navigate(`/doctrines/fittings/${result.id}`)
		} catch (error) {
			console.error('Failed to create fitting:', error)
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

			<PageHeader title="Create Fitting" description="Import a new ship fitting from EFT format" />

			<Section>
				<div className="max-w-2xl">
					<FittingForm
						onSubmit={handleSubmit}
						onCancel={handleCancel}
						isSubmitting={createMutation.isPending}
					/>
				</div>
			</Section>
		</Container>
	)
}
