/**
 * Create Doctrine Page
 *
 * Form to create a new doctrine
 */

import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import toast from '@/lib/toast'

import { DoctrineForm } from '../components/DoctrineForm'
import { useCreateDoctrine } from '../hooks'

import type { CreateDoctrineRequest, UpdateDoctrineRequest } from '../types'

export default function DoctrineCreatePage() {
	usePageTitle('Create Doctrine')
	const navigate = useNavigate()
	const { hasPermission, isAdmin } = useUserPermissions()
	const createMutation = useCreateDoctrine()
	const canManage = isAdmin || hasPermission('urn:doctrines:manager')

	const handleSubmit = async (data: CreateDoctrineRequest | UpdateDoctrineRequest) => {
		try {
			const result = await createMutation.mutateAsync(data as CreateDoctrineRequest)
			toast.success('Doctrine created')
			void navigate(`/doctrines/${result.id}`)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to create doctrine')
		}
	}

	const handleCancel = () => {
		void navigate('/doctrines')
	}

	return (
		<Container>
			<Button asChild variant="ghost" size="sm" className="mb-4">
				<Link to="/doctrines">
					<ArrowLeft className="h-4 w-4" />
					Back to Doctrines
				</Link>
			</Button>

			<PageHeader title="Create Doctrine" description="Define a new fleet doctrine" />

			{canManage ? (
				<Card>
					<CardContent className="pt-6">
						<div className="max-w-2xl">
							<DoctrineForm
								onSubmit={handleSubmit}
								onCancel={handleCancel}
								isSubmitting={createMutation.isPending}
							/>
						</div>
					</CardContent>
				</Card>
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
