import { useEffect, useMemo, useState } from 'react'

import { CancelButton } from '@/components/ui/cancel-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DestructiveButton } from '@/components/ui/destructive-button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PrimaryButton } from '@/components/ui/primary-button'
import { Select } from '@/components/ui/select'

import type { TaxRuleGroup } from '@repo/corporation-tax'

type RuleGroupUpdate = {
	name?: string
	description?: string | null
}

export function RuleGroupScopeCard({
	ruleGroups,
	selectedRuleGroupId,
	ruleGroupsLoading,
	ruleGroupsError,
	isCreating,
	isUpdating,
	isDeleting,
	onSelectRuleGroup,
	onCreateGroup,
	onUpdateGroup,
	onDeleteGroup,
}: {
	ruleGroups: TaxRuleGroup[]
	selectedRuleGroupId?: string
	ruleGroupsLoading: boolean
	ruleGroupsError: unknown
	isCreating: boolean
	isUpdating: boolean
	isDeleting: boolean
	onSelectRuleGroup: (ruleGroupId: string) => void
	onCreateGroup: (name: string) => Promise<unknown> | void
	onUpdateGroup: (ruleGroupId: string, updates: RuleGroupUpdate) => Promise<unknown> | void
	onDeleteGroup: (ruleGroupId: string) => Promise<unknown> | void
}) {
	const [ruleGroupScopeQuery, setRuleGroupScopeQuery] = useState('')
	const [newGroupName, setNewGroupName] = useState('')
	const [groupName, setGroupName] = useState('')
	const [groupDescription, setGroupDescription] = useState('')
	const [deleteGroupDialogOpen, setDeleteGroupDialogOpen] = useState(false)

	const selectedRuleGroup = useMemo(
		() => ruleGroups.find((group) => group.id === selectedRuleGroupId),
		[ruleGroups, selectedRuleGroupId]
	)
	const isImmutableGroup = Boolean(
		selectedRuleGroup?.isDefaultGlobal || selectedRuleGroup?.isSystem
	)

	useEffect(() => {
		if (!selectedRuleGroup) return
		setGroupName(selectedRuleGroup.name)
		setGroupDescription(selectedRuleGroup.description ?? '')
	}, [selectedRuleGroup])

	const ruleGroupScopeOptions = useMemo(
		() =>
			ruleGroups.map((group) => ({ value: group.id,
				label: group.isDefaultGlobal ? 'Alliance Global (default)' : group.name,
				description: group.isDefaultGlobal ? group.name : (group.description ?? undefined),
			})),
		[ruleGroups]
	)

	return (
		<Card>
			<CardHeader>
				<CardTitle>Rule Group Scope</CardTitle>
				<CardDescription>
					Select the active rule group scope. Rules and corporation attachments below are always for
					the selected group.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-end">
					<div className="space-y-1">
						<label className="text-xs font-medium text-muted-foreground">Rule Group</label>
						{ruleGroupsLoading ? (
							<div className="text-sm text-muted-foreground">Loading rule groups...</div>
						) : ruleGroupsError ? (
							<div className="text-sm text-destructive">
								{ruleGroupsError instanceof Error
									? ruleGroupsError.message
									: 'Failed to load groups'}
							</div>
						) : (
							<Select
								value={selectedRuleGroup?.id ?? ''}
								onValueChange={(nextValue) => {
									onSelectRuleGroup(nextValue)
									setRuleGroupScopeQuery('')
								}}
								query={ruleGroupScopeQuery}
								onQueryChange={setRuleGroupScopeQuery}
								searchable
								options={ruleGroupScopeOptions}
								placeholder={
									selectedRuleGroup
										? selectedRuleGroup.isDefaultGlobal
											? 'Alliance Global (default)'
											: selectedRuleGroup.name
										: 'Select a rule group'
								}
							/>
						)}
					</div>
					<div className="pb-2 text-center text-xs font-medium text-muted-foreground">- or -</div>
					<div className="space-y-1">
						<label className="text-xs font-medium text-muted-foreground">Create Rule Group</label>
						<div className="flex items-center gap-2">
							<Input
								value={newGroupName}
								onChange={(event) => setNewGroupName(event.target.value)}
								placeholder="Enter a rule group name"
							/>
							<PrimaryButton
								disabled={isCreating}
								onClick={() => {
									const name = newGroupName.trim()
									if (!name) return
									void Promise.resolve(onCreateGroup(name)).then(() => setNewGroupName(''))
								}}
							>
								{isCreating ? 'Creating...' : 'Create'}
							</PrimaryButton>
						</div>
					</div>
				</div>

				{selectedRuleGroup ? (
					<div className="space-y-3 rounded-md border border-border p-3">
						{isImmutableGroup ? (
							<div className="text-xs text-muted-foreground">
								Alliance Global (default) group metadata is system-managed and cannot be edited.
							</div>
						) : null}
						<div className="grid gap-3 md:grid-cols-2">
							<div className="space-y-1">
								<label className="text-xs font-medium text-muted-foreground">Group name</label>
								<Input
									value={groupName}
									onChange={(event) => setGroupName(event.target.value)}
									disabled={isImmutableGroup}
								/>
							</div>
							<div className="space-y-1">
								<label className="text-xs font-medium text-muted-foreground">
									Description (optional)
								</label>
								<Input
									value={groupDescription}
									onChange={(event) => setGroupDescription(event.target.value)}
									disabled={isImmutableGroup}
								/>
							</div>
						</div>
						{!isImmutableGroup ? (
							<div className="flex flex-wrap gap-2">
								<PrimaryButton
									size="sm"
									disabled={isUpdating || !groupName.trim()}
									onClick={() =>
										void onUpdateGroup(selectedRuleGroup.id, {
											name: groupName.trim(),
											description: groupDescription.trim() || null,
										})
									}
								>
									{isUpdating ? 'Saving...' : 'Save Group'}
								</PrimaryButton>
								<DestructiveButton
									size="sm"
									showIcon={false}
									disabled={isDeleting}
									onClick={() => setDeleteGroupDialogOpen(true)}
								>
									Delete Group
								</DestructiveButton>
							</div>
						) : null}
					</div>
				) : null}
				<Dialog open={deleteGroupDialogOpen} onOpenChange={setDeleteGroupDialogOpen}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Delete Rule Group</DialogTitle>
							<DialogDescription>
								Are you sure you want to delete "{selectedRuleGroup?.name}"? This action cannot be
								undone.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<CancelButton onClick={() => setDeleteGroupDialogOpen(false)} disabled={isDeleting}>
								Cancel
							</CancelButton>
							<DestructiveButton
								loading={isDeleting}
								loadingText="Deleting..."
								showIcon={false}
								onClick={() => {
									if (!selectedRuleGroup) return
									void Promise.resolve(onDeleteGroup(selectedRuleGroup.id)).then(() =>
										setDeleteGroupDialogOpen(false)
									)
								}}
							>
								Delete
							</DestructiveButton>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</CardContent>
		</Card>
	)
}
