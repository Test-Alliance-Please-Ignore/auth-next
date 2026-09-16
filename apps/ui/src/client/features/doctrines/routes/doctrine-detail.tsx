/**
 * Doctrine Detail Page
 *
 * View a single doctrine with its fittings grouped by category
 */

import { ArrowLeft, ChevronDown, ChevronRight, Edit, Plus, Settings, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { i18n, useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import { AddFittingDialog } from '../components/AddFittingDialog'
import { EditDoctrineFittingDialog } from '../components/EditDoctrineFittingDialog'
import { FittingCard } from '../components/FittingCard'
import {
	useDeleteDoctrine,
	useDoctrine,
	useDoctrineCategories,
	useRemoveDoctrineStagingSystem,
	useRemoveFittingFromDoctrine,
	useSetDoctrineStagingSystem,
	useStagingSystems,
} from '../hooks'

import type { DoctrineCategory, DoctrineFittingEntry, DoctrineStagingEntry } from '../types'

/** Group fitting entries by category, sorted by category sortOrder then fittings by sortOrder */
function groupFittingsByCategory(
	entries: DoctrineFittingEntry[],
	categories: DoctrineCategory[]
): Array<{ category: string; entries: DoctrineFittingEntry[] }> {
	const map = new Map<string, DoctrineFittingEntry[]>()
	for (const entry of entries) {
		const fc = entry.fittingCategory
		const key =
			(fc && fc !== 'Uncategorized' ? fc : null) ||
			entry.fitting.category ||
			i18n.t('doctrines.uncategorized')
		const group = map.get(key)
		if (group) {
			group.push(entry)
		} else {
			map.set(key, [entry])
		}
	}
	// Sort entries within each group by sortOrder
	for (const group of map.values()) {
		group.sort((a, b) => a.sortOrder - b.sortOrder)
	}
	// Build sorted array using category sortOrder
	const categoryOrderMap = new Map(categories.map((c) => [c.name, c.sortOrder]))
	return Array.from(map.entries())
		.map(([category, entries]) => ({ category, entries }))
		.sort((a, b) => {
			const aOrder = categoryOrderMap.get(a.category) ?? Number.MAX_SAFE_INTEGER
			const bOrder = categoryOrderMap.get(b.category) ?? Number.MAX_SAFE_INTEGER
			return aOrder - bOrder
		})
}

/** Dialog to assign a staging system to a doctrine */
function StagingDialog({
	open,
	onOpenChange,
	doctrineId,
	existing,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	doctrineId: string
	existing?: DoctrineStagingEntry
}) {
	const { t } = useAppTranslation()

	const { data: allSystems } = useStagingSystems()
	const setMutation = useSetDoctrineStagingSystem()
	const [stagingSystemId, setStagingSystemId] = useState(existing?.stagingSystem.id || '')
	const [note, setNote] = useState(existing?.note || '')

	const isEdit = !!existing

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		try {
			await setMutation.mutateAsync({
				doctrineId,
				stagingSystemId: isEdit ? existing.stagingSystem.id : stagingSystemId,
				note: note || '',
			})
			toast.success(isEdit ? t('doctrines.stagingUpdated') : t('doctrines.stagingSystemAssigned'))
			onOpenChange(false)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('doctrines.failedToSave'))
		}
	}

	// Filter out already-assigned systems
	const availableOptions = (allSystems || []).map((s) => ({
		value: s.id,
		label: s.solarSystemName,
	}))

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>
							{isEdit
								? t('doctrines.editStagingValue1', {
										value1: existing.stagingSystem.solarSystemName,
									})
								: t('doctrines.assignStagingSystem')}
						</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 py-4">
						{!isEdit && (
							<div className="space-y-2">
								<Label>{t('doctrines.stagingSystem')}</Label>
								<Select
									options={availableOptions}
									value={stagingSystemId}
									onValueChange={(val) => setStagingSystemId(val)}
									placeholder={t('doctrines.selectASystem')}
								/>
							</div>
						)}
						<div className="space-y-2">
							<Label htmlFor="staging-note">{t('doctrines.note')}</Label>
							<Input
								id="staging-note"
								value={note}
								onChange={(e) => setNote(e.target.value)}
								placeholder={t('doctrines.eGXFirstSpareDeathClone')}
							/>
							<p className="text-sm text-muted-foreground">
								{t('doctrines.displayedInTheStagingMatrixLeaveBlankForNoNote')}
							</p>
						</div>
					</div>
					<DialogFooter>
						<Button variant="cancel" type="button" onClick={() => onOpenChange(false)}>
							{t('doctrines.cancel')}
						</Button>
						<Button
							variant="confirm"
							type="submit"
							loading={setMutation.isPending}
							loadingText={t('doctrines.saving')}
							disabled={!isEdit && !stagingSystemId}
						>
							{isEdit ? t('doctrines.update') : t('doctrines.assign')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

export default function DoctrineDetailPage() {
	const { t } = useAppTranslation()

	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const { hasPermission, isAdmin } = useUserPermissions()
	const { data: doctrine, isLoading, error } = useDoctrine(id)
	const { data: categories } = useDoctrineCategories()
	const deleteMutation = useDeleteDoctrine()
	const removeFittingMutation = useRemoveFittingFromDoctrine()
	const removeStagingMutation = useRemoveDoctrineStagingSystem()
	const [addFittingOpen, setAddFittingOpen] = useState(false)
	const [editingFittingEntry, setEditingFittingEntry] = useState<DoctrineFittingEntry | null>(null)
	const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())
	const [stagingDialogOpen, setStagingDialogOpen] = useState(false)
	const [editingStaging, setEditingStaging] = useState<DoctrineStagingEntry | undefined>()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	usePageTitle(doctrine?.name || t('doctrines.doctrineDetails'))

	const canManage = isAdmin || hasPermission('urn:doctrines:manager')

	const groupedFittings = useMemo(
		() => (doctrine ? groupFittingsByCategory(doctrine.fittings, categories || []) : []),
		[doctrine, categories, t]
	)

	const handleDelete = () => {
		if (!id) return
		requestConfirmation({
			title: t('doctrines.deleteDoctrine'),
			description: t('doctrines.areYouSureYouWantToDeleteThisDoctrineThis'),
			confirmLabel: t('doctrines.delete'),
			intent: 'destructive',
			onConfirm: async () => {
				await deleteMutation.mutateAsync(id)
				toast.success(t('doctrines.doctrineDeleted'))
				void navigate('/doctrines')
			},
		})
	}

	const handleRemoveFitting = (fittingId: string) => {
		if (!id) return
		requestConfirmation({
			title: t('doctrines.removeFitting'),
			description: t('doctrines.removeThisFittingFromTheDoctrineTheFittingItselfWill'),
			confirmLabel: t('doctrines.remove'),
			intent: 'destructive',
			onConfirm: async () => {
				await removeFittingMutation.mutateAsync({ doctrineId: id, fittingId })
				toast.success(t('doctrines.fittingRemoved'))
			},
		})
	}

	const handleRemoveStaging = (stagingSystemId: string) => {
		if (!id) return
		requestConfirmation({
			title: t('doctrines.removeStagingSystem'),
			description: t('doctrines.removeThisStagingSystemFromTheDoctrine'),
			confirmLabel: t('doctrines.remove'),
			intent: 'destructive',
			onConfirm: async () => {
				await removeStagingMutation.mutateAsync({ doctrineId: id, stagingSystemId })
				toast.success(t('doctrines.stagingSystemRemoved'))
			},
		})
	}

	const toggleCategory = (category: string) => {
		setCollapsedCategories((prev) => {
			const next = new Set(prev)
			if (next.has(category)) {
				next.delete(category)
			} else {
				next.add(category)
			}
			return next
		})
	}

	if (isLoading) {
		return (
			<Container>
				<LoadingSpinner />
			</Container>
		)
	}

	if (error || !doctrine) {
		return (
			<Container>
				<PageHeader title={t('doctrines.doctrineNotFound')} />
				<Card>
					<CardContent className="pt-6">
						<div className="text-center">
							<p className="text-muted-foreground mb-4">
								{t('doctrines.theDoctrineYouReLookingForDoesnTExistOr')}
							</p>
							<Button asChild variant="ghost">
								<Link to="/doctrines">
									<ArrowLeft className="h-4 w-4" />
									{t('doctrines.backToDoctrines')}
								</Link>
							</Button>
						</div>
					</CardContent>
				</Card>
			</Container>
		)
	}

	return (
		<Container>
			<Button asChild variant="ghost" size="sm" className="mb-4">
				<Link to="/doctrines">
					<ArrowLeft className="h-4 w-4" />
					{t('doctrines.backToDoctrines')}
				</Link>
			</Button>

			<PageHeader
				title={doctrine.name}
				action={
					<div className="flex gap-2">
						{canManage && (
							<>
								<Button onClick={() => navigate(`/doctrines/fittings/create?doctrineId=${id}`)}>
									<Plus className="h-4 w-4" />
									{t('doctrines.createFitting')}
								</Button>
								<Button variant="secondary" onClick={() => setAddFittingOpen(true)}>
									<Plus className="h-4 w-4" />
									{t('doctrines.linkExisting')}
								</Button>
								<Button asChild variant="ghost">
									<Link to={`/doctrines/${id}/edit`}>
										<Edit className="h-4 w-4" />
										{t('doctrines.edit')}
									</Link>
								</Button>
								<Button
									variant="destructive"
									onClick={handleDelete}
									loading={deleteMutation.isPending}
									loadingText={t('doctrines.deleting')}
								>
									<Trash2 className="h-4 w-4" />
									{t('doctrines.delete')}
								</Button>
							</>
						)}
					</div>
				}
			/>

			<div className="space-y-6">
				{/* Description, Category & Staging Systems */}
				<Card>
					<CardContent className="pt-6">
						<div className="space-y-3">
							{doctrine.description && (
								<div>
									<span className="text-sm text-muted-foreground">
										{t('doctrines.description2')}
									</span>
									<p className="text-sm text-foreground whitespace-pre-wrap mt-1">
										{doctrine.description}
									</p>
								</div>
							)}
							{doctrine.category && (
								<div className="flex items-center gap-2">
									<span className="text-sm text-muted-foreground">{t('doctrines.category3')}</span>
									<Badge variant="secondary">{doctrine.category.name}</Badge>
								</div>
							)}
							<div className="flex items-center gap-2 flex-wrap">
								<span className="text-sm text-muted-foreground">{t('doctrines.staging')}</span>
								{doctrine.stagingSystems && doctrine.stagingSystems.length > 0 ? (
									doctrine.stagingSystems.map((s) => (
										<Badge
											key={s.stagingSystem.id}
											variant="secondary"
											className="cursor-default group/staging"
										>
											{s.stagingSystem.solarSystemName}
											{s.note && ` — ${s.note}`}
											{canManage && (
												<>
													<button
														type="button"
														className="ml-1 opacity-0 group-hover/staging:opacity-100 transition-opacity"
														onClick={() => {
															setEditingStaging(s)
															setStagingDialogOpen(true)
														}}
													>
														<Edit className="h-3 w-3" />
													</button>
													<button
														type="button"
														className="ml-0.5 opacity-0 group-hover/staging:opacity-100 transition-opacity text-destructive"
														onClick={() => handleRemoveStaging(s.stagingSystem.id)}
													>
														<Trash2 className="h-3 w-3" />
													</button>
												</>
											)}
										</Badge>
									))
								) : (
									<span className="text-sm text-muted-foreground italic">
										{t('doctrines.noneAssigned')}
									</span>
								)}
								{canManage && (
									<Button
										variant="ghost"
										size="icon"
										className="h-6 w-6"
										onClick={() => {
											setEditingStaging(undefined)
											setStagingDialogOpen(true)
										}}
									>
										<Plus className="h-3.5 w-3.5" />
									</Button>
								)}
							</div>
						</div>
					</CardContent>
				</Card>

				{doctrine.fittings.length === 0 ? (
					<Card>
						<CardContent className="pt-6">
							<div className="text-center py-12">
								<p className="text-muted-foreground mb-4">{t('doctrines.noFittingsAddedYet')}</p>
								{canManage && (
									<div className="flex justify-center gap-2">
										<Button onClick={() => navigate(`/doctrines/fittings/create?doctrineId=${id}`)}>
											<Plus className="h-4 w-4" />
											{t('doctrines.createFitting')}
										</Button>
										<Button variant="secondary" onClick={() => setAddFittingOpen(true)}>
											<Plus className="h-4 w-4" />
											{t('doctrines.linkExisting')}
										</Button>
									</div>
								)}
							</div>
						</CardContent>
					</Card>
				) : (
					<div className="space-y-6">
						{groupedFittings.map(({ category, entries }) => {
							const isCollapsed = collapsedCategories.has(category)
							return (
								<div key={category} className="space-y-3">
									{/* Category header */}
									<button
										type="button"
										className="flex items-center gap-2 w-full text-left px-1 py-1.5 hover:bg-accent/50 rounded-md transition-colors"
										onClick={() => toggleCategory(category)}
									>
										{isCollapsed ? (
											<ChevronRight className="h-4 w-4 text-muted-foreground" />
										) : (
											<ChevronDown className="h-4 w-4 text-muted-foreground" />
										)}
										<h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
											{category}
										</h3>
										<span className="text-xs text-muted-foreground">({entries.length})</span>
									</button>

									{/* Fittings in this category */}
									{!isCollapsed && (
										<div className="space-y-3">
											{entries.map((entry) => (
												<div key={entry.fitting.id} className="relative group/fitting">
													<FittingCard fitting={entry.fitting} doctrineId={doctrine.id} />
													{canManage && (
														<div className="absolute top-1/2 -translate-y-1/2 right-2 z-10 flex gap-1">
															<Button
																variant="ghost"
																size="icon"
																className="h-7 w-7"
																onClick={(e) => {
																	e.preventDefault()
																	e.stopPropagation()
																	setEditingFittingEntry(entry)
																}}
																title={t('doctrines.editLinkSettings')}
															>
																<Settings className="h-3.5 w-3.5" />
															</Button>
															<Button
																asChild
																variant="ghost"
																size="icon"
																className="h-7 w-7"
																onClick={(e) => e.stopPropagation()}
															>
																<Link to={`/doctrines/fittings/${entry.fitting.id}/edit`}>
																	<Edit className="h-3.5 w-3.5" />
																</Link>
															</Button>
															<Button
																variant="ghost"
																size="icon"
																className="h-7 w-7 text-destructive hover:text-destructive"
																onClick={(e) => {
																	e.preventDefault()
																	e.stopPropagation()
																	handleRemoveFitting(entry.fitting.id)
																}}
															>
																<Trash2 className="h-3.5 w-3.5" />
															</Button>
														</div>
													)}
												</div>
											))}
										</div>
									)}
								</div>
							)
						})}
					</div>
				)}
			</div>

			{/* Add fitting dialog */}
			{canManage && id && (
				<AddFittingDialog
					doctrineId={id}
					open={addFittingOpen}
					onOpenChange={setAddFittingOpen}
					existingFittingIds={doctrine.fittings.map((e) => e.fitting.id)}
				/>
			)}

			{/* Confirmation dialog */}
			{confirmationDialog}

			{/* Staging system dialog */}
			{canManage && id && (
				<StagingDialog
					key={editingStaging?.stagingSystem.id ?? 'new-staging'}
					open={stagingDialogOpen}
					onOpenChange={setStagingDialogOpen}
					doctrineId={id}
					existing={editingStaging}
				/>
			)}

			{/* Edit doctrine-fitting link dialog */}
			{canManage && id && editingFittingEntry && (
				<EditDoctrineFittingDialog
					key={editingFittingEntry.fitting.id}
					open={!!editingFittingEntry}
					onOpenChange={(open) => {
						if (!open) setEditingFittingEntry(null)
					}}
					doctrineId={id}
					entry={editingFittingEntry}
				/>
			)}
		</Container>
	)
}
