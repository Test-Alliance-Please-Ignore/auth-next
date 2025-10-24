import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { GroupForm } from '@/components/group-form'
import { useCreateGroup } from '@/hooks/useGroups'
import { useCategories } from '@/hooks/useCategories'
import type { CreateGroupRequest } from '@/lib/api'

export default function CreateGroupPage() {
	const navigate = useNavigate()
	const createGroup = useCreateGroup()
	const { data: categories } = useCategories()
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	const handleCreate = async (data: CreateGroupRequest) => {
		try {
			const newGroup = await createGroup.mutateAsync(data)
			setMessage({ type: 'success', text: 'Group created successfully!' })

			// Navigate to the newly created group after a short delay
			setTimeout(() => {
				void navigate(`/groups/${newGroup.id}`)
			}, 1500)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to create group',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	return (
		<Container>
			<PageHeader
				title="Create New Group"
				description="Set up a new group to organize and connect with other players"
			/>

			<Section>
				{/* Back Button */}
				<Button variant="ghost" onClick={() => navigate('/groups')}>
					<ArrowLeft className="mr-2 h-4 w-4" />
					Back to Groups
				</Button>

				{/* Success/Error Message */}
				{message && (
					<Card
						className={
							message.type === 'error'
								? 'border-destructive bg-destructive/10'
								: 'border-primary bg-primary/10'
						}
					>
						<CardContent className="py-3">
							<p className={message.type === 'error' ? 'text-destructive' : 'text-primary'}>
								{message.text}
							</p>
						</CardContent>
					</Card>
				)}

				{/* Create Group Form */}
				<Card variant="elevated">
					<CardHeader>
						<CardTitle>Group Details</CardTitle>
						<CardDescription>
							Fill in the information below to create your group. You will become the owner and can manage
							members, settings, and permissions.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{categories ? (
							<GroupForm
								categories={categories}
								onSubmit={handleCreate}
								onCancel={() => navigate('/groups')}
								isSubmitting={createGroup.isPending}
							/>
						) : (
							<div className="py-8 text-center text-muted-foreground">Loading categories...</div>
						)}
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
