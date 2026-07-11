import { ArrowLeft } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAdminOAuthResolverInspection, useAdminUser } from '@/hooks/useAdminUsers'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDateTime } from '@/lib/date-utils'

export default function AdminUserOAuthInspectionPage() {
	usePageTitle('Admin - OAuth Resolver Inspection')
	const { userId } = useParams<{ userId: string }>()
	const navigate = useNavigate()

	const { data: user, isLoading: userLoading } = useAdminUser(userId!)
	const {
		data: inspection,
		isLoading: inspectionLoading,
		error,
	} = useAdminOAuthResolverInspection(userId!, !!userId)

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-4">
				<Button variant="ghost" onClick={() => navigate(`/admin/users/${userId}`)}>
					<ArrowLeft className="h-4 w-4" />
					Back to User
				</Button>
			</div>

			<div className="space-y-1">
				<h1 className="text-3xl font-bold gradient-text">OAuth Resolver Inspection</h1>
				<p className="text-muted-foreground">
					{userLoading
						? 'Loading user...'
						: `Resolved profile, groups, and permissions payload for ${
								user?.characters.find((c) => c.is_primary)?.characterName || 'user'
							}`}
				</p>
			</div>

			{inspectionLoading ? (
				<Card>
				<CardContent className="py-8 text-center text-muted-foreground">
						Loading OAuth resolver inspection...
					</CardContent>
				</Card>
			) : error ? (
				<Card className="border-destructive/30 bg-destructive/10">
					<CardContent className="py-4 text-destructive">
						Failed to inspect OAuth resolver response right now. Please try again.
					</CardContent>
				</Card>
			) : !inspection ? (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground">
						No inspection data available.
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardHeader>
						<CardTitle>Resolver Payload</CardTitle>
						<CardDescription>
							Generated at {formatDateTime(inspection.inspectedAt)} for user {inspection.userId}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<pre className="overflow-auto rounded-md border bg-muted/30 p-4 text-xs">
							{JSON.stringify(inspection, null, 2)}
						</pre>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
