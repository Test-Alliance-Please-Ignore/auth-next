/**
 * Fitting Detail Page
 *
 * View a single fitting with full item list
 */

import { ArrowLeft, CheckCircle2, DollarSign, Edit, Ship, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'

import { EftPreview } from '../components/EftPreview'
import { useDeleteFitting, useFitting } from '../hooks'
import { formatISK } from '../utils'

export default function FittingDetailPage() {
	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const { user } = useAuth()
	const { data: fitting, isLoading, error } = useFitting(id)
	const deleteMutation = useDeleteFitting()

	usePageTitle(fitting ? `${fitting.shipName} Fitting` : 'Fitting Details')

	// Check permissions
	const canEdit =
		user?.permissions?.some((p) => p.urn === 'urn:doctrines:edit_fitting') || user?.is_admin
	const canDelete =
		user?.permissions?.some((p) => p.urn === 'urn:doctrines:delete_fitting') || user?.is_admin

	const handleDelete = async () => {
		if (!id || !confirm('Are you sure you want to delete this fitting?')) return

		try {
			await deleteMutation.mutateAsync(id)
			navigate('/doctrines')
		} catch (error) {
			console.error('Failed to delete fitting:', error)
		}
	}

	if (isLoading) {
		return (
			<Container>
				<LoadingSpinner />
			</Container>
		)
	}

	if (error || !fitting) {
		return (
			<Container>
				<PageHeader title="Fitting Not Found" />
				<Section>
					<div className="text-center">
						<p className="text-muted-foreground mb-4">
							The fitting you're looking for doesn't exist or you don't have permission to view it.
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
				<Link to="/doctrines">
					<ArrowLeft className="h-4 w-4 mr-2" />
					Back to Doctrines
				</Link>
			</Button>

			<PageHeader
				title={fitting.shipName}
				description={
					<div className="flex items-center gap-4 flex-wrap">
						<span>Category: {fitting.category}</span>
						<span>•</span>
						<span>Maintained by {fitting.maintainer}</span>
						{fitting.srpEligible && (
							<>
								<span>•</span>
								<Badge variant="default" className="flex items-center gap-1">
									<CheckCircle2 className="h-3 w-3" />
									SRP Eligible: {formatISK(fitting.srpValue)}
								</Badge>
							</>
						)}
					</div>
				}
				action={
					<div className="flex gap-2">
						{canEdit && (
							<Button asChild variant="ghost">
								<Link to={`/doctrines/fittings/${id}/edit`}>
									<Edit className="h-4 w-4 mr-2" />
									Edit
								</Link>
							</Button>
						)}
						{canDelete && (
							<Button variant="destructive"
								onClick={handleDelete}
								loading={deleteMutation.isPending}
								loadingText="Deleting..."
							>
								<Trash2 className="h-4 w-4 mr-2" />
								Delete
							</Button>
						)}
					</div>
				}
			/>

			<div className="grid gap-6 lg:grid-cols-2">
				{/* EFT Preview */}
				<Section title="Fitting Preview" description="Parsed from EFT format">
					<EftPreview eftString={fitting.fitting} />
				</Section>

				{/* Full Item List */}
				<Section title="Full Item List" description="All modules and cargo">
					<Card>
						<CardHeader>
							<CardTitle className="text-base">Items ({fitting.fittingItems.length})</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Item</TableHead>
											<TableHead>Group</TableHead>
											<TableHead className="text-right">Quantity</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{fitting.fittingItems.map((item) => (
											<TableRow key={item.id}>
												<TableCell className="font-medium">{item.typeName}</TableCell>
												<TableCell className="text-muted-foreground">{item.groupName}</TableCell>
												<TableCell className="text-right">
													{parseInt(item.quantity).toLocaleString()}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						</CardContent>
					</Card>
				</Section>
			</div>

			{/* Raw EFT String */}
			<Section title="EFT Format" description="Copy this to import in-game">
				<Card>
					<CardContent className="pt-6">
						<pre className="p-4 bg-muted rounded-md overflow-x-auto text-sm font-mono whitespace-pre">
							{fitting.fitting}
						</pre>
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
