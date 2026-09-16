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
import { useAppTranslation } from '@/i18n'
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
	const { t } = useAppTranslation()

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
	const roleValue: string | null = userRole
	const isViewer = roleValue === 'hr_viewer'

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
			setReviewNotesError(t('hrpages.reviewNotesAreRequiredWhenAcceptingOrRejectingAnApplication'))
			return false
		}
		if (reviewNotes.trim().length < 10) {
			setReviewNotesError(t('hrpages.reviewNotesMustBeAtLeast10Characters'))
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

			showSuccess(t('hrpages.applicationMarkedAsUnderReview'))
			setReviewNotes('')
			setReviewNotesError('')

			if (onStatusChange) {
				onStatusChange('under_review', reviewNotes || undefined)
			}
		} catch (error) {
			showError(
				error instanceof Error ? error.message : t('hrpages.failedToUpdateApplicationStatus')
			)
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

			showSuccess(t('hrpages.applicationAccepted'))
			setShowAcceptDialog(false)
			setReviewNotes('')
			setReviewNotesError('')

			if (onStatusChange) {
				onStatusChange('accepted', reviewNotes)
			}
		} catch (error) {
			showError(error instanceof Error ? error.message : t('hrpages.failedToAcceptApplication'))
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

			showSuccess(t('hrpages.applicationMarkedAsCompleted'))
			setShowCompleteDialog(false)
			setReviewNotes('')
			setReviewNotesError('')

			if (onStatusChange) {
				onStatusChange('completed', reviewNotes)
			}
		} catch (error) {
			showError(error instanceof Error ? error.message : t('hrpages.failedToCompleteApplication'))
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

			showSuccess(t('hrpages.applicationRejected'))
			setShowRejectDialog(false)
			setReviewNotes('')
			setReviewNotesError('')

			if (onStatusChange) {
				onStatusChange('rejected', reviewNotes)
			}
		} catch (error) {
			showError(error instanceof Error ? error.message : t('hrpages.failedToRejectApplication'))
		}
	}

	// No actions available
	if (!userRole || userRole === 'hr_viewer') {
		return (
			<Card className={cn('border-muted', className)}>
				<CardHeader>
					<CardTitle>{t('hrpages.hrActions')}</CardTitle>
					<CardDescription>{t('hrpages.readOnlyAccessNoActionsAvailable')}</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						{t('hrpages.youHaveViewOnlyAccessToApplicationsContactAnHr')}
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
					<CardTitle>{t('hrpages.hrActions')}</CardTitle>
					<CardDescription>{t('hrpages.applicationIsNoLongerActive')}</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						{t('hrpages.thisApplicationHasAlreadyBeenProcessedAndCannotBeModified')}
					</p>
				</CardContent>
			</Card>
		)
	}

	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle>{t('hrpages.hrActions')}</CardTitle>
				<CardDescription>
					{userRole === 'hr_admin'
						? t('hrpages.acceptRejectOrMarkThisApplicationForReview')
						: t('hrpages.markThisApplicationForReviewAndAddAdvisoryNotes')}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Review Notes Textarea */}
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<Label htmlFor="review-notes">
							{userRole === 'hr_admin' ? (
								<>
									{t('hrpages.reviewNotes')}
									<span className="text-destructive">*</span>
								</>
							) : (
								t('hrpages.advisoryNotes')
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
								? t('hrpages.addNotesAboutThisApplicationRequiredForAcceptRejectMinimum')
								: t('hrpages.addAdvisoryNotesForOtherReviewers')
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
							? t('hrpages.theseNotesWillBeVisibleToTheApplicantRequiredWhen')
							: t('hrpages.advisoryNotesAreForInternalHrUseAndAreNot')}
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
							{t('hrpages.markUnderReview')}
						</Button>
					)}

					{/* Accept - Reviewer or Admin */}
					{canAccept && (
						<Button
							variant="confirm"
							onClick={handleAcceptClick}
							disabled={
								disabled ||
								updateStatusMutation.isPending ||
								!['pending', 'under_review'].includes(application.status)
							}
							className="flex-1"
						>
							{t('hrpages.acceptApplication')}
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
							{t('hrpages.markCompleted')}
						</Button>
					)}

					{/* Reject - Reviewer or Admin */}
					{canReject && (
						<Button
							variant="destructive"
							onClick={handleRejectClick}
							disabled={disabled || updateStatusMutation.isPending}
							className="flex-1"
						>
							{t('hrpages.rejectApplication')}
						</Button>
					)}
				</div>

				{/* Role Information */}
				<div className="pt-4 border-t">
					<p className="text-xs text-muted-foreground">
						<strong>{t('hrpages.yourRole')}</strong>{' '}
						{userRole === 'hr_admin'
							? t('hrpages.hrAdmin')
							: isViewer
								? t('hrpages.hrViewer')
								: t('hrpages.hrReviewer')}
						{isViewer && (
							<span className="block mt-1">
								{t('hrpages.onlyHrReviewersAndHrAdminsCanChangeApplicationStatuses')}
							</span>
						)}
					</p>
				</div>
			</CardContent>

			{/* Accept Confirmation Dialog */}
			<Dialog open={showAcceptDialog} onOpenChange={setShowAcceptDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('hrpages.acceptApplication2')}</DialogTitle>
						<DialogDescription>
							{t('hrpages.areYouSureYouWantToAcceptTheApplicationFrom')}{' '}
							<strong>{application.characterName}</strong>
							{t('hrpages.thisWillNotifyTheApplicantAndTheyCanProceedWith')}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="ghost"
							onClick={() => setShowAcceptDialog(false)}
							disabled={updateStatusMutation.isPending}
						>
							{t('hrpages.cancel')}
						</Button>
						<Button
							variant="confirm"
							onClick={handleAcceptConfirm}
							loading={updateStatusMutation.isPending}
							loadingText={t('hrpages.accepting')}
						>
							{t('hrpages.acceptApplication')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Reject Confirmation Dialog */}
			<Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('hrpages.rejectApplication2')}</DialogTitle>
						<DialogDescription>
							{t('hrpages.areYouSureYouWantToRejectTheApplicationFrom')}{' '}
							<strong>{application.characterName}</strong>
							{t('hrpages.theApplicantWillBeNotifiedWithYourReviewNotes')}
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
							{t('hrpages.cancel')}
						</Button>
						<Button
							variant="destructive"
							onClick={handleRejectConfirm}
							loading={updateStatusMutation.isPending}
							loadingText={t('hrpages.rejecting')}
						>
							{t('hrpages.rejectApplication')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Complete Confirmation Dialog */}
			<Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('hrpages.markApplicationCompleted')}</DialogTitle>
						<DialogDescription>
							{t('hrpages.areYouSureYouWantToMarkTheAcceptedApplication')}{' '}
							<strong>{application.characterName}</strong>
							{t('hrpages.asCompleted')}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="ghost"
							onClick={() => setShowCompleteDialog(false)}
							disabled={updateStatusMutation.isPending}
						>
							{t('hrpages.cancel')}
						</Button>
						<Button
							variant="confirm"
							onClick={handleCompleteConfirm}
							loading={updateStatusMutation.isPending}
							loadingText={t('hrpages.completing')}
						>
							{t('hrpages.markCompleted')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Template overwrite confirmation */}
			<ConfirmationDialog
				open={pendingTemplate !== null}
				title={t('hrpages.replaceReviewNotes')}
				description={t('hrpages.yourCurrentReviewNotesWillBeReplacedWithTheTemplate')}
				confirmLabel={t('hrpages.replace')}
				intent="secondary"
				onCancel={() => setPendingTemplate(null)}
				onConfirm={handleConfirmTemplate}
			/>
		</Card>
	)
}
