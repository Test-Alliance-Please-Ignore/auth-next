/**
 * Application Action Panel Component
 *
 * Action controls for HR staff to accept/reject/review applications.
 * Different actions available based on HR role (Admin, Reviewer, Viewer).
 */

import { AlertCircle } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { DestructiveButton } from '@/components/ui/destructive-button'
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

import type { Application, ApplicationStatus } from '../api'
import type { HrRoleType } from '../../hr/api'

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
	const [showAcceptDialog, setShowAcceptDialog] = useState(false)
	const [showRejectDialog, setShowRejectDialog] = useState(false)
	const [rejectNotes, setRejectNotes] = useState('')
	const [rejectNotesError, setRejectNotesError] = useState('')

	// Check if application can be reviewed
	const canReview = canReviewApplication(application)

	// Determine available actions based on role
	const canMarkUnderReview = userRole && ['hr_admin', 'hr_reviewer'].includes(userRole)
	const canAccept = userRole === 'hr_admin'
	const canReject = userRole === 'hr_admin'

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

			if (onStatusChange) {
				onStatusChange('under_review', reviewNotes || undefined)
			}
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update application status')
		}
	}

	// Handler for accepting application
	const handleAcceptClick = () => {
		setShowAcceptDialog(true)
	}

	const handleAcceptConfirm = async () => {
		try {
			await updateStatusMutation.mutateAsync({
				applicationId: application.id,
				data: {
					status: 'accepted',
					reviewNotes: reviewNotes || undefined,
				},
			})

			showSuccess('Application accepted')
			setShowAcceptDialog(false)
			setReviewNotes('')

			if (onStatusChange) {
				onStatusChange('accepted', reviewNotes || undefined)
			}
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to accept application')
		}
	}

	// Handler for rejecting application
	const handleRejectClick = () => {
		setRejectNotes('')
		setRejectNotesError('')
		setShowRejectDialog(true)
	}

	const handleRejectConfirm = async () => {
		// Validate rejection notes
		if (!rejectNotes.trim()) {
			setRejectNotesError('Review notes are required when rejecting an application')
			return
		}

		if (rejectNotes.trim().length < 10) {
			setRejectNotesError('Review notes must be at least 10 characters')
			return
		}

		try {
			await updateStatusMutation.mutateAsync({
				applicationId: application.id,
				data: {
					status: 'rejected',
					reviewNotes: rejectNotes,
				},
			})

			showSuccess('Application rejected')
			setShowRejectDialog(false)
			setRejectNotes('')
			setRejectNotesError('')

			if (onStatusChange) {
				onStatusChange('rejected', rejectNotes)
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

	// Application cannot be reviewed (already accepted/rejected/withdrawn)
	if (!canReview) {
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
					<Label htmlFor="review-notes">
						{userRole === 'hr_admin' ? 'Review Notes (Optional)' : 'Advisory Notes'}
					</Label>
					<Textarea
						id="review-notes"
						placeholder={
							userRole === 'hr_admin'
								? 'Add notes about this application (optional for accept, required for reject)...'
								: 'Add advisory notes for other reviewers...'
						}
						value={reviewNotes}
						onChange={(e) => setReviewNotes(e.target.value)}
						disabled={disabled || updateStatusMutation.isPending}
						rows={4}
						className="resize-none"
					/>
					<p className="text-xs text-muted-foreground">
						{userRole === 'hr_admin'
							? 'These notes will be visible to the applicant if the application is accepted or rejected.'
							: 'Advisory notes are for internal HR use and are not shown to applicants.'}
					</p>
				</div>

				{/* Action Buttons */}
				<div className="flex flex-col sm:flex-row gap-2">
					{/* Mark Under Review - Available to Reviewers and Admins */}
					{canMarkUnderReview && application.status === 'pending' && (
						<Button
							variant="outline"
							onClick={handleMarkUnderReview}
							disabled={disabled || updateStatusMutation.isPending}
							className="flex-1"
						>
							Mark Under Review
						</Button>
					)}

					{/* Accept - Admin Only */}
					{canAccept && (
						<ConfirmButton
							onClick={handleAcceptClick}
							disabled={disabled || updateStatusMutation.isPending}
							className="flex-1"
						>
							Accept Application
						</ConfirmButton>
					)}

					{/* Reject - Admin Only */}
					{canReject && (
						<DestructiveButton
							onClick={handleRejectClick}
							disabled={disabled || updateStatusMutation.isPending}
							className="flex-1"
						>
							Reject Application
						</DestructiveButton>
					)}
				</div>

				{/* Role Information */}
				<div className="pt-4 border-t">
					<p className="text-xs text-muted-foreground">
						<strong>Your Role:</strong>{' '}
						{userRole === 'hr_admin' ? 'HR Admin' : 'HR Reviewer'}
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
							<strong>{application.characterName}</strong>? This will notify the applicant
							and they can proceed with joining the corporation.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setShowAcceptDialog(false)}
							disabled={updateStatusMutation.isPending}
						>
							Cancel
						</Button>
						<ConfirmButton
							onClick={handleAcceptConfirm}
							loading={updateStatusMutation.isPending}
							loadingText="Accepting..."
						>
							Accept Application
						</ConfirmButton>
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
							<strong>{application.characterName}</strong>? You must provide review notes
							explaining the reason for rejection.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-2 py-4">
						<Label htmlFor="reject-notes">
							Review Notes <span className="text-destructive">*</span>
						</Label>
						<Textarea
							id="reject-notes"
							placeholder="Explain the reason for rejection (minimum 10 characters)..."
							value={rejectNotes}
							onChange={(e) => {
								setRejectNotes(e.target.value)
								setRejectNotesError('')
							}}
							disabled={updateStatusMutation.isPending}
							rows={4}
							className={cn('resize-none', rejectNotesError && 'border-destructive')}
						/>
						{rejectNotesError && (
							<p className="text-sm text-destructive flex items-center gap-1">
								<AlertCircle className="h-3.5 w-3.5" />
								{rejectNotesError}
							</p>
						)}
						<p className="text-xs text-muted-foreground">
							These notes will be shared with the applicant.
						</p>
					</div>

					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setShowRejectDialog(false)
								setRejectNotes('')
								setRejectNotesError('')
							}}
							disabled={updateStatusMutation.isPending}
						>
							Cancel
						</Button>
						<DestructiveButton
							onClick={handleRejectConfirm}
							loading={updateStatusMutation.isPending}
							loadingText="Rejecting..."
						>
							Reject Application
						</DestructiveButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	)
}
