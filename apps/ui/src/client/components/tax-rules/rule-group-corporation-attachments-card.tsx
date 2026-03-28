import { X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'

import type { TaxRuleGroupAttachment } from '@repo/corporation-tax'
import type { SelectOption } from '@/components/ui/select'

export function RuleGroupCorporationAttachmentsCard({
	effectiveRuleGroupId,
	attachments,
	corporationSearchOptions,
	resolveCorporationName,
	isAttaching,
	isDetaching,
	onAttach,
	onDetach,
}: {
	effectiveRuleGroupId?: string
	attachments: TaxRuleGroupAttachment[]
	corporationSearchOptions: SelectOption[]
	resolveCorporationName: (corporationId: string) => string
	isAttaching: boolean
	isDetaching: boolean
	onAttach: (input: { ruleGroupId: string; corporationId: string }) => Promise<unknown> | void
	onDetach: (input: { ruleGroupId: string; corporationId: string }) => Promise<unknown> | void
}) {
	const [corpAttachQuery, setCorpAttachQuery] = useState('')

	const attachedIds = useMemo(
		() => new Set(attachments.map((attachment) => attachment.corporationId)),
		[attachments]
	)
	const attachableCorporationOptions = useMemo(
		() => corporationSearchOptions.filter((option) => !attachedIds.has(option.value)),
		[attachedIds, corporationSearchOptions]
	)

	return (
		<Card>
			<CardHeader>
				<CardTitle>Corporations In Scope</CardTitle>
				<CardDescription>
					Attach corporations to the selected rule group scope. Attached corporations inherit this
					group&apos;s rules.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{!effectiveRuleGroupId ? (
					<div className="text-sm text-muted-foreground">Select a rule group first.</div>
				) : (
					<>
						<Select
							value=""
							onValueChange={(nextValue) => {
								setCorpAttachQuery('')
								void onAttach({
									ruleGroupId: effectiveRuleGroupId,
									corporationId: nextValue,
								})
							}}
							query={corpAttachQuery}
							onQueryChange={setCorpAttachQuery}
							searchable
							options={attachableCorporationOptions}
							placeholder="Attach corporation by name or ID"
							emptyText="No matching corporations"
							disabled={isAttaching}
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
									{resolveCorporationName(attachment.corporationId)}
									<Button
										variant="ghost"
										size="sm"
										className="h-5 px-1"
										disabled={isDetaching}
										onClick={() =>
											void onDetach({
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
	)
}
