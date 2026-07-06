import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic.mjs'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
	SidebarExternalLinkCreateInput,
	SidebarExternalLinkIconName,
	SidebarExternalLinkSummary,
} from '@repo/admin'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'
import toast from '@/lib/toast'
import { SIDEBAR_EXTERNAL_LINK_ICON_OPTIONS } from '@/lib/sidebar-external-links'

const EMPTY_ARRAY: never[] = []

type ExternalLinkDraft = {
	id: string
	displayName: string
	url: string
	iconName: SidebarExternalLinkIconName
	sortOrder: number
	isEnabled: boolean
}

function sortExternalLinks(links: SidebarExternalLinkSummary[]): SidebarExternalLinkSummary[] {
	return [...links].sort(
		(a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id)
	)
}

function draftFromLink(link: SidebarExternalLinkSummary): ExternalLinkDraft {
	return {
		id: link.id,
		displayName: link.displayName,
		url: link.url,
		iconName: link.iconName,
		sortOrder: link.sortOrder,
		isEnabled: link.isEnabled,
	}
}

function createEmptyDraft(sortOrder = 0): ExternalLinkDraft {
	return {
		id: crypto.randomUUID(),
		displayName: '',
		url: '',
		iconName: 'external-link',
		sortOrder,
		isEnabled: true,
	}
}

function externalLinkPayloadFromDraft(draft: ExternalLinkDraft): SidebarExternalLinkCreateInput {
	return {
		displayName: draft.displayName.trim(),
		url: draft.url.trim(),
		iconName: draft.iconName,
		sortOrder: draft.sortOrder,
		isEnabled: draft.isEnabled,
	}
}

function renderIconOption(option: (typeof SIDEBAR_EXTERNAL_LINK_ICON_OPTIONS)[number]) {
	return (
		<div className="flex items-center gap-3">
			<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background shadow-sm">
				<DynamicIcon name={option.value} className="h-5 w-5 text-foreground" />
			</div>
			<div className="min-w-0">
				<div className="truncate font-medium">{option.label}</div>
				<div className="truncate text-xs text-muted-foreground">{option.value}</div>
			</div>
		</div>
	)
}

export default function AdminExternalLinksPage() {
	usePageTitle('Admin - External Links')
	const queryClient = useQueryClient()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const { data: externalLinks = EMPTY_ARRAY, isLoading } = useQuery({
		queryKey: ['admin', 'sidebar-external-links'],
		queryFn: () => api.getAdminSidebarExternalLinks(),
		staleTime: 1000 * 30,
	})

	const [drafts, setDrafts] = useState<Record<string, ExternalLinkDraft>>({})
	const [editingRows, setEditingRows] = useState<Record<string, boolean>>({})
	const [savingRows, setSavingRows] = useState<Record<string, boolean>>({})
	const [deletingRows, setDeletingRows] = useState<Record<string, boolean>>({})
	const [newDraft, setNewDraft] = useState<ExternalLinkDraft | null>(null)

	const sortedLinks = useMemo(() => sortExternalLinks(externalLinks), [externalLinks])
	const nextSortOrder = useMemo(() => {
		const maxSortOrder = externalLinks.reduce((max, link) => Math.max(max, link.sortOrder), -1)
		return maxSortOrder + 1
	}, [externalLinks])
	const iconOptions = SIDEBAR_EXTERNAL_LINK_ICON_OPTIONS

	useEffect(() => {
		setDrafts((current) => {
			const next = { ...current }
			const externalLinkIds = new Set(externalLinks.map((link) => link.id))

			for (const id of Object.keys(next)) {
				if (!externalLinkIds.has(id) || !editingRows[id]) {
					delete next[id]
				}
			}

			for (const link of externalLinks) {
				if (!editingRows[link.id]) continue
				if (!next[link.id]) {
					next[link.id] = draftFromLink(link)
				}
			}

			return next
		})
	}, [editingRows, externalLinks])

	const createMutation = useMutation({
		mutationFn: (draft: ExternalLinkDraft) =>
			api.createAdminSidebarExternalLink(externalLinkPayloadFromDraft(draft)),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ['admin', 'sidebar-external-links'] })
			setNewDraft(null)
			toast.success('External link created')
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : 'Failed to create external link')
		},
	})

	const beginEdit = (link: SidebarExternalLinkSummary) => {
		setEditingRows((current) => ({ ...current, [link.id]: true }))
		setDrafts((current) => ({ ...current, [link.id]: current[link.id] ?? draftFromLink(link) }))
	}

	const cancelEdit = (id: string) => {
		setEditingRows((current) => {
			const next = { ...current }
			delete next[id]
			return next
		})
		setDrafts((current) => {
			const next = { ...current }
			delete next[id]
			return next
		})
	}

	const saveEdit = async (id: string) => {
		const draft = drafts[id]
		if (!draft) return

		setSavingRows((current) => ({ ...current, [id]: true }))
		try {
			await api.updateAdminSidebarExternalLink(id, externalLinkPayloadFromDraft(draft))
			await queryClient.invalidateQueries({ queryKey: ['admin', 'sidebar-external-links'] })
			cancelEdit(id)
			toast.success('External link updated')
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to update external link')
		} finally {
			setSavingRows((current) => {
				const next = { ...current }
				delete next[id]
				return next
			})
		}
	}

	const deleteLink = async (id: string) => {
		setDeletingRows((current) => ({ ...current, [id]: true }))
		try {
			await api.deleteAdminSidebarExternalLink(id)
			await queryClient.invalidateQueries({ queryKey: ['admin', 'sidebar-external-links'] })
			cancelEdit(id)
			toast.success('External link deleted')
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to delete external link')
		} finally {
			setDeletingRows((current) => {
				const next = { ...current }
				delete next[id]
				return next
			})
		}
	}

	return (
		<Container className="space-y-6 py-6">
			{confirmationDialog}
			<PageHeader
				title="External Links"
				description="Manage the sidebar's External section with display names, URLs, icons, and ordering."
			/>

			<Card>
				<CardHeader>
					<CardTitle>Configured Links</CardTitle>
					<CardDescription>
						Use the order number to control sidebar placement. Use the button below the table to add a new link.
						The URL should be an absolute https or http link.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-24">Order</TableHead>
								<TableHead className="w-24">Enabled</TableHead>
								<TableHead className="w-48">Icon</TableHead>
								<TableHead>Display Name</TableHead>
								<TableHead>URL</TableHead>
								<TableHead className="w-36 text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{sortedLinks.map((link) => {
								const isEditing = editingRows[link.id] === true
								const draft = drafts[link.id] ?? draftFromLink(link)
								const isSaving = savingRows[link.id] === true
								const isDeleting = deletingRows[link.id] === true
								const changed =
									draft.displayName !== link.displayName ||
									draft.url !== link.url ||
									draft.iconName !== link.iconName ||
									draft.sortOrder !== link.sortOrder ||
									draft.isEnabled !== link.isEnabled

								return (
									<TableRow key={link.id} className={isEditing ? 'bg-muted/20' : undefined}>
										<TableCell>
											{isEditing ? (
												<Input
													type="number"
													value={draft.sortOrder}
													onChange={(event) =>
														setDrafts((current) => ({
															...current,
															[link.id]: {
																...draft,
																sortOrder: Number(event.target.value),
															},
														}))
													}
													className="w-20"
												/>
											) : (
												<span className="text-sm text-foreground">{link.sortOrder}</span>
											)}
										</TableCell>
										<TableCell>
											{isEditing ? (
												<Switch
													checked={draft.isEnabled}
													onCheckedChange={(checked) =>
														setDrafts((current) => ({
															...current,
															[link.id]: { ...draft, isEnabled: checked },
														}))
													}
												/>
											) : (
												<Badge variant={link.isEnabled ? 'secondary' : 'ghost'}>
													{link.isEnabled ? 'Enabled' : 'Disabled'}
												</Badge>
											)}
										</TableCell>
										<TableCell>
											{isEditing ? (
												<div className="flex items-center gap-3">
													<div className="flex h-9 w-9 items-center justify-center rounded-md border border-border/60 bg-muted/30">
														<DynamicIcon
															name={draft.iconName}
															className="h-4 w-4 text-muted-foreground"
														/>
													</div>
													<Select
														options={iconOptions}
														value={draft.iconName}
														searchable
														contentClassName="!w-[20rem] !min-w-[20rem]"
														onValueChange={(value) =>
															setDrafts((current) => ({
																...current,
																[link.id]: {
																	...draft,
																	iconName: value as SidebarExternalLinkIconName,
																},
															}))
														}
														renderOption={renderIconOption}
														getOptionSearchText={(option) => option.label}
														placeholder="Select an icon"
														className="w-48"
													/>
												</div>
											) : (
												<div className="flex items-center gap-3">
													<div className="flex h-9 w-9 items-center justify-center rounded-md border border-border/60 bg-muted/30">
														<DynamicIcon
															name={link.iconName}
															className="h-4 w-4 text-muted-foreground"
														/>
													</div>
													<span className="text-sm text-foreground">{link.iconName}</span>
												</div>
											)}
										</TableCell>
										<TableCell>
											{isEditing ? (
												<Input
													value={draft.displayName}
													onChange={(event) =>
														setDrafts((current) => ({
															...current,
															[link.id]: {
																...draft,
																displayName: event.target.value,
															},
														}))
													}
												/>
											) : (
												<span className="text-sm text-foreground">{link.displayName}</span>
											)}
										</TableCell>
										<TableCell>
											{isEditing ? (
												<Input
													type="url"
													value={draft.url}
													onChange={(event) =>
														setDrafts((current) => ({
															...current,
															[link.id]: { ...draft, url: event.target.value },
														}))
													}
												/>
											) : (
												<a
													href={link.url}
													target="_blank"
													rel="noreferrer"
													className="block truncate text-sm text-muted-foreground transition-colors hover:text-foreground"
												>
													{link.url}
												</a>
											)}
										</TableCell>
										<TableCell>
											<div className="flex items-center justify-end gap-2">
												{isEditing ? (
													<>
														<Button
															variant="primary"
															size="sm"
															disabled={!changed || isSaving}
															onClick={() => void saveEdit(link.id)}
														>
															<Check className="h-4 w-4" />
															Save
														</Button>
														<Button
															variant="ghost"
															size="sm"
															disabled={isSaving}
															onClick={() => cancelEdit(link.id)}
														>
															<X className="h-4 w-4" />
															Cancel
														</Button>
													</>
												) : (
												<Button
													variant="primary"
													size="sm"
													disabled={isDeleting}
													onClick={() => beginEdit(link)}
													aria-label={`Edit ${link.displayName}`}
												>
													<Pencil className="h-4 w-4" />
												</Button>
											)}
												<Button
													variant="destructive"
													size="sm"
													disabled={isDeleting || isSaving}
													onClick={() =>
														void requestConfirmation({
															title: 'Delete external link?',
															description: `Remove ${link.displayName || 'this link'} from the sidebar. This cannot be undone.`,
															confirmLabel: 'Delete',
															intent: 'destructive',
															onConfirm: async () => {
																await deleteLink(link.id)
															},
														})
													}
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								)
							})}
							{newDraft ? (
								<TableRow className="bg-muted/20">
									<TableCell>
										<Input
											type="number"
											value={newDraft.sortOrder}
											onChange={(event) =>
												setNewDraft((current) =>
													current
														? {
																...current,
																sortOrder: Number(event.target.value),
															}
														: current
												)
											}
											className="w-20"
										/>
									</TableCell>
									<TableCell>
										<Switch
											checked={newDraft.isEnabled}
											onCheckedChange={(checked) =>
												setNewDraft((current) => (current ? { ...current, isEnabled: checked } : current))
											}
										/>
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-3">
											<div className="flex h-9 w-9 items-center justify-center rounded-md border border-border/60 bg-muted/30">
												<DynamicIcon
													name={newDraft.iconName}
													className="h-4 w-4 text-muted-foreground"
												/>
											</div>
											<Select
												options={iconOptions}
												value={newDraft.iconName}
												searchable
												contentClassName="!w-[20rem] !min-w-[20rem]"
												onValueChange={(value) =>
													setNewDraft((current) =>
														current
															? { ...current, iconName: value as SidebarExternalLinkIconName }
															: current
													)
												}
												renderOption={renderIconOption}
												getOptionSearchText={(option) => option.label}
												placeholder="Select an icon"
												className="w-48"
											/>
										</div>
									</TableCell>
									<TableCell>
										<Input
											value={newDraft.displayName}
											onChange={(event) =>
												setNewDraft((current) => (current ? { ...current, displayName: event.target.value } : current))
											}
											placeholder="Display name"
										/>
									</TableCell>
									<TableCell>
										<Input
											type="url"
											value={newDraft.url}
											onChange={(event) =>
												setNewDraft((current) => (current ? { ...current, url: event.target.value } : current))
											}
											placeholder="https://example.org/"
										/>
									</TableCell>
									<TableCell>
										<div className="flex items-center justify-end gap-2">
											<Button
												variant="ghost"
												onClick={() => setNewDraft(null)}
												disabled={createMutation.isPending}
											>
												Cancel
											</Button>
											<Button
												onClick={() => createMutation.mutate(newDraft)}
												disabled={!newDraft.displayName.trim() || !newDraft.url.trim() || createMutation.isPending}
											>
												<Check className="h-4 w-4" />
												Save
											</Button>
										</div>
									</TableCell>
								</TableRow>
							) : null}
							{!isLoading && sortedLinks.length === 0 && !newDraft ? (
								<TableRow>
									<TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
										No external links are configured yet.
									</TableCell>
								</TableRow>
							) : null}
							<TableRow>
								<TableCell colSpan={6} className="border-t-0 bg-transparent py-4">
									<div className="flex justify-end">
										<Button onClick={() => setNewDraft(createEmptyDraft(nextSortOrder))} disabled={newDraft !== null}>
											<Plus className="h-4 w-4" />
											Add External Link
										</Button>
									</div>
								</TableCell>
							</TableRow>
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</Container>
	)
}
