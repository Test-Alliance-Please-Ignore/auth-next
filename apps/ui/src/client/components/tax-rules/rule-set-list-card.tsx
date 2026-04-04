import { Plus } from 'lucide-react'
import { useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'

import {
	defaultRuleFormState,
	isRuleFormValid,
	parsePercentToBps,
	parsePriority,
	RuleFormFields,
	RuleRowEditor,
} from './rule-editor'

import type { TaxRuleSet } from '@repo/corporation-tax'
import type { RuleFormState } from './rule-editor'
import { Button } from '@/components/ui/button'

export function RuleSetListCard({
	effectiveRuleGroupId,
	ruleSets,
	ruleSetsLoading,
	ruleSetsError,
	canManage,
	isCreating,
	isUpdating,
	isDeleting,
	onCreateRule,
	onUpdateRule,
	onDeleteRule,
}: {
	effectiveRuleGroupId?: string
	ruleSets: TaxRuleSet[]
	ruleSetsLoading: boolean
	ruleSetsError: unknown
	canManage: boolean
	isCreating: boolean
	isUpdating: boolean
	isDeleting: boolean
	onCreateRule: (ruleSet: {
		ruleGroupId: string
		name: string
		priority: number
		isActive: boolean
		appliesToRefType?: string
		taxRateBps: number
	}) => Promise<unknown> | void
	onUpdateRule: (
		ruleSetId: string,
		updates: {
			name?: string
			priority?: number
			isActive?: boolean
			appliesToRefType?: string | null
			taxRateBps?: number
		}
	) => Promise<unknown> | void
	onDeleteRule: (ruleSetId: string) => Promise<unknown> | void
}) {
	const [isCreateRuleOpen, setIsCreateRuleOpen] = useState(false)
	const [createRuleForm, setCreateRuleForm] = useState<RuleFormState>(() => defaultRuleFormState())

	return (
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
											isSaving={isUpdating || isDeleting}
											onSave={(ruleSetId, updates) => void onUpdateRule(ruleSetId, updates)}
											onDelete={(ruleSetId) => void onDeleteRule(ruleSetId)}
										/>
									))
								)}
							</TableBody>
						</Table>

						{!isCreateRuleOpen ? (
							<div className="flex justify-center">
								<Button variant="primary"
									className="min-w-40"
									onClick={() => setIsCreateRuleOpen(true)}
									disabled={isCreating}
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
									<Button variant="primary"
										disabled={isCreating || !isRuleFormValid(createRuleForm)}
										onClick={() => {
											if (!effectiveRuleGroupId) return
											const rateBps = parsePercentToBps(createRuleForm.rateText)
											const priority = parsePriority(createRuleForm.priorityText)
											if (!createRuleForm.name.trim() || rateBps === null || priority === null) {
												return
											}
											void Promise.resolve(
												onCreateRule({
													ruleGroupId: effectiveRuleGroupId,
													name: createRuleForm.name.trim(),
													priority,
													isActive: createRuleForm.isActive,
													appliesToRefType: createRuleForm.refType || undefined,
													taxRateBps: rateBps,
												})
											).then(() => {
												setIsCreateRuleOpen(false)
												setCreateRuleForm(defaultRuleFormState())
											})
										}}
									>
										{isCreating ? 'Creating...' : 'Create Rule'}
									</Button>
									<Button variant="cancel"
										showIcon={false}
										disabled={isCreating}
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
	)
}
