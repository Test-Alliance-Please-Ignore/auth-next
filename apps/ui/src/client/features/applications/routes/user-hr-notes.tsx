/**
 * User HR Notes Page
 *
 * Full page view for viewing and managing HR notes about a specific user.
 * ADMIN ONLY - Requires user.is_admin === true
 */

import { AlertCircle, ArrowLeft, Lock } from 'lucide-react'
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
import { LoadingSpinner } from '@/components/ui/loading'
import { MemberAvatar } from '@/components/member-avatar'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'

import { AddHRNoteDialog } from '../components/add-hr-note-dialog'
import { DeleteHRNoteDialog } from '../components/delete-hr-note-dialog'
import { HRNotesList } from '../components/hr-notes-list'
import { useHRNote, useHRNotes } from '../hooks'

import type { HRNote } from '../api'

// ============================================================================
// Component
// ============================================================================

/**
 * User HR Notes page with full admin controls
 *
 * Route: /admin/users/:userId/hr-notes (or similar)
 */
export default function UserHrNotes() {
	const { userId } = useParams<{ userId: string }>()
	const navigate = useNavigate()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()

	// Dialog state
	const [addDialogOpen, setAddDialogOpen] = useState(false)
	const [editDialogOpen, setEditDialogOpen] = useState(false)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)

	// Fetch notes to get character name
	const { data: notes, isLoading: notesLoading } = useHRNotes(
		userId ? { subjectUserId: userId, limit: 1 } : undefined
	)

	// Fetch selected note for edit/delete
	const { data: selectedNote } = useHRNote(selectedNoteId)

	// Get character name from first note or fallback
	const subjectCharacterName = notes?.[0]?.subjectCharacterName

	// Set page title
	usePageTitle(
		subjectCharacterName
			? `HR Notes - ${subjectCharacterName}`
			: 'HR Notes'
	)

	// Handlers
	const handleBackClick = () => {
		navigate('/admin/users') // Adjust based on your admin routes
	}

	const handleAddNote = () => {
		setAddDialogOpen(true)
	}

	const handleEditNote = (noteId: string) => {
		setSelectedNoteId(noteId)
		setEditDialogOpen(true)
	}

	const handleDeleteNote = (noteId: string) => {
		setSelectedNoteId(noteId)
		setDeleteDialogOpen(true)
	}

	const handleDialogSuccess = () => {
		setSelectedNoteId(null)
		// Refetch is handled by React Query cache invalidation
	}

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Check admin access
	if (!authLoading && !user?.is_admin) {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">
							Access Denied
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							You must be a site administrator to view HR notes.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="outline" onClick={() => navigate('/')}>
							Back to Home
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	// Check required params
	if (!userId) {
		return <Navigate to="/admin/users" replace />
	}

	// Loading state
	if (authLoading || notesLoading) {
		return (
			<div className="container mx-auto max-w-5xl px-4 py-8">
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</div>
		)
	}

	// Main content
	return (
		<div className="container mx-auto max-w-5xl px-4 py-8">
			{/* Breadcrumb Navigation */}
			<Breadcrumb className="mb-6">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink to="/admin">Admin</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbLink to="/admin/users">Users</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>
							{subjectCharacterName || 'HR Notes'}
						</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			{/* Header Card */}
			<Card className="mb-6 border-warning/30 bg-warning/5">
				<CardContent className="pt-6">
					<div className="flex items-start gap-4">
						{/* Character Portrait */}
						{notes?.[0] && (
							<MemberAvatar
								characterId={notes[0].subjectCharacterId || ''}
								characterName={notes[0].subjectCharacterName || ''}
								size="lg"
							/>
						)}

						{/* Header Info */}
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2 text-warning mb-2">
								<Lock className="h-4 w-4" />
								<span className="text-xs font-semibold uppercase tracking-wide">
									Admin Only
								</span>
							</div>
							<h1 className="text-2xl font-bold text-foreground mb-1">
								{subjectCharacterName || 'User HR Notes'}
							</h1>
							<p className="text-sm text-muted-foreground">
								Private internal notes visible only to site administrators
							</p>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* HR Notes List */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Lock className="h-5 w-5 text-warning" />
						HR Notes
					</CardTitle>
					<CardDescription>
						Internal administrative notes about this user
					</CardDescription>
				</CardHeader>
				<CardContent>
					<HRNotesList
						subjectUserId={userId}
						subjectCharacterName={subjectCharacterName}
						onAddNote={handleAddNote}
						onEditNote={handleEditNote}
						onDeleteNote={handleDeleteNote}
					/>
				</CardContent>
			</Card>

			{/* Back Button */}
			<div className="mt-8">
				<Button variant="outline" onClick={handleBackClick}>
					<ArrowLeft className="mr-2 h-4 w-4" />
					Back to Users
				</Button>
			</div>

			{/* Dialogs */}
			<AddHRNoteDialog
				open={addDialogOpen}
				onOpenChange={setAddDialogOpen}
				subjectUserId={userId}
				subjectCharacterId={notes?.[0]?.subjectCharacterId}
				subjectCharacterName={subjectCharacterName}
				onSuccess={handleDialogSuccess}
			/>

			<AddHRNoteDialog
				open={editDialogOpen}
				onOpenChange={setEditDialogOpen}
				subjectUserId={userId}
				subjectCharacterId={selectedNote?.subjectCharacterId}
				subjectCharacterName={selectedNote?.subjectCharacterName}
				existingNote={selectedNote}
				onSuccess={handleDialogSuccess}
			/>

			<DeleteHRNoteDialog
				open={deleteDialogOpen}
				onOpenChange={setDeleteDialogOpen}
				note={selectedNote || null}
				onSuccess={handleDialogSuccess}
			/>
		</div>
	)
}
