/**
 * Application Action Panel Component
 *
 * Action controls for HR staff to accept/reject/review applications.
 * Different actions available based on HR role (Admin, Reviewer, Viewer).
 */

import { AlertCircle, CheckCircle2, Search } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useMessage } from '@/hooks/useMessage'
import { cn } from '@/lib/utils'

import { canReviewApplication } from '../api'
import { useUpdateApplicationStatus } from '../hooks'
import { TemplateSelector } from './template-selector'

import type { HrRoleType } from '../../hr/api'
import type { Application, ApplicationStatus, MessageTemplate } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface ApplicationActionPanelProps {
	application: Application
	userRole: HrRoleType | null
	onStatusChange?: (status: ApplicationStatus, notes?: string) => void
	disabled?: boolean
	className?: string
}

// ============================================================================
// Component
// ============================================================================

/**
 * Action panel for HR staff to manage applications
 *
 * @example
 * ```tsx
 * <ApplicationActionPanel
 *   application={application}
 *   userRole="hr_admin"
 *   onStatusChange={(status, notes) => console.log('Status changed:', status)}
 * />
 * ```
 */
export function ApplicationActionPanel({
	application,
	userRole,
	onStatusChange,
	disabled = false,
	className,
}: ApplicationActionPanelProps) {
	const { showSuccess, showError } = useMessage()
	const updateStatusMutation = useUpdateApplicationStatus()

	// Local state
	const [reviewNotes, setReviewNotes] = useState('')
	const [reviewNotesError, setReviewNotesError] = useState('')
	const [showAcceptDialog, setShowAcceptDialog] = useState(false)
	const [showCompleteDialog, setShowCompleteDialog] = useState(false)
	const [showRejectDialog, setShowRejectDialog] = useState(false)
	const [pendingTemplate, setPendingTemplate] = useState<MessageTemplate | null>(null)

	// Check if application can be reviewed
	const canReview = canReviewApplication(application)

	// Determine available actions based on role
	const canMarkUnderReview = userRole && ['hr_admin', 'hr_reviewer'].includes(userRole)
	const canAccept = userRole && ['hr_admin', 'hr_reviewer'].includes(userRole)
	const canComplete = userRole && ['hr_admin', 'hr_reviewer'].includes(userRole)
	const canReject = userRole && ['hr_admin', 'hr_reviewer'].includes(userRole)

	// Handle template selection - confirm if text already exists
	const handleSelectTemplate = (template: MessageTemplate) => {
		if (reviewNotes.trim().length > 0) {
			setPendingTemplate(template)
		} else {
			setReviewNotes(template.messageTemplate)
		}
	}

	const handleConfirmTemplate = () => {
		if (pendingTemplate) {
			setReviewNotes(pendingTemplate.messageTemplate)
			setPendingTemplate(null)
		}
	}

	// Validate review notes (required for accept/reject)
	const validateReviewNotes = (): boolean => {
		if (!reviewNotes.trim()) {
			setReviewNotesError('Review notes are required when accepting or rejecting an application')
			return false
		}
		if (reviewNotes.trim().length < 10) {
			setReviewNotesError('Review notes must be at least 10 characters')
			return false
		}
		return true
	}

	// Handler for marking under review
	const handleMarkUnderReview = async () => {
		try {
			await updateStatusMutation.mutateAsync({
				applicationId: application.id,
				data: {
					status: 'under_review',
					reviewNotes: reviewNotes || undefined,
				},
			})

			showSuccess('Application marked as under review')
			setReviewNotes('')
			setReviewNotesError('')

			if (onStatusChange) {
				onStatusChange('under_review', reviewNotes || undefined)
			}
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update application status')
		}
	}

	// Handler for accepting application
	const handleAcceptClick = () => {
		if (!validateReviewNotes()) return
		setShowAcceptDialog(true)
	}

	const handleAcceptConfirm = async () => {
		try {
			await updateStatusMutation.mutateAsync({
				applicationId: application.id,
				data: {
					status: 'accepted',
					reviewNotes,
				},
			})

			showSuccess('Application accepted')
			setShowAcceptDialog(false)
			setReviewNotes('')
			setReviewNotesError('')

			if (onStatusChange) {
				onStatusChange('accepted', reviewNotes)
			}
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to accept application')
		}
	}

	// Handler for completing application
	const handleCompleteClick = () => {
		if (!validateReviewNotes()) return
		setShowCompleteDialog(true)
	}

	const handleCompleteConfirm = async () => {
		try {
			await updateStatusMutation.mutateAsync({
				applicationId: application.id,
				data: {
					status: 'completed',
					reviewNotes,
				},
			})

			showSuccess('Application marked as completed')
			setShowCompleteDialog(false)
			setReviewNotes('')
			setReviewNotesError('')

			if (onStatusChange) {
				onStatusChange('completed', reviewNotes)
			}
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to complete application')
		}
	}

	// Handler for rejecting application
	const handleRejectClick = () => {
		if (!validateReviewNotes()) return
		setShowRejectDialog(true)
	}

	const handleRejectConfirm = async () => {
		try {
			await updateStatusMutation.mutateAsync({
				applicationId: application.id,
				data: {
					status: 'rejected',
					reviewNotes,
				},
			})

			showSuccess('Application rejected')
			setShowRejectDialog(false)
			setReviewNotes('')
			setReviewNotesError('')

			if (onStatusChange) {
				onStatusChange('rejected', reviewNotes)
			}
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to reject application')
		}
	}

	// No actions available
	if (!userRole || userRole === 'hr_viewer') {
		return (
			<Card className={cn('border-muted', className)}>
				<CardHeader>
					<CardTitle>HR Actions</CardTitle>
					<CardDescription>Read-only access - no actions available</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						You have view-only access to applications. Contact an HR Admin for reviewer access.
					</p>
				</CardContent>
			</Card>
		)
	}

	// Application cannot be reviewed or completed (already terminal)
	if (!canReview && application.status !== 'accepted') {
		return (
			<Card className={cn('border-muted', className)}>
				<CardHeader>
					<CardTitle>HR Actions</CardTitle>
					<CardDescription>Application is no longer active</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						This application has already been processed and cannot be modified.
					</p>
				</CardContent>
			</Card>
		)
	}

	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle>HR Actions</CardTitle>
				<CardDescription>
					{userRole === 'hr_admin'
						? 'Accept, reject, or mark this application for review'
						: 'Mark this application for review and add advisory notes'}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Review Notes Textarea */}
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<Label htmlFor="review-notes">
							{userRole === 'hr_admin' ? (
								<>
									Review Notes <span className="text-destructive">*</span>
								</>
							) : (
								'Advisory Notes'
							)}
						</Label>
					</div>
					<TemplateSelector
						corporationId={application.corporationId}
						onSelectTemplate={handleSelectTemplate}
					/>
					<Textarea
						id="review-notes"
						placeholder={
							userRole === 'hr_admin'
								? 'Add notes about this application (required for accept/reject, minimum 10 characters)...'
								: 'Add advisory notes for other reviewers...'
						}
						value={reviewNotes}
						onChange={(e) => {
							setReviewNotes(e.target.value)
							setReviewNotesError('')
						}}
						disabled={disabled || updateStatusMutation.isPending}
						rows={4}
						className={cn('resize-y', reviewNotesError && 'border-destructive')}
					/>
					{reviewNotesError && (
						<p className="text-sm text-destructive flex items-center gap-1">
							<AlertCircle className="h-3.5 w-3.5" />
							{reviewNotesError}
						</p>
					)}
					<p className="text-xs text-muted-foreground">
						{userRole === 'hr_admin'
							? 'These notes will be visible to the applicant. Required when accepting or rejecting.'
							: 'Advisory notes are for internal HR use and are not shown to applicants.'}
					</p>
				</div>

				{/* Action Buttons */}
				<div className="flex flex-col sm:flex-row gap-2">
					{/* Mark Under Review - Available to Reviewers and Admins */}
					{canMarkUnderReview && application.status === 'pending' && (
						<Button
							variant="primary"
							onClick={handleMarkUnderReview}
							disabled={disabled || updateStatusMutation.isPending}
							className="flex-1"
						>
							<Search className="h-4 w-4 mr-1" />
							Mark Under Review
						</Button>
					)}

					{/* Accept - Admin Only */}
					{canAccept && (
						<Button variant="confirm"
							onClick={handleAcceptClick}
							disabled={
								disabled ||
								updateStatusMutation.isPending ||
								!['pending', 'under_review'].includes(application.status)
							}
							className="flex-1"
						>
							Accept Application
						</Button>
					)}

					{/* Complete - Available from active states */}
					{canComplete && (
						<Button
							variant="confirm"
							showIcon={false}
							onClick={handleCompleteClick}
							disabled={
								disabled ||
								updateStatusMutation.isPending ||
								!['pending', 'under_review', 'accepted'].includes(application.status)
							}
							className="flex-1"
						>
							<CheckCircle2 className="h-4 w-4 mr-1" />
							Mark Completed
						</Button>
					)}

					{/* Reject - Admin Only */}
					{canReject && (
						<Button variant="destructive"
							onClick={handleRejectClick}
							disabled={disabled || updateStatusMutation.isPending}
							className="flex-1"
						>
							Reject Application
						</Button>
					)}
				</div>

				{/* Role Information */}
				<div className="pt-4 border-t">
					<p className="text-xs text-muted-foreground">
						<strong>Your Role:</strong> {userRole === 'hr_admin' ? 'HR Admin' : 'HR Reviewer'}
						{userRole === 'hr_reviewer' && (
							<span className="block mt-1">
								Note: Only HR Admins can accept or reject applications.
							</span>
						)}
					</p>
				</div>
			</CardContent>

			{/* Accept Confirmation Dialog */}
			<Dialog open={showAcceptDialog} onOpenChange={setShowAcceptDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Accept Application?</DialogTitle>
						<DialogDescription>
							Are you sure you want to accept the application from{' '}
							<strong>{application.characterName}</strong>? This will notify the applicant and they
							can proceed with joining the corporation.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="ghost"
							onClick={() => setShowAcceptDialog(false)}
							disabled={updateStatusMutation.isPending}
						>
							Cancel
						</Button>
						<Button variant="confirm"
							onClick={handleAcceptConfirm}
							loading={updateStatusMutation.isPending}
							loadingText="Accepting..."
						>
							Accept Application
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Reject Confirmation Dialog */}
			<Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Reject Application?</DialogTitle>
						<DialogDescription>
							Are you sure you want to reject the application from{' '}
							<strong>{application.characterName}</strong>? The applicant will be notified with your
							review notes.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="ghost"
							onClick={() => {
								setShowRejectDialog(false)
								setReviewNotes('')
								setReviewNotesError('')
							}}
							disabled={updateStatusMutation.isPending}
						>
							Cancel
						</Button>
						<Button variant="destructive"
							onClick={handleRejectConfirm}
							loading={updateStatusMutation.isPending}
							loadingText="Rejecting..."
						>
							Reject Application
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Complete Confirmation Dialog */}
			<Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Mark Application Completed?</DialogTitle>
						<DialogDescription>
							Are you sure you want to mark the accepted application from{' '}
							<strong>{application.characterName}</strong> as completed?
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="ghost"
							onClick={() => setShowCompleteDialog(false)}
							disabled={updateStatusMutation.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="confirm"
							onClick={handleCompleteConfirm}
							loading={updateStatusMutation.isPending}
							loadingText="Completing..."
						>
							Mark Completed
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Template overwrite confirmation */}
			<ConfirmationDialog
				open={pendingTemplate !== null}
				title="Replace review notes?"
				description="Your current review notes will be replaced with the template content. This cannot be undone."
				confirmLabel="Replace"
				intent="secondary"
				onCancel={() => setPendingTemplate(null)}
				onConfirm={handleConfirmTemplate}
			/>
		</Card>
	)
}
