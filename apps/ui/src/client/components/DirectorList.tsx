import { useState, useMemo } from 'react'
import { AlertCircle, CheckCircle2, Plus, Trash2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { AddDirectorDialog } from './AddDirectorDialog'
import { DirectorStatusBadge } from './DirectorStatusBadge'
import {
	useDirectors,
	useRemoveDirector,
	useUpdateDirectorPriority,
	useVerifyDirector,
	useVerifyAllDirectors,
} from '@/hooks/useCorporations'

interface DirectorListProps {
	corporationId: string
}

export function DirectorList({ corporationId }: DirectorListProps) {
	const [addDialogOpen, setAddDialogOpen] = useState(false)
	const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
	const [priorityDialogOpen, setPriorityDialogOpen] = useState(false)
	const [selectedDirector, setSelectedDirector] = useState<{
		characterId: string
		characterName: string
		currentPriority: number
	} | null>(null)
	const [newPriority, setNewPriority] = useState(100)

	const { data: directors, isLoading, error } = useDirectors(corporationId)
	const removeDirector = useRemoveDirector()
	const updatePriority = useUpdateDirectorPriority()
	const verifyDirector = useVerifyDirector()
	const verifyAllDirectors = useVerifyAllDirectors()

	// CRITICAL FIX: Move useMemo BEFORE early returns to ensure consistent hook count
	const { healthyCount, totalCount } = useMemo(() => {
		if (!directors) return { healthyCount: 0, totalCount: 0 }
		return {
			healthyCount: directors.filter((d) => d.isHealthy).length,
			totalCount: directors.length
		}
	}, [directors])

	const handleRemove = async () => {
		if (!selectedDirector) return

		await removeDirector.mutateAsync({
			corporationId,
			characterId: selectedDirector.characterId,
		})

		setRemoveDialogOpen(false)
		setSelectedDirector(null)
	}

	const handleUpdatePriority = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!selectedDirector) return

		await updatePriority.mutateAsync({
			corporationId,
			characterId: selectedDirector.characterId,
			data: { priority: newPriority },
		})

		setPriorityDialogOpen(false)
		setSelectedDirector(null)
		setNewPriority(100)
	}

	const handleVerify = async (directorId: string) => {
		await verifyDirector.mutateAsync({ corporationId, directorId })
	}

	const handleVerifyAll = async () => {
		await verifyAllDirectors.mutateAsync(corporationId)
	}

	const openRemoveDialog = (characterId: string, characterName: string) => {
		setSelectedDirector({ characterId, characterName, currentPriority: 0 })
		setRemoveDialogOpen(true)
	}

	const openPriorityDialog = (characterId: string, characterName: string, currentPriority: number) => {
		setSelectedDirector({ characterId, characterName, currentPriority })
		setNewPriority(currentPriority)
		setPriorityDialogOpen(true)
	}

	const formatDate = (date: string | null) => {
		if (!date) return 'Never'
		return new Date(date).toLocaleString()
	}

	if (isLoading) {
		return <div className="text-sm text-muted-foreground">Loading directors...</div>
	}

	if (error) {
		return (
			<div className="flex items-center gap-2 text-sm text-destructive">
				<AlertCircle className="h-4 w-4" />
				<span>Failed to load directors</span>
			</div>
		)
	}

	return (
		<div className="space-y-4">
			{/* Header with actions */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<h3 className="text-sm font-medium">
						Directors ({healthyCount}/{totalCount} healthy)
					</h3>
					{totalCount > 0 && healthyCount === 0 && (
						<Badge variant="destructive" className="gap-1">
							<AlertCircle className="h-3 w-3" />
							All Directors Unhealthy
						</Badge>
					)}
				</div>
				<div className="flex gap-2">
					{totalCount > 0 && (
						<Button
							variant="outline"
							size="sm"
							onClick={handleVerifyAll}
							disabled={verifyAllDirectors.isPending}
						>
							<RefreshCw className={`mr-2 h-4 w-4 ${verifyAllDirectors.isPending ? 'animate-spin' : ''}`} />
							Verify All
						</Button>
					)}
					<Button variant="default" size="sm" onClick={() => setAddDialogOpen(true)}>
						<Plus className="mr-2 h-4 w-4" />
						Add Director
					</Button>
				</div>
			</div>

			{/* Directors table or empty state */}
			{!directors || directors.length === 0 ? (
				<div className="rounded-lg border border-dashed p-8 text-center">
					<p className="text-sm text-muted-foreground mb-4">
						No directors assigned. Add a director character to manage corporation data.
					</p>
					<Button variant="outline" onClick={() => setAddDialogOpen(true)}>
						<Plus className="mr-2 h-4 w-4" />
						Add First Director
					</Button>
				</div>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Character</TableHead>
								<TableHead>Priority</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Last Used</TableHead>
								<TableHead>Last Checked</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{directors.map((director) => (
								<TableRow key={director.directorId}>
									<TableCell>
										<div>
											<div className="font-medium">{director.characterName}</div>
											<div className="text-xs text-muted-foreground">ID: {director.characterId}</div>
										</div>
									</TableCell>
									<TableCell>
										<Button
											variant="ghost"
											size="sm"
											className="h-7 px-2"
											onClick={() =>
												openPriorityDialog(director.characterId, director.characterName, director.priority)
											}
										>
											{director.priority}
										</Button>
									</TableCell>
									<TableCell>
										<DirectorStatusBadge director={director} />
									</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{formatDate(director.lastUsed)}
									</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{formatDate(director.lastHealthCheck)}
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => handleVerify(director.directorId)}
												disabled={verifyDirector.isPending}
												title="Verify health"
											>
												<RefreshCw className="h-4 w-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => openRemoveDialog(director.characterId, director.characterName)}
												disabled={removeDirector.isPending}
												title="Remove director"
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			{/* Add Director Dialog */}
			<AddDirectorDialog
				corporationId={corporationId}
				open={addDialogOpen}
				onOpenChange={setAddDialogOpen}
			/>

			{/* Remove Director Dialog */}
			<Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove Director</DialogTitle>
						<DialogDescription>
							Are you sure you want to remove <strong>{selectedDirector?.characterName}</strong> as a
							director? This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setRemoveDialogOpen(false)}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleRemove} disabled={removeDirector.isPending}>
							{removeDirector.isPending ? 'Removing...' : 'Remove Director'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Update Priority Dialog */}
			<Dialog open={priorityDialogOpen} onOpenChange={setPriorityDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Update Priority</DialogTitle>
						<DialogDescription>
							Change the priority for <strong>{selectedDirector?.characterName}</strong>. Lower values
							have higher priority.
						</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleUpdatePriority}>
						<div className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="priority">Priority</Label>
								<Input
									id="priority"
									type="number"
									value={newPriority}
									onChange={(e) => {
										const value = Number.parseInt(e.target.value)
										setNewPriority(Number.isNaN(value) ? 100 : value)
									}}
									placeholder="e.g., 100"
								/>
								<p className="text-xs text-muted-foreground">
									Current priority: {selectedDirector?.currentPriority}
								</p>
							</div>
						</div>
						<DialogFooter className="mt-6">
							<Button type="button" variant="ghost" onClick={() => setPriorityDialogOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={updatePriority.isPending}>
								{updatePriority.isPending ? 'Updating...' : 'Update Priority'}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	)
}
