import { Plus } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useAppTranslation } from '@/i18n'

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
	const { t } = useAppTranslation()

	const [isCreateRuleOpen, setIsCreateRuleOpen] = useState(false)
	const [createRuleForm, setCreateRuleForm] = useState<RuleFormState>(() => defaultRuleFormState())

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('tax.rulesInScope')}</CardTitle>
				<CardDescription>{t('tax.reviewGroupRulesEditWithThePencilActionAndAdd')}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{!effectiveRuleGroupId ? (
					<div className="text-sm text-muted-foreground">{t('tax.selectARuleGroupFirst')}</div>
				) : ruleSetsLoading ? (
					<div className="text-sm text-muted-foreground">{t('tax.loadingRules')}</div>
				) : ruleSetsError ? (
					<div className="text-sm text-destructive">
						{ruleSetsError instanceof Error ? ruleSetsError.message : t('tax.failedToLoadRules')}
					</div>
				) : (
					<>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t('tax.name')}</TableHead>
									<TableHead>{t('tax.incomeType')}</TableHead>
									<TableHead>{t('tax.rate')}</TableHead>
									<TableHead>{t('tax.priority')}</TableHead>
									<TableHead>{t('tax.active')}</TableHead>
									<TableHead>{t('tax.updated2')}</TableHead>
									<TableHead>{t('tax.actions')}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{ruleSets.length === 0 ? (
									<TableRow>
										<TableCell colSpan={7} className="text-sm text-muted-foreground">
											{t('tax.noRulesAreAttachedToThisGroupYet')}
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
								<Button
									variant="primary"
									className="min-w-40"
									onClick={() => setIsCreateRuleOpen(true)}
									disabled={isCreating}
								>
									<Plus className="h-4 w-4" />
									{t('tax.addRule')}
								</Button>
							</div>
						) : null}

						{isCreateRuleOpen ? (
							<div className="space-y-3 rounded-md border border-border p-3">
								<div className="text-sm font-medium">{t('tax.newRule')}</div>
								<RuleFormFields form={createRuleForm} onChange={setCreateRuleForm} />
								<div className="flex items-center justify-end gap-2">
									<Button
										variant="primary"
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
										{isCreating ? t('tax.creating') : t('tax.createRule')}
									</Button>
									<Button
										variant="cancel"
										showIcon={false}
										disabled={isCreating}
										onClick={() => {
											setIsCreateRuleOpen(false)
											setCreateRuleForm(defaultRuleFormState())
										}}
									>
										{t('tax.cancel')}
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
