import { X } from 'lucide-react'
import { useMemo } from 'react'

import { CorporationSearchSelect } from '@/components/corporation-search-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppTranslation } from '@/i18n'

import type { TaxRuleGroupAttachment } from '@repo/corporation-tax'

export function RuleGroupCorporationAttachmentsCard({
	effectiveRuleGroupId,
	attachments,
	excludeCorporationIds,
	resolveCorporationName,
	isAttaching,
	isDetaching,
	onAttach,
	onDetach,
}: {
	effectiveRuleGroupId?: string
	attachments: TaxRuleGroupAttachment[]
	excludeCorporationIds?: Set<string>
	resolveCorporationName: (corporationId: string) => string
	isAttaching: boolean
	isDetaching: boolean
	onAttach: (input: { ruleGroupId: string; corporationId: string }) => Promise<unknown> | void
	onDetach: (input: { ruleGroupId: string; corporationId: string }) => Promise<unknown> | void
}) {
	const { t } = useAppTranslation()

	const attachedIds = useMemo(
		() => new Set(attachments.map((attachment) => attachment.corporationId)),
		[attachments, t]
	)

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('tax.corporationsInScope')}</CardTitle>
				<CardDescription>
					{t('tax.attachCorporationsToTheSelectedRuleGroupScopeAttachedCorporations')}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{!effectiveRuleGroupId ? (
					<div className="text-sm text-muted-foreground">{t('tax.selectARuleGroupFirst')}</div>
				) : (
					<>
						<CorporationSearchSelect
							value=""
							excludeCorporationIds={
								excludeCorporationIds
									? new Set([...attachedIds, ...excludeCorporationIds])
									: attachedIds
							}
							onValueChange={(nextValue) => {
								void onAttach({
									ruleGroupId: effectiveRuleGroupId,
									corporationId: nextValue,
								})
							}}
							placeholder={t('tax.attachCorporationByNameOrId')}
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
											? t('tax.excludedValue1', {
													value1: attachment.exclusionReason ?? t('tax.noReason'),
												})
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
