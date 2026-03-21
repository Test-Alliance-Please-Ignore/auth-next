import { NumberInput } from '@mantine/core'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CancelButton } from '@/components/ui/cancel-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
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
import { PageHeader } from '@/components/ui/page-header'
import { SearchSelect } from '@/components/ui/search-select'
import { Section } from '@/components/ui/section'
import { Switch } from '@/components/ui/switch'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useCorporationAccess } from '@/features/my-corporations'
import {
	useAttachCorporationToRuleGroup,
	useCreateTaxRuleGroup,
	useCreateTaxRuleSet,
	useDeleteTaxRuleGroup,
	useDeleteTaxRuleSet,
	useDetachCorporationFromRuleGroup,
	useTaxCapabilities,
	useTaxCorporations,
	useTaxRuleGroupAttachments,
	useTaxRuleGroups,
	useTaxRuleSets,
	useUpdateTaxRuleGroup,
	useUpdateTaxRuleSet,
} from '@/hooks/useCorporationTax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import {
	MANTINE_THEMED_NUMBER_INPUT_CLASS_NAMES,
	MANTINE_THEMED_NUMBER_INPUT_STYLES,
} from '@/lib/mantine-input-styles'
import { formatTaxDateTime } from '@/lib/tax-date'
import { formatTaxRefTypeLabel, TAX_REF_TYPE_OPTIONS } from '@/lib/tax-display'

import type { TaxRuleSet } from '@repo/corporation-tax'

type RuleFormState = {
	name: string
	priorityText: string
	rateText: string
	refType: string
	refTypeQuery: string
	isActive: boolean
}

function toPercentText(bps: number): string {
	return (bps / 100).toFixed(2)
}

function parsePercentToBps(input: string): number | null {
	const parsed = Number(input)
	if (!Number.isFinite(parsed)) return null
	const bps = Math.round(parsed * 100)
	if (bps < 0 || bps > 10_000) return null
	return bps
}

function parsePriority(input: string): number | null {
	const parsed = Number(input)
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) return null
	return parsed
}

function normalizeNumberInputValue(value: string | number): string {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? String(value) : ''
	}
	return value
}

function isRuleFormValid(form: RuleFormState): boolean {
	return (
		Boolean(form.name.trim()) &&
		parsePriority(form.priorityText) !== null &&
		parsePercentToBps(form.rateText) !== null
	)
}

function defaultRuleFormState(): RuleFormState {
	return {
		name: '',
		priorityText: '0',
		rateText: '0',
		refType: '',
		refTypeQuery: '',
		isActive: true,
	}
}

function ruleToFormState(rule: TaxRuleSet): RuleFormState {
	return {
		name: rule.name,
		priorityText: String(rule.priority),
		rateText: toPercentText(rule.taxRateBps),
		refType: rule.appliesToRefType ?? '',
		refTypeQuery: '',
		isActive: rule.isActive,
	}
}

function RuleFormFields({
	form,
	onChange,
	disabled,
}: {
	form: RuleFormState
	onChange: (next: RuleFormState) => void
	disabled?: boolean
}) {
	const incomeTypeOptions = useMemo(
		() => [
			{
				id: 'any-income-type',
				value: '',
				label: 'Any income type',
			},
			...TAX_REF_TYPE_OPTIONS,
		],
		[]
	)

	return (
		<div className="grid gap-3 md:grid-cols-[25%_25%_15%_15%_15%]">
			<div className="space-y-1">
				<label className="text-xs font-medium text-muted-foreground">Rule name</label>
				<Input
					value={form.name}
					onChange={(event) => onChange({ ...form, name: event.target.value })}
					disabled={disabled}
				/>
			</div>
			<div className="space-y-1">
				<label className="text-xs font-medium text-muted-foreground">
					Income source (optional)
				</label>
				<SearchSelect
					value={form.refTypeQuery}
					onValueChange={(value) => onChange({ ...form, refTypeQuery: value })}
					options={incomeTypeOptions}
					onSelect={(option) =>
						onChange({
							...form,
							refType: option.value,
							refTypeQuery: '',
						})
					}
					filterMode="local"
					mode="dropdown"
					minQueryLength={0}
					listMinHeight="14rem"
					listMaxHeight="28rem"
					placeholder={form.refType ? formatTaxRefTypeLabel(form.refType) : 'Any income type'}
					disabled={disabled}
				/>
			</div>
			<div className="space-y-1">
				<label className="text-xs font-medium text-muted-foreground">Rate (%)</label>
				<NumberInput
					value={form.rateText}
					onChange={(value) => onChange({ ...form, rateText: normalizeNumberInputValue(value) })}
					classNames={MANTINE_THEMED_NUMBER_INPUT_CLASS_NAMES}
					styles={MANTINE_THEMED_NUMBER_INPUT_STYLES}
					clampBehavior="blur"
					min={0}
					max={100}
					step={0.01}
					decimalScale={2}
					allowDecimal
					allowNegative={false}
					rightSection={<span className="text-xs text-muted-foreground">%</span>}
					rightSectionWidth={18}
					hideControls
					disabled={disabled}
				/>
			</div>
			<div className="space-y-1">
				<label className="text-xs font-medium text-muted-foreground">Priority</label>
				<NumberInput
					value={form.priorityText}
					onChange={(value) =>
						onChange({ ...form, priorityText: normalizeNumberInputValue(value) })
					}
					classNames={MANTINE_THEMED_NUMBER_INPUT_CLASS_NAMES}
					styles={MANTINE_THEMED_NUMBER_INPUT_STYLES}
					clampBehavior="blur"
					min={0}
					max={100}
					step={1}
					allowDecimal={false}
					allowNegative={false}
					disabled={disabled}
				/>
			</div>
			<div className="flex flex-col items-center space-y-1">
				<label className="text-xs font-medium text-muted-foreground">Active</label>
				<div className="flex h-10 items-center justify-center">
					<Switch
						checked={form.isActive}
						onCheckedChange={(checked) => onChange({ ...form, isActive: checked })}
						disabled={disabled}
						aria-label="Rule active"
					/>
				</div>
			</div>
		</div>
	)
}

function RuleRowEditor({
	rule,
	canManage,
	isSaving,
	onSave,
	onDelete,
}: {
	rule: TaxRuleSet
	canManage: boolean
	isSaving: boolean
	onSave: (
		ruleSetId: string,
		updates: {
			name?: string
			priority?: number
			isActive?: boolean
			appliesToRefType?: string | null
			taxRateBps?: number
			label?: string
		}
	) => void
	onDelete: (ruleSetId: string) => void
}) {
	const [isEditing, setIsEditing] = useState(false)
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
	const [form, setForm] = useState<RuleFormState>(() => ruleToFormState(rule))
	const [rowActive, setRowActive] = useState(rule.isActive)
	const toggleTimeoutRef = useRef<number | null>(null)

	const formValid = isRuleFormValid(form)

	useEffect(() => {
		setForm(ruleToFormState(rule))
		setIsEditing(false)
		setRowActive(rule.isActive)
	}, [rule])

	useEffect(
		() => () => {
			if (toggleTimeoutRef.current !== null) {
				window.clearTimeout(toggleTimeoutRef.current)
			}
		},
		[]
	)

	return (
		<>
			<TableRow>
				<TableCell className="font-medium">{rule.name}</TableCell>
				<TableCell>
					{rule.appliesToRefType ? formatTaxRefTypeLabel(rule.appliesToRefType) : 'Any income type'}
				</TableCell>
				<TableCell>{toPercentText(rule.taxRateBps)}%</TableCell>
				<TableCell>{rule.priority}</TableCell>
				<TableCell>
					<div className="flex items-center">
						<Switch
							checked={rowActive}
							onCheckedChange={(checked) => {
								setRowActive(checked)
								if (toggleTimeoutRef.current !== null) {
									window.clearTimeout(toggleTimeoutRef.current)
								}
								toggleTimeoutRef.current = window.setTimeout(() => {
									onSave(rule.id, { isActive: checked })
								}, 300)
							}}
							disabled={!canManage || isSaving}
							aria-label="Toggle rule active state"
						/>
					</div>
				</TableCell>
				<TableCell>{formatTaxDateTime(rule.updatedAt)}</TableCell>
				<TableCell>
					<div className="flex items-center gap-3">
						<button
							type="button"
							aria-label="Edit rule"
							title="Edit rule"
							disabled={!canManage || isSaving}
							onClick={() => setIsEditing((current) => !current)}
							className="text-muted-foreground hover:text-foreground disabled:opacity-50"
						>
							<Pencil className="h-4 w-4" />
						</button>
						<button
							type="button"
							aria-label="Delete rule"
							title="Delete rule"
							disabled={!canManage || isSaving}
							onClick={() => setIsDeleteDialogOpen(true)}
							className="text-destructive/80 hover:text-destructive disabled:opacity-50"
						>
							<Trash2 className="h-4 w-4" />
						</button>
					</div>
				</TableCell>
			</TableRow>
			{isEditing ? (
				<TableRow>
					<TableCell colSpan={7} className="bg-muted/20">
						<div className="space-y-3">
							<RuleFormFields form={form} onChange={setForm} disabled={!canManage || isSaving} />
							<div className="flex flex-wrap justify-end items-center gap-2">
								<Button
									size="sm"
									disabled={!canManage || isSaving || !formValid}
									onClick={() => {
										const priority = parsePriority(form.priorityText)
										const rateBps = parsePercentToBps(form.rateText)
										if (!form.name.trim() || priority === null || rateBps === null) return
										onSave(rule.id, {
											name: form.name.trim(),
											priority,
											isActive: form.isActive,
											appliesToRefType: form.refType || null,
											taxRateBps: rateBps,
											label: rule.label,
										})
										setIsEditing(false)
									}}
								>
									Save
								</Button>
								<Button
									size="sm"
									variant="ghost"
									disabled={!canManage || isSaving}
									onClick={() => {
										setForm(ruleToFormState(rule))
										setIsEditing(false)
									}}
								>
									Cancel
								</Button>
							</div>
						</div>
					</TableCell>
				</TableRow>
			) : null}
			<Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Rule</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete "{rule.name}"? This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<CancelButton onClick={() => setIsDeleteDialogOpen(false)} disabled={isSaving}>
							Cancel
						</CancelButton>
						<DestructiveButton
							loading={isSaving}
							loadingText="Deleting..."
							showIcon={false}
							onClick={() => {
								onDelete(rule.id)
								setIsDeleteDialogOpen(false)
							}}
						>
							Delete
						</DestructiveButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}

export default function TaxRulesPage() {
	usePageTitle('Tax Rules')

	const { data: globalCapabilities } = useTaxCapabilities()
	const canManage = globalCapabilities?.global.canManage ?? false

	const { data: corporationAccess } = useCorporationAccess()
	const { data: taxCorporations = [] } = useTaxCorporations({ limit: 300, enabled: canManage })
	const {
		data: ruleGroups = [],
		isLoading: ruleGroupsLoading,
		error: ruleGroupsError,
	} = useTaxRuleGroups({ limit: 300, enabled: canManage })

	const [selectedRuleGroupId, setSelectedRuleGroupId] = useState<string | undefined>(undefined)
	const effectiveRuleGroupId = selectedRuleGroupId ?? ruleGroups[0]?.id
	const selectedRuleGroup = useMemo(
		() => ruleGroups.find((group) => group.id === effectiveRuleGroupId),
		[ruleGroups, effectiveRuleGroupId]
	)

	const { data: attachments = [] } = useTaxRuleGroupAttachments(
		effectiveRuleGroupId,
		Boolean(effectiveRuleGroupId && canManage)
	)
	const {
		data: ruleSets = [],
		isLoading: ruleSetsLoading,
		error: ruleSetsError,
	} = useTaxRuleSets({
		ruleGroupId: effectiveRuleGroupId,
		onlyActive: false,
		limit: 200,
		enabled: Boolean(effectiveRuleGroupId && canManage),
	})

	const createRuleGroupMutation = useCreateTaxRuleGroup()
	const updateRuleGroupMutation = useUpdateTaxRuleGroup()
	const deleteRuleGroupMutation = useDeleteTaxRuleGroup()
	const attachMutation = useAttachCorporationToRuleGroup()
	const detachMutation = useDetachCorporationFromRuleGroup()
	const createRuleMutation = useCreateTaxRuleSet()
	const updateRuleMutation = useUpdateTaxRuleSet()
	const deleteRuleMutation = useDeleteTaxRuleSet()

	const [ruleGroupScopeQuery, setRuleGroupScopeQuery] = useState('')
	const [newGroupName, setNewGroupName] = useState('')
	const [groupName, setGroupName] = useState('')
	const [groupDescription, setGroupDescription] = useState('')
	const [deleteGroupDialogOpen, setDeleteGroupDialogOpen] = useState(false)

	const [corpAttachQuery, setCorpAttachQuery] = useState('')
	const [isCreateRuleOpen, setIsCreateRuleOpen] = useState(false)
	const [createRuleForm, setCreateRuleForm] = useState<RuleFormState>(() => defaultRuleFormState())

	useEffect(() => {
		if (!effectiveRuleGroupId && ruleGroups.length > 0) {
			const defaultGlobalGroup = ruleGroups.find((group) => group.isDefaultGlobal) ?? ruleGroups[0]
			setSelectedRuleGroupId(defaultGlobalGroup?.id)
		}
	}, [effectiveRuleGroupId, ruleGroups])

	useEffect(() => {
		if (!selectedRuleGroup) return
		setGroupName(selectedRuleGroup.name)
		setGroupDescription(selectedRuleGroup.description ?? '')
	}, [selectedRuleGroup])

	const attachedIds = useMemo(
		() => new Set(attachments.map((attachment) => attachment.corporationId)),
		[attachments]
	)
	const excludedCorporationIdSet = useMemo(
		() =>
			new Set(
				taxCorporations
					.filter((corporation) => corporation.included === false)
					.map((corporation) => corporation.corporationId)
			),
		[taxCorporations]
	)

	const corporationIdsForNameLookup = useMemo(() => {
		const ids = new Set<string>()
		for (const corp of corporationAccess?.corporations ?? []) ids.add(corp.corporationId)
		for (const setting of taxCorporations) ids.add(setting.corporationId)
		for (const attachment of attachments) ids.add(attachment.corporationId)
		return Array.from(ids)
	}, [corporationAccess?.corporations, taxCorporations, attachments])

	const { data: entityNames = {} } = useEntityNames(corporationIdsForNameLookup, {
		enabled: canManage && corporationIdsForNameLookup.length > 0,
	})

	const corporationNameById = useMemo(() => {
		const map = new Map<string, string>()
		for (const corp of corporationAccess?.corporations ?? []) map.set(corp.corporationId, corp.name)
		for (const setting of taxCorporations) {
			if (!map.has(setting.corporationId)) {
				map.set(setting.corporationId, entityNames[setting.corporationId] ?? setting.corporationId)
			}
		}
		for (const [id, name] of Object.entries(entityNames)) {
			if (!map.has(id)) map.set(id, name)
		}
		return map
	}, [corporationAccess?.corporations, taxCorporations, entityNames])

	const corporationSearchOptions = useMemo(
		() =>
			Array.from(corporationNameById.entries())
				.filter(([corporationId]) => !excludedCorporationIdSet.has(corporationId))
				.map(([corporationId, name]) => ({
					id: corporationId,
					value: corporationId,
					label: name,
					description: corporationId,
				})),
		[corporationNameById, excludedCorporationIdSet]
	)

	const ruleGroupScopeOptions = useMemo(
		() =>
			ruleGroups.map((group) => ({
				id: group.id,
				value: group.id,
				label: group.isDefaultGlobal ? 'Alliance Global (default)' : group.name,
				description: group.isDefaultGlobal ? group.name : (group.description ?? undefined),
			})),
		[ruleGroups]
	)
	const isImmutableGroup = Boolean(
		selectedRuleGroup?.isDefaultGlobal || selectedRuleGroup?.isSystem
	)

	if (!canManage) {
		return (
			<Container>
				<Card>
					<CardHeader>
						<CardTitle>Tax Rules</CardTitle>
						<CardDescription>You do not have permission to manage tax rules.</CardDescription>
					</CardHeader>
				</Card>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title="Tax Rules"
				description="Manage rule group scopes, attach corporations to those scopes, and maintain group-scoped tax rules."
			/>

			<Section>
				<Card>
					<CardHeader>
						<CardTitle>Rule Group Scope</CardTitle>
						<CardDescription>
							Select the active rule group scope. Rules and corporation attachments below are always
							for the selected group.
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
									<SearchSelect
										value={ruleGroupScopeQuery}
										onValueChange={setRuleGroupScopeQuery}
										options={ruleGroupScopeOptions}
										onSelect={(option) => {
											setSelectedRuleGroupId(option.value)
											setRuleGroupScopeQuery('')
										}}
										filterMode="local"
										mode="dropdown"
										minQueryLength={0}
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
							<div className="pb-2 text-center text-xs font-medium text-muted-foreground">
								- or -
							</div>
							<div className="space-y-1">
								<label className="text-xs font-medium text-muted-foreground">
									Create Rule Group
								</label>
								<div className="flex items-center gap-2">
									<Input
										value={newGroupName}
										onChange={(event) => setNewGroupName(event.target.value)}
										placeholder="Enter a rule group name"
									/>
									<Button
										disabled={createRuleGroupMutation.isPending}
										onClick={() => {
											const name = newGroupName.trim()
											if (!name) return
											createRuleGroupMutation.mutate(
												{ name },
												{
													onSuccess: (created) => {
														setSelectedRuleGroupId(created.id)
														setNewGroupName('')
													},
												}
											)
										}}
									>
										{createRuleGroupMutation.isPending ? 'Creating...' : 'Create'}
									</Button>
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
										<Button
											size="sm"
											disabled={updateRuleGroupMutation.isPending || !groupName.trim()}
											onClick={() =>
												updateRuleGroupMutation.mutate({
													ruleGroupId: selectedRuleGroup.id,
													updates: {
														name: groupName.trim(),
														description: groupDescription.trim() || null,
													},
												})
											}
										>
											{updateRuleGroupMutation.isPending ? 'Saving...' : 'Save Group'}
										</Button>
										<Button
											size="sm"
											variant="destructive"
											disabled={deleteRuleGroupMutation.isPending}
											onClick={() => setDeleteGroupDialogOpen(true)}
										>
											Delete Group
										</Button>
									</div>
								) : null}
							</div>
						) : null}
						<Dialog open={deleteGroupDialogOpen} onOpenChange={setDeleteGroupDialogOpen}>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Delete Rule Group</DialogTitle>
									<DialogDescription>
										Are you sure you want to delete "{selectedRuleGroup?.name}"? This action cannot
										be undone.
									</DialogDescription>
								</DialogHeader>
								<DialogFooter>
									<CancelButton
										onClick={() => setDeleteGroupDialogOpen(false)}
										disabled={deleteRuleGroupMutation.isPending}
									>
										Cancel
									</CancelButton>
									<DestructiveButton
										loading={deleteRuleGroupMutation.isPending}
										loadingText="Deleting..."
										showIcon={false}
										onClick={() => {
											if (!selectedRuleGroup) return
											deleteRuleGroupMutation.mutate(selectedRuleGroup.id, {
												onSuccess: () => {
													setDeleteGroupDialogOpen(false)
													setSelectedRuleGroupId(undefined)
												},
											})
										}}
									>
										Delete
									</DestructiveButton>
								</DialogFooter>
							</DialogContent>
						</Dialog>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Corporations In Scope</CardTitle>
						<CardDescription>
							Attach corporations to the selected rule group scope. Attached corporations inherit
							this group&apos;s rules.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						{!effectiveRuleGroupId ? (
							<div className="text-sm text-muted-foreground">Select a rule group first.</div>
						) : (
							<>
								<SearchSelect
									value={corpAttachQuery}
									onValueChange={setCorpAttachQuery}
									options={corporationSearchOptions.filter(
										(option) => !attachedIds.has(option.value)
									)}
									onSelect={(option) => {
										setCorpAttachQuery('')
										attachMutation.mutate({
											ruleGroupId: effectiveRuleGroupId,
											corporationId: option.value,
										})
									}}
									filterMode="local"
									mode="dropdown"
									minQueryLength={0}
									placeholder="Attach corporation by name or ID"
									emptyText="No matching corporations"
								/>
								<div className="flex flex-wrap gap-2">
									{attachments.map((attachment) => (
										<Badge
											key={attachment.id}
											variant="secondary"
											className={`gap-2 ${attachment.isExcluded ? 'opacity-50 grayscale' : ''}`}
											title={
												attachment.isExcluded
													? `Excluded: ${attachment.exclusionReason ?? 'No reason provided'}`
													: undefined
											}
										>
											{corporationNameById.get(attachment.corporationId) ??
												entityNames[attachment.corporationId] ??
												attachment.corporationId}
											<Button
												variant="ghost"
												size="sm"
												className="h-5 px-1"
												onClick={() =>
													detachMutation.mutate({
														ruleGroupId: effectiveRuleGroupId,
														corporationId: attachment.corporationId,
													})
												}
											>
												<X className="h-3 w-3" />
											</Button>
										</Badge>
									))}
								</div>
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Rules In Scope</CardTitle>
						<CardDescription>
							Review group rules, edit with the pencil action, and add new rules using the + action.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{!effectiveRuleGroupId ? (
							<div className="text-sm text-muted-foreground">Select a rule group first.</div>
						) : ruleSetsLoading ? (
							<div className="text-sm text-muted-foreground">Loading rules...</div>
						) : ruleSetsError ? (
							<div className="text-sm text-destructive">
								{ruleSetsError instanceof Error ? ruleSetsError.message : 'Failed to load rules'}
							</div>
						) : (
							<>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Name</TableHead>
											<TableHead>Income Type</TableHead>
											<TableHead>Rate (%)</TableHead>
											<TableHead>Priority</TableHead>
											<TableHead>Active</TableHead>
											<TableHead>Updated</TableHead>
											<TableHead>Actions</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{ruleSets.length === 0 ? (
											<TableRow>
												<TableCell colSpan={7} className="text-sm text-muted-foreground">
													No rules are attached to this group yet.
												</TableCell>
											</TableRow>
										) : (
											ruleSets.map((rule) => (
												<RuleRowEditor
													key={rule.id}
													rule={rule}
													canManage={canManage}
													isSaving={updateRuleMutation.isPending || deleteRuleMutation.isPending}
													onSave={(ruleSetId, updates) =>
														updateRuleMutation.mutate({ ruleSetId, updates })
													}
													onDelete={(ruleSetId) => deleteRuleMutation.mutate(ruleSetId)}
												/>
											))
										)}
									</TableBody>
								</Table>

								{!isCreateRuleOpen ? (
									<div className="flex justify-center">
										<Button
											variant="outline"
											className="min-w-40"
											onClick={() => setIsCreateRuleOpen(true)}
											disabled={createRuleMutation.isPending}
										>
											<Plus className="mr-2 h-4 w-4" />
											Add Rule
										</Button>
									</div>
								) : null}

								{isCreateRuleOpen ? (
									<div className="space-y-3 rounded-md border border-border p-3">
										<div className="text-sm font-medium">New Rule</div>
										<RuleFormFields form={createRuleForm} onChange={setCreateRuleForm} />
										<div className="flex items-center justify-end gap-2">
											<Button
												disabled={createRuleMutation.isPending || !isRuleFormValid(createRuleForm)}
												onClick={() => {
													if (!effectiveRuleGroupId) return
													const rateBps = parsePercentToBps(createRuleForm.rateText)
													const priority = parsePriority(createRuleForm.priorityText)
													if (
														!createRuleForm.name.trim() ||
														rateBps === null ||
														priority === null
													) {
														return
													}
													createRuleMutation.mutate(
														{
															ruleSet: {
																ruleGroupId: effectiveRuleGroupId,
																name: createRuleForm.name.trim(),
																priority,
																isActive: createRuleForm.isActive,
																appliesToRefType: createRuleForm.refType || undefined,
																taxRateBps: rateBps,
																label: `${createRuleForm.name.trim()} rule`,
															},
														},
														{
															onSuccess: () => {
																setIsCreateRuleOpen(false)
																setCreateRuleForm(defaultRuleFormState())
															},
														}
													)
												}}
											>
												{createRuleMutation.isPending ? 'Creating...' : 'Create Rule'}
											</Button>
											<Button
												variant="ghost"
												disabled={createRuleMutation.isPending}
												onClick={() => {
													setIsCreateRuleOpen(false)
													setCreateRuleForm(defaultRuleFormState())
												}}
											>
												Cancel
											</Button>
										</div>
									</div>
								) : null}
							</>
						)}
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
