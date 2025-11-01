/**
 * Corporation Detail Page
 *
 * Public page showing detailed corporation information and application instructions.
 * Users can view the full description and submit an application.
 */

import { useQuery } from '@tanstack/react-query'
import { AlertCircle, ArrowLeft, Building2, FileText } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { LoadingSpinner } from '@/components/ui/loading'
import { Separator } from '@/components/ui/separator'
import { SubmitApplicationDialog } from '@/features/applications'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'

// ============================================================================
// Component
// ============================================================================

export default function CorporationDetail() {
	const { corporationId } = useParams<{ corporationId: string }>()
	const navigate = useNavigate()
	const { isAuthenticated, isLoading: authLoading } = useAuth()
	const [showApplicationDialog, setShowApplicationDialog] = useState(false)

	// Fetch corporation details
	const {
		data: corporation,
		isLoading: corpLoading,
		error: corpError,
	} = useQuery({
		queryKey: ['corporations', corporationId],
		queryFn: () => api.getCorporationDetail(corporationId!),
		enabled: !!corporationId,
	})

	// Set page title
	usePageTitle(corporation ? corporation.name : 'Corporation Details')

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Check corporation ID
	if (!corporationId) {
		return <Navigate to="/join" replace />
	}

	// Loading state
	if (authLoading || corpLoading) {
		return (
			<div className="container mx-auto max-w-4xl px-4 py-8">
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</div>
		)
	}

	// Error state
	if (corpError || !corporation) {
		return (
			<div className="container mx-auto max-w-4xl px-4 py-8">
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">
							Corporation Not Found
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							The requested corporation could not be found or is not currently recruiting.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="outline" onClick={() => navigate('/join')}>
							Back to Browse Corporations
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div className="container mx-auto max-w-4xl px-4 py-8">
			{/* Breadcrumbs */}
			<Breadcrumb className="mb-6">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink href="/join">Join Corporations</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>{corporation.name}</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			{/* Back Button */}
			<Button
				variant="ghost"
				size="sm"
				onClick={() => navigate('/join')}
				className="mb-4"
			>
				<ArrowLeft className="mr-2 h-4 w-4" />
				Back to Browse
			</Button>

			{/* Corporation Header */}
			<Card className="mb-6">
				<CardHeader>
					<div className="flex items-start gap-4">
						<div className="p-4 bg-primary/10 rounded-lg">
							<Building2 className="h-16 w-16 text-primary" />
						</div>
						<div className="flex-1">
							<CardTitle className="text-3xl mb-2">{corporation.name}</CardTitle>
							<CardDescription className="text-lg">[{corporation.ticker}]</CardDescription>
							{corporation.shortDescription && (
								<p className="mt-4 text-muted-foreground">{corporation.shortDescription}</p>
							)}
						</div>
					</div>
				</CardHeader>
			</Card>

			{/* Full Description */}
			{corporation.fullDescription ? (
				<Card className="mb-6">
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<FileText className="h-5 w-5" />
							About & Application Instructions
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="prose prose-sm dark:prose-invert max-w-none">
							<pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
								{corporation.fullDescription}
							</pre>
						</div>
					</CardContent>
				</Card>
			) : (
				<Card className="mb-6">
					<CardContent className="py-12 text-center">
						<FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
						<p className="text-muted-foreground">
							This corporation hasn't provided detailed information yet.
						</p>
					</CardContent>
				</Card>
			)}

			<Separator className="my-6" />

			{/* Application Section */}
			<Card className="bg-primary/5 border-primary/20">
				<CardHeader>
					<CardTitle>Ready to Apply?</CardTitle>
					<CardDescription>
						Submit your application to join {corporation.name}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ConfirmButton
						size="lg"
						onClick={() => setShowApplicationDialog(true)}
						className="w-full sm:w-auto"
					>
						Apply to Join {corporation.name}
					</ConfirmButton>
				</CardContent>
			</Card>

			{/* Application Dialog */}
			<SubmitApplicationDialog
				open={showApplicationDialog}
				onOpenChange={setShowApplicationDialog}
				corporationId={corporation.corporationId}
				corporationName={corporation.name}
			/>
		</div>
	)
}
