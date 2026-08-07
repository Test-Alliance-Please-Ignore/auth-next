import { useEffect, useMemo, useState } from 'react'

import {
	RuleGroupCorporationAttachmentsCard,
	RuleGroupScopeCard,
	RuleSetListCard,
} from '@/components/tax-rules'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { useCorporationAccess } from '@/features/corporations'
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
} from '@/hooks/corporation-tax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'

export default function TaxRulesPage() {
	usePageTitle('Tax Rules')

	const { data: globalCapabilities } = useTaxCapabilities()
	const canManage = globalCapabilities?.global.canManage ?? false

	const { data: corporationAccess } = useCorporationAccess()
	const { data: taxCorporations = [] } = useTaxCorporations({ limit: 1000, enabled: canManage })
	const {
		data: ruleGroups = [],
		isLoading: ruleGroupsLoading,
		error: ruleGroupsError,
	} = useTaxRuleGroups({ limit: 300, enabled: canManage })

	const [selectedRuleGroupId, setSelectedRuleGroupId] = useState<string | undefined>(undefined)
	const effectiveRuleGroupId = selectedRuleGroupId ?? ruleGroups[0]?.id

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

	useEffect(() => {
		if (selectedRuleGroupId || ruleGroups.length === 0) return
		const defaultGlobalGroup = ruleGroups.find((group) => group.isDefaultGlobal) ?? ruleGroups[0]
		setSelectedRuleGroupId(defaultGlobalGroup?.id)
	}, [selectedRuleGroupId, ruleGroups])

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
		for (const corp of taxCorporations) ids.add(corp.corporationId)
		for (const attachment of attachments) ids.add(attachment.corporationId)
		return Array.from(ids)
	}, [corporationAccess?.corporations, taxCorporations, attachments])

	const { data: entityNames = {} } = useEntityNames(corporationIdsForNameLookup, {
		enabled: canManage && corporationIdsForNameLookup.length > 0,
	})

	const corporationNameById = useMemo(() => {
		const map = new Map<string, string>()
		for (const corp of corporationAccess?.corporations ?? []) map.set(corp.corporationId, corp.name)
		for (const corp of taxCorporations) {
			if (!map.has(corp.corporationId)) {
				map.set(corp.corporationId, entityNames[corp.corporationId] ?? corp.corporationId)
			}
		}
		for (const [id, name] of Object.entries(entityNames)) {
			if (!map.has(id)) map.set(id, name)
		}
		return map
	}, [corporationAccess?.corporations, taxCorporations, entityNames])

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
				<RuleGroupScopeCard
					ruleGroups={ruleGroups}
					selectedRuleGroupId={effectiveRuleGroupId}
					ruleGroupsLoading={ruleGroupsLoading}
					ruleGroupsError={ruleGroupsError}
					isCreating={createRuleGroupMutation.isPending}
					isUpdating={updateRuleGroupMutation.isPending}
					isDeleting={deleteRuleGroupMutation.isPending}
					onSelectRuleGroup={setSelectedRuleGroupId}
					onCreateGroup={async (name) => {
						const created = await createRuleGroupMutation.mutateAsync({ name })
						setSelectedRuleGroupId(created.id)
					}}
					onUpdateGroup={(ruleGroupId, updates) =>
						updateRuleGroupMutation.mutateAsync({ ruleGroupId, updates })
					}
					onDeleteGroup={async (ruleGroupId) => {
						await deleteRuleGroupMutation.mutateAsync(ruleGroupId)
						setSelectedRuleGroupId(undefined)
					}}
				/>

				<RuleGroupCorporationAttachmentsCard
					effectiveRuleGroupId={effectiveRuleGroupId}
					attachments={attachments}
					excludeCorporationIds={excludedCorporationIdSet}
					resolveCorporationName={(corporationId) =>
						corporationNameById.get(corporationId) ?? entityNames[corporationId] ?? corporationId
					}
					isAttaching={attachMutation.isPending}
					isDetaching={detachMutation.isPending}
					onAttach={(input) => attachMutation.mutateAsync(input)}
					onDetach={(input) => detachMutation.mutateAsync(input)}
				/>

				<RuleSetListCard
					effectiveRuleGroupId={effectiveRuleGroupId}
					ruleSets={ruleSets}
					ruleSetsLoading={ruleSetsLoading}
					ruleSetsError={ruleSetsError}
					canManage={canManage}
					isCreating={createRuleMutation.isPending}
					isUpdating={updateRuleMutation.isPending}
					isDeleting={deleteRuleMutation.isPending}
					onCreateRule={(ruleSet) => createRuleMutation.mutateAsync({ ruleSet })}
					onUpdateRule={(ruleSetId, updates) =>
						updateRuleMutation.mutateAsync({ ruleSetId, updates })
					}
					onDeleteRule={(ruleSetId) => deleteRuleMutation.mutateAsync(ruleSetId)}
				/>
			</Section>
		</Container>
	)
}
