import { AlertCircle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Trans } from 'react-i18next'
import { Link } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import {
	useDirectors,
	useRemoveDirector,
	useUpdateDirectorPriority,
	useVerifyAllDirectors,
	useVerifyDirector,
} from '@/hooks/useCorporations'
import { formatDateTime, formatNumber, useAppTranslation } from '@/i18n'

import { AddDirectorDialog } from './AddDirectorDialog'
import { DirectorHealthBadge } from './DirectorHealthBadge'

import type { FormEvent } from 'react'

interface DirectorListProps {
	corporationId: string
}

export function DirectorList({ corporationId }: DirectorListProps) {
	const { t } = useAppTranslation()
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
			totalCount: directors.length,
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

	const handleUpdatePriority = async (e: FormEvent) => {
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

	const openPriorityDialog = (
		characterId: string,
		characterName: string,
		currentPriority: number
	) => {
		setSelectedDirector({ characterId, characterName, currentPriority })
		setNewPriority(currentPriority)
		setPriorityDialogOpen(true)
	}

	const formatDate = (date: string | null) => {
		if (!date) return t('admin.users.account.never')
		return formatDateTime(date)
	}

	if (isLoading) {
		return (
			<div className="text-sm text-muted-foreground">
				{t('admin.organizations.directors.loading')}
			</div>
		)
	}

	if (error) {
		return (
			<div className="flex items-center gap-2 text-sm text-destructive">
				<AlertCircle className="h-4 w-4" />
				<span>{t('admin.organizations.directors.loadError')}</span>
			</div>
		)
	}

	return (
		<div className="space-y-4">
			{/* Header with actions */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<h3 className="text-sm font-medium">
						{t('admin.organizations.directors.count', { healthy: healthyCount, total: totalCount })}
					</h3>
					{totalCount > 0 && healthyCount === 0 && (
						<Badge variant="destructive" className="gap-1">
							<AlertCircle className="h-3 w-3" />
							{t('admin.organizations.directors.allUnhealthy')}
						</Badge>
					)}
				</div>
				<div className="flex gap-2">
					{totalCount > 0 && (
						<Button
							variant="ghost"
							size="sm"
							onClick={handleVerifyAll}
							disabled={verifyAllDirectors.isPending}
						>
							<RefreshCw
								className={`h-4 w-4 ${verifyAllDirectors.isPending ? 'animate-spin' : ''}`}
							/>
							{t('admin.organizations.directors.verifyAll')}
						</Button>
					)}
					<Button variant="primary" size="sm" onClick={() => setAddDialogOpen(true)}>
						<Plus className="h-4 w-4" />
						{t('admin.organizations.directors.add')}
					</Button>
				</div>
			</div>

			{/* Directors table or empty state */}
			{!directors || directors.length === 0 ? (
				<div className="rounded-lg border border-dashed p-8 text-center">
					<p className="text-sm text-muted-foreground mb-4">
						{t('admin.organizations.directors.empty')}
					</p>
					<Button variant="ghost" onClick={() => setAddDialogOpen(true)}>
						<Plus className="h-4 w-4" />
						{t('admin.organizations.directors.addFirst')}
					</Button>
				</div>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t('admin.users.account.character')}</TableHead>
								<TableHead>{t('admin.organizations.shared.priority')}</TableHead>
								<TableHead>{t('admin.users.account.status')}</TableHead>
								<TableHead>{t('admin.organizations.directors.lastUsed')}</TableHead>
								<TableHead>{t('admin.organizations.directors.lastChecked')}</TableHead>
								<TableHead className="text-right">{t('admin.fields.actions')}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{directors.map((director) => (
								<TableRow key={director.directorId}>
									<TableCell>
										<div>
											<div className="font-medium">
												{director.userId ? (
													<Link
														to={`/admin/users/${director.userId}`}
														className="text-primary hover:underline"
													>
														{director.characterName}
													</Link>
												) : (
													director.characterName
												)}
											</div>
											<div className="text-xs text-muted-foreground">
												{t('admin.organizations.shared.id', { id: director.characterId })}
											</div>
										</div>
									</TableCell>
									<TableCell>
										<Button
											variant="ghost"
											size="sm"
											className="h-7 px-2"
											onClick={() =>
												openPriorityDialog(
													director.characterId,
													director.characterName,
													director.priority
												)
											}
										>
											{formatNumber(director.priority)}
										</Button>
									</TableCell>
									<TableCell>
										<DirectorHealthBadge director={director} />
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
												title={t('admin.organizations.directors.verifyHealth')}
											>
												<RefreshCw className="h-4 w-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() =>
													openRemoveDialog(director.characterId, director.characterName)
												}
												disabled={removeDirector.isPending}
												title={t('admin.organizations.directors.remove')}
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
						<DialogTitle>{t('admin.organizations.directors.remove')}</DialogTitle>
						<DialogDescription>
							<Trans
								i18nKey="admin.organizations.directors.removeWarning"
								values={{ name: selectedDirector?.characterName }}
								components={{ name: <strong /> }}
							/>
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setRemoveDialogOpen(false)}>
							{t('common.cancel')}
						</Button>
						<Button
							variant="destructive"
							onClick={handleRemove}
							loading={removeDirector.isPending}
							loadingText={t('admin.users.account.removing')}
						>
							{t('admin.organizations.directors.remove')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Update Priority Dialog */}
			<Dialog open={priorityDialogOpen} onOpenChange={setPriorityDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.organizations.directors.updatePriority')}</DialogTitle>
						<DialogDescription>
							<Trans
								i18nKey="admin.organizations.directors.priorityDescription"
								values={{ name: selectedDirector?.characterName }}
								components={{ name: <strong /> }}
							/>
						</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleUpdatePriority}>
						<div className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="priority">{t('admin.organizations.shared.priority')}</Label>
								<Input
									id="priority"
									type="number"
									value={newPriority}
									onChange={(e) => {
										const value = Number.parseInt(e.target.value)
										setNewPriority(Number.isNaN(value) ? 100 : value)
									}}
									placeholder={t('admin.organizations.directors.priorityExample')}
								/>
								<p className="text-xs text-muted-foreground">
									{t('admin.organizations.directors.currentPriority', {
										priority: selectedDirector?.currentPriority,
									})}
								</p>
							</div>
						</div>
						<DialogFooter className="mt-6">
							<Button variant="cancel" type="button" onClick={() => setPriorityDialogOpen(false)}>
								{t('common.cancel')}
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={updatePriority.isPending}
								loadingText={t('hr.notes.updating')}
							>
								{t('admin.organizations.directors.updatePriority')}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	)
}
