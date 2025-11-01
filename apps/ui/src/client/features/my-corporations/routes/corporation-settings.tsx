/**
 * Corporation Settings Page
 *
 * Allows corporation CEOs and site admins to configure recruiting settings.
 * Settings include: recruiting status, short description, and full description.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/useAuth'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'

// ============================================================================
// Component
// ============================================================================

export default function CorporationSettings() {
	const { corporationId } = useParams<{ corporationId: string }>()
	const navigate = useNavigate()
	const { showSuccess, showError } = useMessage()
	const queryClient = useQueryClient()
	const { isAuthenticated, isLoading: authLoading } = useAuth()

	// Form state
	const [isRecruiting, setIsRecruiting] = useState(true)
	const [shortDescription, setShortDescription] = useState('')
	const [fullDescription, setFullDescription] = useState('')
	const [hasChanges, setHasChanges] = useState(false)
	const [shortDescError, setShortDescError] = useState('')

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
	usePageTitle(corporation ? `${corporation.name} - Settings` : 'Corporation Settings')

	// Update form when corporation data loads
	useEffect(() => {
		if (corporation) {
			setIsRecruiting(corporation.isRecruiting)
			setShortDescription(corporation.shortDescription || '')
			setFullDescription(corporation.fullDescription || '')
			setHasChanges(false)
		}
	}, [corporation])

	// Track changes
	useEffect(() => {
		if (corporation) {
			const changed =
				isRecruiting !== corporation.isRecruiting ||
				shortDescription !== (corporation.shortDescription || '') ||
				fullDescription !== (corporation.fullDescription || '')
			setHasChanges(changed)
		}
	}, [isRecruiting, shortDescription, fullDescription, corporation])

	// Validate short description length
	useEffect(() => {
		if (shortDescription.length > 250) {
			setShortDescError('Short description must not exceed 250 characters')
		} else {
			setShortDescError('')
		}
	}, [shortDescription])

	// Update settings mutation
	const updateSettings = useMutation({
		mutationFn: () =>
			api.updateCorporationSettings(corporationId!, {
				isRecruiting,
				shortDescription: shortDescription || null,
				fullDescription: fullDescription || null,
			}),
		onSuccess: (data) => {
			// Update cache
			queryClient.setQueryData(['corporations', corporationId], data)
			queryClient.invalidateQueries({ queryKey: ['corporations', 'browse'] })

			showSuccess('Corporation recruiting settings have been saved successfully.')

			setHasChanges(false)
		},
		onError: (error) => {
			showError(error instanceof Error ? error.message : 'Failed to update settings')
		},
	})

	// Form submission
	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()
		if (shortDescError) return
		updateSettings.mutate()
	}

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Check corporation ID
	if (!corporationId) {
		return <Navigate to="/my-corporations" replace />
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
							The requested corporation could not be found or you don't have permission to access it.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="outline" onClick={() => navigate('/my-corporations')}>
							Back to My Corporations
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	// Character count for short description
	const shortDescLength = shortDescription.length
	const shortDescRemaining = 250 - shortDescLength

	return (
		<div className="container mx-auto max-w-4xl px-4 py-8">
			{/* Breadcrumbs */}
			<Breadcrumb className="mb-6">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink href="/my-corporations">My Corporations</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbLink href={`/my-corporations/${corporationId}/members`}>
							{corporation.name}
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>Settings</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			{/* Header */}
			<PageHeader
				title="Recruiting Settings"
				description={`Configure how ${corporation.name} appears to applicants`}
			/>

			{/* Settings Form */}
			<form onSubmit={handleSubmit} className="space-y-6">
				{/* Recruiting Status Section */}
				<Card>
					<CardHeader>
						<CardTitle>Recruiting Status</CardTitle>
						<CardDescription>
							Control whether your corporation appears in the Browse Corporations list
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="flex flex-row items-center justify-between rounded-lg border p-4">
							<div className="space-y-0.5">
								<Label htmlFor="is-recruiting" className="text-base">
									Open for Recruitment
								</Label>
								<div className="text-sm text-muted-foreground">
									When enabled, your corporation will be visible to players browsing for corporations to join
								</div>
							</div>
							<Switch
								id="is-recruiting"
								checked={isRecruiting}
								onCheckedChange={setIsRecruiting}
							/>
						</div>
					</CardContent>
				</Card>

				{/* Short Description Section */}
				<Card>
					<CardHeader>
						<CardTitle>Short Description</CardTitle>
						<CardDescription>
							Brief description shown on the Browse Corporations page (2-3 sentences, max 250 characters)
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-2">
							<Textarea
								placeholder="Example: We're a PvP-focused corporation operating in null-sec. New players welcome! We offer training, ship replacement, and regular fleet ops."
								className="min-h-[100px] resize-none"
								value={shortDescription}
								onChange={(e) => setShortDescription(e.target.value)}
							/>
							<div className="flex justify-between text-sm">
								<span className="text-muted-foreground">This appears on the browse page to attract applicants</span>
								<span className={shortDescRemaining < 0 ? 'text-destructive' : 'text-muted-foreground'}>
									{shortDescRemaining} characters remaining
								</span>
							</div>
							{shortDescError && (
								<p className="text-sm text-destructive">{shortDescError}</p>
							)}
						</div>
					</CardContent>
				</Card>

				{/* Full Description Section */}
				<Card>
					<CardHeader>
						<CardTitle>Full Description & Application Instructions</CardTitle>
						<CardDescription>
							Detailed information shown on the corporation detail page, including requirements and how to apply
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-2">
							<Textarea
								placeholder={`Example:\n\n## About Us\nWe're a well-established corporation with 200+ members focusing on null-sec PvP and industry.\n\n## What We Offer\n- Ship replacement program\n- Regular fleet ops (EU/US timezone)\n- Free skill books and ships for new members\n- Access to alliance infrastructure\n\n## Requirements\n- Minimum 5 million skill points\n- Discord required (voice comms mandatory for fleets)\n- Active at least 3-4 times per week\n- Willingness to participate in CTAs\n\n## How to Apply\n1. Submit your application through this page\n2. Join our public Discord: discord.gg/example\n3. Reach out to a recruiter for an interview\n4. Complete a quick background check\n\nWe look forward to flying with you!`}
								className="min-h-[300px] font-mono text-sm"
								value={fullDescription}
								onChange={(e) => setFullDescription(e.target.value)}
							/>
							<p className="text-sm text-muted-foreground">
								Use this space to describe your corporation, list requirements, and explain the application process.
								You can use formatting like ** for bold and ## for headings.
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Actions */}
				<div className="flex items-center gap-4">
					<Button
						type="submit"
						disabled={updateSettings.isPending || !hasChanges || !!shortDescError}
						className="w-full sm:w-auto"
					>
						{updateSettings.isPending ? (
							<>
								<LoadingSpinner size="sm" className="mr-2" />
								Saving...
							</>
						) : (
							<>
								<Save className="mr-2 h-4 w-4" />
								Save Settings
							</>
						)}
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={() => navigate(`/my-corporations/${corporationId}/members`)}
					>
						Cancel
					</Button>
				</div>
			</form>
		</div>
	)
}
