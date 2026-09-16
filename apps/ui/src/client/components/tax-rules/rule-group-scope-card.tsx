import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useAppTranslation } from '@/i18n'

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
	const { t } = useAppTranslation()

	const [ruleGroupScopeQuery, setRuleGroupScopeQuery] = useState('')
	const [newGroupName, setNewGroupName] = useState('')
	const [groupName, setGroupName] = useState('')
	const [groupDescription, setGroupDescription] = useState('')
	const [deleteGroupDialogOpen, setDeleteGroupDialogOpen] = useState(false)

	const selectedRuleGroup = useMemo(
		() => ruleGroups.find((group) => group.id === selectedRuleGroupId),
		[ruleGroups, selectedRuleGroupId, t]
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
			ruleGroups.map((group) => ({
				value: group.id,
				label: group.isDefaultGlobal ? t('tax.allianceGlobalDefault') : group.name,
				description: group.isDefaultGlobal ? group.name : (group.description ?? undefined),
			})),
		[ruleGroups, t]
	)

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('tax.ruleGroupScope')}</CardTitle>
				<CardDescription>
					{t('tax.selectTheActiveRuleGroupScopeRulesAndCorporationAttachments')}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-end">
					<div className="space-y-1">
						<label className="text-xs font-medium text-muted-foreground">
							{t('tax.ruleGroup')}
						</label>
						{ruleGroupsLoading ? (
							<div className="text-sm text-muted-foreground">{t('tax.loadingRuleGroups')}</div>
						) : ruleGroupsError ? (
							<div className="text-sm text-destructive">
								{ruleGroupsError instanceof Error
									? ruleGroupsError.message
									: t('tax.failedToLoadGroups')}
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
											? t('tax.allianceGlobalDefault')
											: selectedRuleGroup.name
										: t('tax.selectARuleGroup')
								}
							/>
						)}
					</div>
					<div className="pb-2 text-center text-xs font-medium text-muted-foreground">
						{t('tax.or')}
					</div>
					<div className="space-y-1">
						<label className="text-xs font-medium text-muted-foreground">
							{t('tax.createRuleGroup')}
						</label>
						<div className="flex items-center gap-2">
							<Input
								value={newGroupName}
								onChange={(event) => setNewGroupName(event.target.value)}
								placeholder={t('tax.enterARuleGroupName')}
							/>
							<Button
								variant="primary"
								disabled={isCreating}
								onClick={() => {
									const name = newGroupName.trim()
									if (!name) return
									void Promise.resolve(onCreateGroup(name)).then(() => setNewGroupName(''))
								}}
							>
								{isCreating ? t('tax.creating') : t('tax.create')}
							</Button>
						</div>
					</div>
				</div>

				{selectedRuleGroup ? (
					<div className="space-y-3 rounded-md border border-border p-3">
						{isImmutableGroup ? (
							<div className="text-xs text-muted-foreground">
								{t('tax.allianceGlobalDefaultGroupMetadataIsSystemManagedAndCannot')}
							</div>
						) : null}
						<div className="grid gap-3 md:grid-cols-2">
							<div className="space-y-1">
								<label className="text-xs font-medium text-muted-foreground">
									{t('tax.groupName')}
								</label>
								<Input
									value={groupName}
									onChange={(event) => setGroupName(event.target.value)}
									disabled={isImmutableGroup}
								/>
							</div>
							<div className="space-y-1">
								<label className="text-xs font-medium text-muted-foreground">
									{t('tax.descriptionOptional')}
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
								<Button
									variant="primary"
									size="sm"
									disabled={isUpdating || !groupName.trim()}
									onClick={() =>
										void onUpdateGroup(selectedRuleGroup.id, {
											name: groupName.trim(),
											description: groupDescription.trim() || null,
										})
									}
								>
									{isUpdating ? t('tax.saving') : t('tax.saveGroup')}
								</Button>
								<Button
									variant="destructive"
									size="sm"
									showIcon={false}
									disabled={isDeleting}
									onClick={() => setDeleteGroupDialogOpen(true)}
								>
									{t('tax.deleteGroup')}
								</Button>
							</div>
						) : null}
					</div>
				) : null}
				<Dialog open={deleteGroupDialogOpen} onOpenChange={setDeleteGroupDialogOpen}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{t('tax.deleteRuleGroup')}</DialogTitle>
							<DialogDescription>
								{t('tax.deleteRuleConfirm', { name: selectedRuleGroup?.name })}
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button
								variant="cancel"
								onClick={() => setDeleteGroupDialogOpen(false)}
								disabled={isDeleting}
							>
								{t('tax.cancel')}
							</Button>
							<Button
								variant="destructive"
								loading={isDeleting}
								loadingText={t('tax.deleting')}
								showIcon={false}
								onClick={() => {
									if (!selectedRuleGroup) return
									void Promise.resolve(onDeleteGroup(selectedRuleGroup.id)).then(() =>
										setDeleteGroupDialogOpen(false)
									)
								}}
							>
								{t('tax.delete')}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</CardContent>
		</Card>
	)
}
