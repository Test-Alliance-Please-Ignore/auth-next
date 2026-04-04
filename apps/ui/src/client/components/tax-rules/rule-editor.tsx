import { NumberInput } from '@mantine/core'
import { Pencil, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

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
import { Switch } from '@/components/ui/switch'
import { TableCell, TableRow } from '@/components/ui/table'
import {
	MANTINE_THEMED_NUMBER_INPUT_CLASS_NAMES,
	MANTINE_THEMED_NUMBER_INPUT_STYLES,
} from '@/lib/mantine-input-styles'
import { formatTaxDateTime } from '@/lib/tax-date'
import { formatTaxRefTypeLabel, TAX_REF_TYPE_OPTIONS } from '@/lib/tax-display'

import type { TaxRuleSet } from '@repo/corporation-tax'
import { Button } from '@/components/ui/button'

const ANY_INCOME_TYPE_VALUE = '__any_income_type__'

export type RuleFormState = {
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

export function parsePercentToBps(input: string): number | null {
	const parsed = Number(input)
	if (!Number.isFinite(parsed)) return null
	const bps = Math.round(parsed * 100)
	if (bps < 0 || bps > 10_000) return null
	return bps
}

export function parsePriority(input: string): number | null {
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

export function isRuleFormValid(form: RuleFormState): boolean {
	return (
		Boolean(form.name.trim()) &&
		parsePriority(form.priorityText) !== null &&
		parsePercentToBps(form.rateText) !== null
	)
}

export function defaultRuleFormState(): RuleFormState {
	return {
		name: '',
		priorityText: '0',
		rateText: '0',
		refType: ANY_INCOME_TYPE_VALUE,
		refTypeQuery: '',
		isActive: true,
	}
}

function ruleToFormState(rule: TaxRuleSet): RuleFormState {
	return {
		name: rule.name,
		priorityText: String(rule.priority),
		rateText: toPercentText(rule.taxRateBps),
		refType: rule.appliesToRefType ?? ANY_INCOME_TYPE_VALUE,
		refTypeQuery: '',
		isActive: rule.isActive,
	}
}

export function RuleFormFields({
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
			{ value: ANY_INCOME_TYPE_VALUE,
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
				<Select
					value={form.refType}
					onValueChange={(nextValue) =>
						onChange({
							...form,
							refType: nextValue,
							refTypeQuery: '',
						})
					}
					query={form.refTypeQuery}
					onQueryChange={(nextQuery) => onChange({ ...form, refTypeQuery: nextQuery })}
					searchable
					options={incomeTypeOptions}
					listMinHeight="14rem"
					listMaxHeight="28rem"
					placeholder={
						form.refType === ANY_INCOME_TYPE_VALUE
							? 'Any income type'
							: formatTaxRefTypeLabel(form.refType)
					}
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

export function RuleRowEditor({
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
							<div className="flex flex-wrap items-center justify-end gap-2">
								<Button variant="primary"
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
											appliesToRefType:
												form.refType === ANY_INCOME_TYPE_VALUE ? null : form.refType,
											taxRateBps: rateBps,
										})
										setIsEditing(false)
									}}
								>
									Save
								</Button>
								<Button variant="cancel"
									size="sm"
									showIcon={false}
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
						<Button variant="cancel" onClick={() => setIsDeleteDialogOpen(false)} disabled={isSaving}>
							Cancel
						</Button>
						<Button variant="danger"
							loading={isSaving}
							loadingText="Deleting..."
							showIcon={false}
							onClick={() => {
								onDelete(rule.id)
								setIsDeleteDialogOpen(false)
							}}
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
