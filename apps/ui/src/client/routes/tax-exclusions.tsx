import { Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useCorporationAccess } from '@/features/corporations'
import {
	useDeleteTaxExclusion,
	useTaxCapabilities,
	useTaxCorporations,
	useTaxExclusions,
	useUpsertTaxExclusion,
} from '@/hooks/corporation-tax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'

export default function TaxExclusionsPage() {
	const { t } = useAppTranslation()

	usePageTitle(t('tax.taxExclusions'))

	const { data: globalCapabilities } = useTaxCapabilities()
	const canManage = globalCapabilities?.global.canManage ?? false
	const { data: corporationAccess } = useCorporationAccess()
	const { data: taxCorporations = [] } = useTaxCorporations({
		limit: 1000,
		enabled: canManage,
	})
	const {
		data: exclusions = [],
		isLoading: exclusionsLoading,
		error: exclusionsError,
	} = useTaxExclusions({ limit: 200, enabled: canManage })
	const upsertMutation = useUpsertTaxExclusion()
	const deleteMutation = useDeleteTaxExclusion()

	const [selectedCorporationId, setSelectedCorporationId] = useState('')
	const [selectedCorporationQuery, setSelectedCorporationQuery] = useState('')
	const [reason, setReason] = useState('')

	const exclusionMap = useMemo(
		() => new Map(exclusions.map((row) => [row.corporationId, row.reason ?? null] as const)),
		[exclusions, t]
	)
	const allCorporationIds = useMemo(() => {
		const ids = new Set<string>()
		for (const corp of corporationAccess?.corporations ?? []) ids.add(corp.corporationId)
		for (const corp of taxCorporations) ids.add(corp.corporationId)
		for (const row of exclusions) ids.add(row.corporationId)
		return Array.from(ids)
	}, [corporationAccess?.corporations, taxCorporations, exclusions, t])

	const unresolvedCorporationIds = useMemo(() => {
		const accessIdSet = new Set(
			(corporationAccess?.corporations ?? []).map((corp) => corp.corporationId)
		)
		return allCorporationIds.filter((corporationId) => !accessIdSet.has(corporationId))
	}, [allCorporationIds, corporationAccess?.corporations, t])

	const { data: resolvedCorporationNames = {} } = useEntityNames(unresolvedCorporationIds, {
		enabled: canManage && unresolvedCorporationIds.length > 0,
	})

	const corporationNameById = useMemo(() => {
		const map = new Map<string, string>()
		for (const corp of corporationAccess?.corporations ?? []) {
			map.set(corp.corporationId, corp.name)
		}
		for (const corporationId of allCorporationIds) {
			if (!map.has(corporationId)) {
				map.set(
					corporationId,
					resolvedCorporationNames[corporationId] ??
						t('tax.corporationValue1', { value1: corporationId })
				)
			}
		}
		return map
	}, [corporationAccess?.corporations, allCorporationIds, resolvedCorporationNames, t])

	const excludedCorporations = useMemo(
		() =>
			exclusions.map((row) => ({ corporationId: row.corporationId, exclusionReason: row.reason })),
		[exclusions, t]
	)
	const selectableCorporations = useMemo(
		() =>
			allCorporationIds
				.filter((corporationId) => !exclusionMap.has(corporationId))
				.map((corporationId) => ({
					corporationId,
				})),
		[allCorporationIds, exclusionMap, t]
	)

	const selectableOptions = useMemo(
		() =>
			selectableCorporations.map((corporation) => {
				const corporationId = corporation.corporationId
				const name =
					corporationNameById.get(corporationId) ??
					t('tax.corporationValue1', { value1: corporationId })
				return { value: corporationId, label: name, description: corporationId }
			}),
		[corporationNameById, selectableCorporations, t]
	)

	if (!canManage) {
		return (
			<Container>
				<Card>
					<CardHeader>
						<CardTitle>{t('tax.taxExclusions')}</CardTitle>
						<CardDescription>
							{t('tax.youDoNotHavePermissionToManageTaxExclusions')}
						</CardDescription>
					</CardHeader>
				</Card>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title={t('tax.taxExclusions')}
				description={t('tax.excludeMemberCorporationsFromTaxScopeCalculationsRegardlessOfRule')}
			/>

			<Section>
				<Card>
					<CardHeader>
						<CardTitle>{t('tax.addExclusion')}</CardTitle>
						<CardDescription>{t('tax.selectACorporationProvideAReasonAndAddItTo')}</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
						<div className="space-y-2">
							<div className="text-sm font-medium">{t('tax.corporation')}</div>
							<Select
								value={selectedCorporationId}
								onValueChange={(nextValue) => {
									setSelectedCorporationId(nextValue)
								}}
								query={selectedCorporationQuery}
								onQueryChange={setSelectedCorporationQuery}
								searchable
								options={selectableOptions}
								placeholder={t('tax.searchCorporation')}
								emptyText={t('tax.noCorporationsAvailable')}
								listMinHeight="10rem"
								listMaxHeight="18rem"
							/>
						</div>
						<div className="space-y-2">
							<div className="text-sm font-medium">{t('tax.exclusionReason')}</div>
							<Input
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								placeholder={t('tax.reasonForExclusion')}
								disabled={!selectedCorporationId}
							/>
						</div>
						<Button
							variant="primary"
							type="button"
							onClick={() => {
								if (!selectedCorporationId) return
								upsertMutation.mutate(
									{
										corporationId: selectedCorporationId,
										reason: reason.trim() || null,
									},
									{
										onSuccess: () => {
											setSelectedCorporationId('')
											setSelectedCorporationQuery('')
											setReason('')
										},
									}
								)
							}}
							disabled={!selectedCorporationId || upsertMutation.isPending}
						>
							{t('tax.add')}
						</Button>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>{t('tax.excludedCorporations')}</CardTitle>
						<CardDescription>
							{t('tax.corporationsExcludedFromTaxScopeRuleAttachmentsRemainVisibleBut')}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{exclusionsLoading ? (
							<div className="text-sm text-muted-foreground">{t('tax.loadingExclusions')}</div>
						) : exclusionsError ? (
							<div className="text-sm text-destructive">
								{exclusionsError instanceof Error
									? exclusionsError.message
									: t('tax.failedToLoadExclusions')}
							</div>
						) : (
							<div className="rounded-md border">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>{t('tax.corporation')}</TableHead>
											<TableHead>{t('tax.exclusionReason')}</TableHead>
											<TableHead className="w-[80px] text-right">{t('tax.actions')}</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{excludedCorporations.length === 0 ? (
											<TableRow>
												<TableCell colSpan={3} className="text-center text-muted-foreground">
													{t('tax.noExcludedCorporationsConfigured')}
												</TableCell>
											</TableRow>
										) : (
											excludedCorporations.map((corporation) => {
												const corporationId = corporation.corporationId
												const corporationName =
													corporationNameById.get(corporationId) ??
													t('tax.corporationValue1', { value1: corporationId })
												return (
													<TableRow key={corporationId}>
														<TableCell>
															<div className="leading-tight">
																<div>{corporationName}</div>
																<div className="font-mono text-xs text-muted-foreground">
																	{corporationId}
																</div>
															</div>
														</TableCell>
														<TableCell>{corporation.exclusionReason ?? '-'}</TableCell>
														<TableCell className="text-right">
															<Button
																type="button"
																variant="ghost"
																size="icon"
																aria-label={t('tax.removeExclusionForValue1', {
																	value1: corporationName,
																})}
																onClick={() => deleteMutation.mutate(corporationId)}
																disabled={deleteMutation.isPending}
															>
																<Trash2 className="h-4 w-4" />
															</Button>
														</TableCell>
													</TableRow>
												)
											})
										)}
									</TableBody>
								</Table>
							</div>
						)}
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
