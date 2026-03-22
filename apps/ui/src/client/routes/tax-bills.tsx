import { useEffect, useMemo, useState } from 'react'

import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { DateRangeInput } from '@/components/ui/date-range-input'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { SearchSelect } from '@/components/ui/search-select'
import { Section } from '@/components/ui/section'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import {
	useCreateTaxBillForAssessment,
	useCreateTaxBillingConfig,
	useDeleteTaxBillingConfig,
	useIssueTaxBillsForPeriod,
	useRetractTaxAssessmentBill,
	useSearchTaxBillingPayeeCharacters,
	useSearchTaxBillingPayeeCorporations,
	useSetDefaultTaxBillingConfig,
	useSyncTaxAssessmentBillStatus,
	useSyncTaxCorporationBillStatuses,
	useTaxAssessments,
	useTaxBillingConfigs,
	useTaxBillStatusReport,
	useTaxCapabilities,
	useTaxCorporationBillHistory,
	useUpdateTaxBillingConfig,
} from '@/hooks/useCorporationTax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaxCorporationAccessScope } from '@/hooks/useTaxCorporationAccessScope'
import { formatTaxDateTime, getCurrentMonthDateRange } from '@/lib/tax-date'
import { formatTaxIskFull, formatTaxNumber, TaxEntityDisplay } from '@/lib/tax-display'

import type { TaxAssessmentScope, TaxBillingPayeeType, TaxBillStatus } from '@repo/corporation-tax'

function getLastTimelineDate(events: Array<{ createdAt: string | Date }>): string {
	if (events.length === 0) {
		return '-'
	}

	const latest = events.reduce((acc, current) => {
		return new Date(current.createdAt) > new Date(acc.createdAt) ? current : acc
	}, events[0]!)
	return formatTaxDateTime(latest.createdAt)
}

function billStatusBadgeVariant(
	status: TaxBillStatus | 'unbilled' | 'underpaid' | 'overpaid'
): 'default' | 'success' | 'warning' | 'destructive' | 'outline' {
	if (status === 'overdue') {
		return 'destructive'
	}
	if (status === 'paid') {
		return 'success'
	}
	if (status === 'underpaid') {
		return 'warning'
	}
	if (status === 'overpaid') {
		return 'warning'
	}
	if (status === 'issued') {
		return 'default'
	}
	return 'outline'
}

const DEFAULT_MONTH_RANGE = getCurrentMonthDateRange()
const BILL_STATUS_PAGE_SIZE_DEFAULT = 25

export default function TaxBillsPage() {
	usePageTitle('Tax Billing')

	const { data: globalCapabilities } = useTaxCapabilities()
	const canViewWithUrn = globalCapabilities?.global.canAudit ?? false
	const {
		corporationAccessLoading,
		accessibleCorporations,
		selectedCorporationId,
		setSelectedCorporationId,
		effectiveCorporationId,
	} = useTaxCorporationAccessScope(canViewWithUrn)
	const [periodStartDate, setPeriodStartDate] = useState(DEFAULT_MONTH_RANGE.fromDate)
	const [periodEndDate, setPeriodEndDate] = useState(DEFAULT_MONTH_RANGE.toDate)
	const [billStatusPage, setBillStatusPage] = useState(0)
	const [billStatusPageSize, setBillStatusPageSize] = useState(BILL_STATUS_PAGE_SIZE_DEFAULT)
	const [selectedAssessmentScope, setSelectedAssessmentScope] = useState<
		'all' | TaxAssessmentScope
	>('all')
	const [retractingAssessmentId, setRetractingAssessmentId] = useState<string | null>(null)
	const [editingBillingConfigId, setEditingBillingConfigId] = useState<string | null>(null)
	const [billingEnabledInput, setBillingEnabledInput] = useState(false)
	const [billingIssuerUserIdInput, setBillingIssuerUserIdInput] = useState('')
	const [billingPayeeIdInput, setBillingPayeeIdInput] = useState('')
	const [billingCharacterSearchInput, setBillingCharacterSearchInput] = useState('')
	const [billingCharacterSearchDebounced, setBillingCharacterSearchDebounced] = useState('')
	const [billingCorporationSearchInput, setBillingCorporationSearchInput] = useState('')
	const [billingCorporationSearchDebounced, setBillingCorporationSearchDebounced] = useState('')
	const [billingPayeeTypeInput, setBillingPayeeTypeInput] = useState<TaxBillingPayeeType>()
	const [billingDueDaysInput, setBillingDueDaysInput] = useState('14')
	const [billingIsDefaultInput, setBillingIsDefaultInput] = useState(false)
	const [billingConfigValidationError, setBillingConfigValidationError] = useState<string | null>(
		null
	)
	const [showBillingConfigForm, setShowBillingConfigForm] = useState(false)
	const { data: billingCharacterSearchResults = [], isLoading: billingCharacterSearchLoading } =
		useSearchTaxBillingPayeeCharacters(
			effectiveCorporationId,
			billingCharacterSearchDebounced,
			billingPayeeTypeInput === 'character'
		)
	const { data: billingCorporationSearchResults = [], isLoading: billingCorporationSearchLoading } =
		useSearchTaxBillingPayeeCorporations(
			effectiveCorporationId,
			billingCorporationSearchDebounced,
			billingPayeeTypeInput === 'corporation'
		)

	useEffect(() => {
		if (billingPayeeTypeInput !== 'character') {
			setBillingCharacterSearchDebounced('')
			return
		}
		const timer = setTimeout(() => {
			setBillingCharacterSearchDebounced(billingCharacterSearchInput.trim())
		}, 300)
		return () => clearTimeout(timer)
	}, [billingCharacterSearchInput, billingPayeeTypeInput])

	useEffect(() => {
		if (billingPayeeTypeInput !== 'corporation') {
			setBillingCorporationSearchDebounced('')
			return
		}
		const timer = setTimeout(() => {
			setBillingCorporationSearchDebounced(billingCorporationSearchInput.trim())
		}, 300)
		return () => clearTimeout(timer)
	}, [billingCorporationSearchInput, billingPayeeTypeInput])

	const { data: scopedCapabilities, isLoading: scopedCapabilitiesLoading } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canViewScoped = scopedCapabilities?.scoped.canAudit ?? false
	const canView = canViewWithUrn || canViewScoped
	const canIssue =
		(globalCapabilities?.global.canManage ?? false) ||
		(scopedCapabilities?.scoped.canManage ?? false)

	const {
		data: billStatusReportData,
		isLoading: billStatusLoading,
		error: billStatusError,
	} = useTaxBillStatusReport({
		corporationId: effectiveCorporationId,
		limit: billStatusPageSize,
		offset: billStatusPage * billStatusPageSize,
		sortBy: 'dueDate',
		sortDir: 'asc',
		enabled: canView,
	})

	const {
		data: billHistory = [],
		isLoading: billHistoryLoading,
		error: billHistoryError,
	} = useTaxCorporationBillHistory(effectiveCorporationId, {
		limit: 50,
		enabled: canView,
	})

	const {
		data: assessments = [],
		isLoading: assessmentsLoading,
		error: assessmentsError,
	} = useTaxAssessments(effectiveCorporationId, {
		limit: 500,
		enabled: canView,
	})

	const createBillMutation = useCreateTaxBillForAssessment()
	const createBillingConfigMutation = useCreateTaxBillingConfig()
	const updateBillingConfigMutation = useUpdateTaxBillingConfig()
	const deleteBillingConfigMutation = useDeleteTaxBillingConfig()
	const setDefaultBillingConfigMutation = useSetDefaultTaxBillingConfig()
	const syncAssessmentMutation = useSyncTaxAssessmentBillStatus()
	const retractAssessmentMutation = useRetractTaxAssessmentBill()
	const issuePeriodMutation = useIssueTaxBillsForPeriod()
	const syncCorporationMutation = useSyncTaxCorporationBillStatuses()
	const {
		data: billingConfigs = [],
		isLoading: billingConfigsLoading,
		error: billingConfigsError,
	} = useTaxBillingConfigs(effectiveCorporationId, canView)

	const corporationAssessments = assessments.filter(
		(assessment) => assessment.assessmentScope === 'corporation'
	)
	const billStatusReportRows = billStatusReportData?.rows ?? []
	const billStatusTotalRows = billStatusReportData?.totalRows ?? 0
	const billStatusPageCount = Math.max(1, Math.ceil(billStatusTotalRows / billStatusPageSize))
	const totalAssessments = corporationAssessments.length
	const unbilledAssessmentRows = corporationAssessments.filter(
		(assessment) =>
			!assessment.billId && assessment.status !== 'draft' && assessment.status !== 'excluded'
	)
	const unbilledAssessmentCount = unbilledAssessmentRows.length
	const overdueAssessments = corporationAssessments.filter(
		(assessment) => assessment.billStatus === 'overdue'
	).length
	const scopeCounts = {
		corporation: assessments.filter((assessment) => assessment.assessmentScope === 'corporation')
			.length,
		division: assessments.filter((assessment) => assessment.assessmentScope === 'division').length,
		character: assessments.filter((assessment) => assessment.assessmentScope === 'character')
			.length,
	}
	const scopedAssessmentRows =
		selectedAssessmentScope === 'all'
			? assessments
			: assessments.filter((assessment) => assessment.assessmentScope === selectedAssessmentScope)

	const entityIds = useMemo(() => {
		const ids = new Set<string>()
		for (const row of billStatusReportRows) ids.add(row.corporationId)
		for (const row of billHistory) ids.add(row.assessment.corporationId)
		for (const config of billingConfigs) {
			if (config.billingPayeeId) ids.add(config.billingPayeeId)
		}
		for (const assessment of assessments) {
			ids.add(assessment.corporationId)
			if (assessment.assessmentScope === 'character') ids.add(assessment.scopeId)
		}
		return [...ids]
	}, [assessments, billHistory, billStatusReportRows, billingConfigs])

	useEffect(() => {
		setBillStatusPage(0)
	}, [effectiveCorporationId])

	const { data: entityNames = {} } = useEntityNames(entityIds, { enabled: canView })
	const retractableAssessment = billHistory.find(
		(row) => row.assessment.id === retractingAssessmentId
	)?.assessment
	const isCreatingFirstBillingConfig =
		showBillingConfigForm &&
		!editingBillingConfigId &&
		Boolean(effectiveCorporationId) &&
		billingConfigs.length === 0
	const parsedBillingDueDays = Number.parseInt(billingDueDaysInput, 10)
	const isBillingDueDaysValid =
		billingDueDaysInput.trim().length > 0 &&
		Number.isInteger(parsedBillingDueDays) &&
		parsedBillingDueDays >= 1 &&
		parsedBillingDueDays <= 90
	const isBillingPayeeSelectionValid = Boolean(
		billingPayeeTypeInput && billingPayeeIdInput.trim().length > 0
	)

	useEffect(() => {
		if (isCreatingFirstBillingConfig) {
			setBillingIsDefaultInput(true)
		}
	}, [isCreatingFirstBillingConfig])

	const resetBillingConfigForm = () => {
		setEditingBillingConfigId(null)
		setShowBillingConfigForm(false)
		setBillingEnabledInput(false)
		setBillingIssuerUserIdInput('')
		setBillingPayeeIdInput('')
		setBillingCharacterSearchInput('')
		setBillingCharacterSearchDebounced('')
		setBillingCorporationSearchInput('')
		setBillingCorporationSearchDebounced('')
		setBillingPayeeTypeInput(undefined)
		setBillingDueDaysInput('14')
		setBillingIsDefaultInput(false)
		setBillingConfigValidationError(null)
	}

	if (!corporationAccessLoading && !scopedCapabilitiesLoading && !canView) {
		return (
			<Container>
				<Card>
					<CardHeader>
						<CardTitle>Tax Billing</CardTitle>
						<CardDescription>You do not have permission to view tax billing data.</CardDescription>
					</CardHeader>
				</Card>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title="Tax Billing"
				description="View tax assessment bill status rollups and bill timeline history by corporation."
			/>

			<Section>
				<TaxCorporationScopeSelector
					corporations={accessibleCorporations}
					effectiveCorporationId={effectiveCorporationId}
					selectedCorporationId={selectedCorporationId}
					canSelectAll={canViewWithUrn}
					onSelect={setSelectedCorporationId}
				/>

				<div className="grid gap-4 md:grid-cols-3">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Assessments in View</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">{totalAssessments}</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Unbilled Assessments</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">{unbilledAssessmentCount}</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Overdue Assessments</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">{overdueAssessments}</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>Billing Configuration</CardTitle>
						<CardDescription>
							Configure issuer, payee, due days, and default billing profile for the selected
							corporation.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{!effectiveCorporationId ? (
							<div className="text-sm text-muted-foreground">
								Select a corporation to configure billing.
							</div>
						) : (
							<>
								{billingConfigsLoading ? (
									<div className="text-sm text-muted-foreground">Loading billing configs...</div>
								) : billingConfigsError ? (
									<div className="text-sm text-destructive">
										{billingConfigsError instanceof Error
											? billingConfigsError.message
											: 'Failed to load billing configurations'}
									</div>
								) : (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Default</TableHead>
												<TableHead>Enabled</TableHead>
												<TableHead>Payee</TableHead>
												<TableHead>Issuer</TableHead>
												<TableHead>Due Days</TableHead>
												{canIssue ? <TableHead>Actions</TableHead> : null}
											</TableRow>
										</TableHeader>
										<TableBody>
											{billingConfigs.length === 0 ? (
												<TableRow>
													<TableCell
														colSpan={canIssue ? 6 : 5}
														className="text-sm text-muted-foreground"
													>
														No billing configs yet. Create one below.
													</TableCell>
												</TableRow>
											) : (
												billingConfigs.map((config) => (
													<TableRow key={config.id}>
														<TableCell>
															{config.isDefault ? <Badge variant="default">default</Badge> : '-'}
														</TableCell>
														<TableCell>{config.billingEnabled ? 'yes' : 'no'}</TableCell>
														<TableCell>
															{config.billingPayeeType && config.billingPayeeId ? (
																<div className="space-y-1">
																	<Badge variant="outline" className="capitalize">
																		{config.billingPayeeType}
																	</Badge>
																	<TaxEntityDisplay
																		entityId={config.billingPayeeId}
																		entityNames={entityNames}
																	/>
																</div>
															) : (
																'-'
															)}
														</TableCell>
														<TableCell>{config.billingIssuerUserId || '-'}</TableCell>
														<TableCell>{config.billingDueDays}</TableCell>
														{canIssue ? (
															<TableCell>
																<div className="flex items-center gap-2">
																	<Button
																		size="sm"
																		variant="outline"
																		disabled={!canIssue}
																		onClick={() => {
																			setBillingConfigValidationError(null)
																			setShowBillingConfigForm(true)
																			setEditingBillingConfigId(config.id)
																			setBillingEnabledInput(config.billingEnabled)
																			setBillingIssuerUserIdInput(config.billingIssuerUserId)
																			setBillingPayeeIdInput(config.billingPayeeId)
																			setBillingCharacterSearchInput(
																				config.billingPayeeType === 'character'
																					? (entityNames[config.billingPayeeId] ??
																							config.billingPayeeId)
																					: ''
																			)
																			setBillingCorporationSearchInput(
																				config.billingPayeeType === 'corporation'
																					? (entityNames[config.billingPayeeId] ??
																							config.billingPayeeId)
																					: ''
																			)
																			setBillingPayeeTypeInput(config.billingPayeeType)
																			setBillingDueDaysInput(String(config.billingDueDays))
																			setBillingIsDefaultInput(config.isDefault)
																		}}
																	>
																		Edit
																	</Button>
																	<Button
																		size="sm"
																		variant="outline"
																		disabled={!canIssue || config.isDefault}
																		onClick={() => {
																			if (!effectiveCorporationId) return
																			setDefaultBillingConfigMutation.mutate({
																				corporationId: effectiveCorporationId,
																				configId: config.id,
																			})
																		}}
																	>
																		Set Default
																	</Button>
																	<Button
																		size="sm"
																		variant="outline"
																		disabled={!canIssue || config.isDefault}
																		onClick={() => {
																			if (!effectiveCorporationId) return
																			deleteBillingConfigMutation.mutate({
																				corporationId: effectiveCorporationId,
																				configId: config.id,
																			})
																		}}
																	>
																		Delete
																	</Button>
																</div>
															</TableCell>
														) : null}
													</TableRow>
												))
											)}
										</TableBody>
									</Table>
								)}

								{canIssue && !showBillingConfigForm ? (
									<div className="flex justify-center pt-2">
										<Button
											variant="outline"
											className="min-w-40"
											onClick={() => {
												resetBillingConfigForm()
												setShowBillingConfigForm(true)
											}}
										>
											Add Config
										</Button>
									</div>
								) : null}
								{canIssue && showBillingConfigForm ? (
									<>
										<div className="grid gap-3 md:grid-cols-2">
											<div className="space-y-2">
												<Label>
													Payee Type <span className="text-destructive">*</span>
												</Label>
												<Select
													value={billingPayeeTypeInput}
													onValueChange={(value) => {
														const nextType = value as TaxBillingPayeeType
														setBillingConfigValidationError(null)
														setBillingPayeeTypeInput(nextType)
														if (nextType !== 'character') {
															setBillingCharacterSearchInput('')
														}
														if (nextType !== 'corporation') {
															setBillingCorporationSearchInput('')
														}
														setBillingPayeeIdInput('')
													}}
												>
													<SelectTrigger>
														<SelectValue placeholder="Select payee type" />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="character">Character</SelectItem>
														<SelectItem value="corporation">Corporation</SelectItem>
													</SelectContent>
												</Select>
											</div>
											<div className="space-y-2">
												<Label>
													{billingPayeeTypeInput === 'character'
														? 'Character'
														: billingPayeeTypeInput === 'corporation'
															? 'Corporation'
															: 'Payee'}{' '}
													<span className="text-destructive">*</span>
												</Label>
												{billingPayeeTypeInput === 'character' ? (
													<SearchSelect
														value={billingCharacterSearchInput}
														onValueChange={(value) => {
															setBillingConfigValidationError(null)
															setBillingCharacterSearchInput(value)
															setBillingPayeeIdInput('')
														}}
														options={billingCharacterSearchResults.map((character) => ({
															id: character.characterId,
															value: character.characterName,
															label: character.characterName,
															description: character.characterId,
														}))}
														onSelect={(option) => {
															setBillingConfigValidationError(null)
															setBillingCharacterSearchInput(option.label)
															setBillingPayeeIdInput(option.id)
														}}
														filterMode="server"
														minQueryLength={2}
														placeholder="Character name or ID"
														loading={
															billingCharacterSearchInput.trim().length >= 2 &&
															(billingCharacterSearchLoading ||
																billingCharacterSearchInput.trim() !==
																	billingCharacterSearchDebounced)
														}
														minCharsText="Type at least 2 characters"
														loadingText="Searching characters..."
														emptyText="No matching characters found"
													/>
												) : billingPayeeTypeInput === 'corporation' ? (
													<SearchSelect
														value={billingCorporationSearchInput}
														onValueChange={(value) => {
															setBillingConfigValidationError(null)
															setBillingCorporationSearchInput(value)
															setBillingPayeeIdInput('')
														}}
														options={billingCorporationSearchResults.map((corporation) => ({
															id: corporation.corporationId,
															value: corporation.name ?? corporation.corporationId,
															label: corporation.name ?? corporation.corporationId,
															description: corporation.corporationId,
														}))}
														onSelect={(option) => {
															setBillingConfigValidationError(null)
															setBillingCorporationSearchInput(option.label)
															setBillingPayeeIdInput(option.id)
														}}
														filterMode="server"
														minQueryLength={2}
														placeholder="Corporation name or ID"
														loading={
															billingCorporationSearchInput.trim().length >= 2 &&
															(billingCorporationSearchLoading ||
																billingCorporationSearchInput.trim() !==
																	billingCorporationSearchDebounced)
														}
														minCharsText="Type at least 2 characters"
														loadingText="Searching corporations..."
														emptyText="No matching corporations found"
													/>
												) : (
													<Input value="" disabled placeholder="Select payee type first" />
												)}
											</div>
											<div className="space-y-2">
												<Label>Issuer User ID (optional)</Label>
												<Input
													value={billingIssuerUserIdInput}
													onChange={(event) => setBillingIssuerUserIdInput(event.target.value)}
													placeholder="Defaults to acting user"
												/>
											</div>
											<div className="space-y-2">
												<Label>
													Due Days <span className="text-destructive">*</span>
												</Label>
												<Input
													type="number"
													min={1}
													max={90}
													required
													value={billingDueDaysInput}
													onChange={(event) => {
														setBillingConfigValidationError(null)
														setBillingDueDaysInput(event.target.value)
													}}
												/>
												{!isBillingDueDaysValid ? (
													<div className="text-xs text-destructive">
														Due days is required and must be an integer between 1 and 90.
													</div>
												) : null}
											</div>
										</div>
										<div className="flex flex-wrap items-center gap-6">
											<div className="flex items-center gap-2">
												<Switch
													checked={billingEnabledInput}
													onCheckedChange={setBillingEnabledInput}
												/>
												<Label>Billing enabled</Label>
											</div>
											<div className="flex items-center gap-2">
												<Switch
													checked={isCreatingFirstBillingConfig ? true : billingIsDefaultInput}
													disabled={isCreatingFirstBillingConfig}
													onCheckedChange={setBillingIsDefaultInput}
												/>
												<Label>Set as default payee</Label>
											</div>
										</div>
										{billingConfigValidationError ? (
											<div className="text-xs text-destructive">{billingConfigValidationError}</div>
										) : null}
										{isCreatingFirstBillingConfig ? (
											<div className="text-xs text-muted-foreground">
												First billing config for this corporation is automatically set as default.
											</div>
										) : null}
										<div className="flex items-center justify-end gap-2">
											<Button variant="outline" onClick={resetBillingConfigForm}>
												Cancel
											</Button>
											<Button
												disabled={
													!canIssue ||
													createBillingConfigMutation.isPending ||
													updateBillingConfigMutation.isPending ||
													!effectiveCorporationId ||
													!isBillingPayeeSelectionValid ||
													!isBillingDueDaysValid
												}
												onClick={() => {
													if (!effectiveCorporationId) return
													if (!billingPayeeTypeInput) {
														setBillingConfigValidationError('Payee type is required.')
														return
													}
													if (!billingPayeeIdInput.trim()) {
														setBillingConfigValidationError(
															billingPayeeTypeInput === 'character'
																? 'Please select a character payee.'
																: 'Please select a corporation payee.'
														)
														return
													}
													if (!isBillingDueDaysValid) {
														setBillingConfigValidationError(
															'Due days is required and must be an integer between 1 and 90.'
														)
														return
													}
													setBillingConfigValidationError(null)
													const payload = {
														isDefault: isCreatingFirstBillingConfig ? true : billingIsDefaultInput,
														billingEnabled: billingEnabledInput,
														billingIssuerUserId: billingIssuerUserIdInput,
														billingPayeeId: billingPayeeIdInput,
														billingPayeeType: billingPayeeTypeInput,
														billingDueDays: parsedBillingDueDays,
													}
													if (editingBillingConfigId) {
														updateBillingConfigMutation.mutate(
															{
																corporationId: effectiveCorporationId,
																configId: editingBillingConfigId,
																updates: payload,
															},
															{ onSuccess: () => resetBillingConfigForm() }
														)
														return
													}
													createBillingConfigMutation.mutate(
														{
															corporationId: effectiveCorporationId,
															config: payload,
														},
														{ onSuccess: () => resetBillingConfigForm() }
													)
												}}
											>
												{editingBillingConfigId
													? updateBillingConfigMutation.isPending
														? 'Saving...'
														: 'Save Changes'
													: createBillingConfigMutation.isPending
														? 'Creating...'
														: 'Save Config'}
											</Button>
										</div>
										{createBillingConfigMutation.error ||
										updateBillingConfigMutation.error ||
										deleteBillingConfigMutation.error ||
										setDefaultBillingConfigMutation.error ? (
											<div className="text-sm text-destructive">
												{(createBillingConfigMutation.error ||
													updateBillingConfigMutation.error ||
													deleteBillingConfigMutation.error ||
													setDefaultBillingConfigMutation.error) instanceof Error
													? (
															createBillingConfigMutation.error ||
															updateBillingConfigMutation.error ||
															deleteBillingConfigMutation.error ||
															setDefaultBillingConfigMutation.error
														)?.message
													: 'Billing configuration update failed'}
											</div>
										) : null}
									</>
								) : null}
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Billing Operations</CardTitle>
						<CardDescription>
							Create missing bills, sync statuses from bills, and issue draft bills by period.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{!effectiveCorporationId ? (
							<div className="text-sm text-muted-foreground">
								Select a corporation to run billing operations.
							</div>
						) : (
							<>
								<div className="flex flex-wrap gap-2">
									<Button
										variant="outline"
										disabled={!canIssue || syncCorporationMutation.isPending}
										onClick={() =>
											syncCorporationMutation.mutate({
												corporationId: effectiveCorporationId,
												limit: 100,
											})
										}
									>
										{syncCorporationMutation.isPending
											? 'Syncing...'
											: 'Sync Corporation Bill Statuses'}
									</Button>
								</div>
								{syncCorporationMutation.data ? (
									<div className="text-sm text-muted-foreground">
										Processed {syncCorporationMutation.data.processedAssessmentIds.length}, updated{' '}
										{syncCorporationMutation.data.updatedAssessmentIds.length}, skipped{' '}
										{syncCorporationMutation.data.skippedAssessmentIds.length}.
									</div>
								) : null}

								<div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
									<DateRangeInput
										value={{ fromDate: periodStartDate, toDate: periodEndDate }}
										onChange={({ fromDate, toDate }) => {
											setPeriodStartDate(fromDate)
											setPeriodEndDate(toDate)
										}}
										placeholder="Billing period"
										disabled={!canIssue}
									/>
									<Button
										disabled={!canIssue || issuePeriodMutation.isPending}
										onClick={() => {
											if (!effectiveCorporationId || !periodStartDate || !periodEndDate) {
												return
											}
											issuePeriodMutation.mutate({
												corporationId: effectiveCorporationId,
												periodStart: new Date(`${periodStartDate}T00:00:00.000Z`).toISOString(),
												periodEnd: new Date(`${periodEndDate}T23:59:59.999Z`).toISOString(),
											})
										}}
									>
										{issuePeriodMutation.isPending ? 'Issuing...' : 'Issue Bills For Period'}
									</Button>
								</div>
								{issuePeriodMutation.data ? (
									<div className="text-sm text-muted-foreground">
										Issued {issuePeriodMutation.data.issuedAssessmentIds.length}, skipped{' '}
										{issuePeriodMutation.data.skippedAssessmentIds.length}.
									</div>
								) : null}
								{issuePeriodMutation.error ? (
									<div className="text-sm text-destructive">
										{issuePeriodMutation.error instanceof Error
											? issuePeriodMutation.error.message
											: 'Failed to issue bills for period'}
									</div>
								) : null}
								{syncCorporationMutation.error ? (
									<div className="text-sm text-destructive">
										{syncCorporationMutation.error instanceof Error
											? syncCorporationMutation.error.message
											: 'Failed to sync corporation bill statuses'}
									</div>
								) : null}
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Unbilled Assessments</CardTitle>
						<CardDescription>
							Finalized corporation-scope assessments without a linked bill. Create bills manually
							as needed.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{!effectiveCorporationId ? (
							<div className="py-8 text-sm text-muted-foreground">
								Select a corporation to view unbilled assessments.
							</div>
						) : assessmentsLoading ? (
							<div className="py-8 text-sm text-muted-foreground">Loading assessments...</div>
						) : assessmentsError ? (
							<div className="py-8 text-sm text-destructive">
								{assessmentsError instanceof Error
									? assessmentsError.message
									: 'Failed to load assessments'}
							</div>
						) : unbilledAssessmentRows.length === 0 ? (
							<div className="py-8 text-sm text-muted-foreground">
								No unbilled finalized assessments found.
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Assessment</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Tax Due</TableHead>
										<TableHead>Period End</TableHead>
										<TableHead>Action</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{unbilledAssessmentRows.map((assessment) => (
										<TableRow key={assessment.id}>
											<TableCell className="font-mono text-xs">{assessment.id}</TableCell>
											<TableCell>{assessment.status}</TableCell>
											<TableCell>{formatTaxIskFull(assessment.taxDue)}</TableCell>
											<TableCell>{formatTaxDateTime(assessment.taxPeriodEnd)}</TableCell>
											<TableCell>
												<Button
													size="sm"
													disabled={!canIssue || createBillMutation.isPending}
													onClick={() => {
														if (!effectiveCorporationId) {
															return
														}
														createBillMutation.mutate({
															corporationId: effectiveCorporationId,
															assessmentId: assessment.id,
														})
													}}
												>
													{createBillMutation.isPending ? 'Creating...' : 'Create Bill'}
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
						{createBillMutation.error ? (
							<div className="mt-3 text-sm text-destructive">
								{createBillMutation.error instanceof Error
									? createBillMutation.error.message
									: 'Failed to create bill'}
							</div>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Scoped Assessment Snapshot</CardTitle>
						<CardDescription>
							View corporation, division, and character assessment rows for the selected
							corporation.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{!effectiveCorporationId ? (
							<div className="py-8 text-sm text-muted-foreground">
								Select a corporation to view scoped assessments.
							</div>
						) : assessmentsLoading ? (
							<div className="py-8 text-sm text-muted-foreground">
								Loading scoped assessments...
							</div>
						) : assessmentsError ? (
							<div className="py-8 text-sm text-destructive">
								{assessmentsError instanceof Error
									? assessmentsError.message
									: 'Failed to load scoped assessments'}
							</div>
						) : (
							<>
								<div className="flex flex-wrap gap-2">
									<Button
										size="sm"
										variant={selectedAssessmentScope === 'all' ? 'default' : 'outline'}
										onClick={() => setSelectedAssessmentScope('all')}
									>
										All ({assessments.length})
									</Button>
									<Button
										size="sm"
										variant={selectedAssessmentScope === 'corporation' ? 'default' : 'outline'}
										onClick={() => setSelectedAssessmentScope('corporation')}
									>
										Corporation ({scopeCounts.corporation})
									</Button>
									<Button
										size="sm"
										variant={selectedAssessmentScope === 'division' ? 'default' : 'outline'}
										onClick={() => setSelectedAssessmentScope('division')}
									>
										Division ({scopeCounts.division})
									</Button>
									<Button
										size="sm"
										variant={selectedAssessmentScope === 'character' ? 'default' : 'outline'}
										onClick={() => setSelectedAssessmentScope('character')}
									>
										Character ({scopeCounts.character})
									</Button>
								</div>
								{scopedAssessmentRows.length === 0 ? (
									<div className="py-8 text-sm text-muted-foreground">
										No assessments found for the selected scope.
									</div>
								) : (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Assessment</TableHead>
												<TableHead>Scope</TableHead>
												<TableHead>Scope ID</TableHead>
												<TableHead>Status</TableHead>
												<TableHead>Tax Due</TableHead>
												<TableHead>Tax Paid</TableHead>
												<TableHead>Delta</TableHead>
												<TableHead>Period End</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{scopedAssessmentRows.map((assessment) => (
												<TableRow key={assessment.id}>
													<TableCell className="font-mono text-xs">{assessment.id}</TableCell>
													<TableCell>{assessment.assessmentScope}</TableCell>
													<TableCell>
														{assessment.assessmentScope === 'character' ? (
															<TaxEntityDisplay
																entityId={assessment.scopeId}
																entityNames={entityNames}
															/>
														) : (
															assessment.scopeId
														)}
													</TableCell>
													<TableCell>{assessment.status}</TableCell>
													<TableCell>{formatTaxIskFull(assessment.taxDue)}</TableCell>
													<TableCell>{formatTaxIskFull(assessment.taxPaid)}</TableCell>
													<TableCell>{formatTaxIskFull(assessment.taxDelta)}</TableCell>
													<TableCell>{formatTaxDateTime(assessment.taxPeriodEnd)}</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								)}
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Bill Status Rollup</CardTitle>
						<CardDescription>
							Corporation-scope assessment counts and tax totals grouped by bill lifecycle status.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{billStatusLoading ? (
							<div className="py-8 text-sm text-muted-foreground">
								Loading bill status report...
							</div>
						) : billStatusError ? (
							<div className="py-8 text-sm text-destructive">
								{billStatusError instanceof Error
									? billStatusError.message
									: 'Failed to load bill status report'}
							</div>
						) : billStatusReportRows.length === 0 ? (
							<div className="py-8 text-sm text-muted-foreground">
								No bill status data matched the current scope.
							</div>
						) : (
							<div className="space-y-3">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Corporation</TableHead>
											<TableHead>Status</TableHead>
											<TableHead>Issue Date</TableHead>
											<TableHead>Due Date</TableHead>
											<TableHead>Assessments</TableHead>
											<TableHead>Tax Due</TableHead>
											<TableHead>Tax Paid</TableHead>
											<TableHead>Delta</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{billStatusReportRows.map((row) => (
											<TableRow key={`${row.corporationId}-${row.billStatus}`}>
												<TableCell className="font-medium">
													<TaxEntityDisplay
														entityId={row.corporationId}
														entityNames={entityNames}
													/>
												</TableCell>
												<TableCell>
													<Badge variant={billStatusBadgeVariant(row.billStatus)}>
														{row.billStatus}
													</Badge>
												</TableCell>
												<TableCell>{formatTaxDateTime(row.issueDate)}</TableCell>
												<TableCell>{formatTaxDateTime(row.dueDate)}</TableCell>
												<TableCell>{formatTaxNumber(row.assessmentCount)}</TableCell>
												<TableCell>{formatTaxIskFull(row.taxDue)}</TableCell>
												<TableCell>{formatTaxIskFull(row.taxPaid)}</TableCell>
												<TableCell>{formatTaxIskFull(row.taxDelta)}</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
								<div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
									<div>
										Page {billStatusPage + 1} of {billStatusPageCount} (
										{formatTaxNumber(billStatusTotalRows)} rows)
									</div>
									<div className="flex items-center gap-2">
										<Select
											value={String(billStatusPageSize)}
											onValueChange={(value) => {
												const parsed = Number.parseInt(value, 10)
												if (!Number.isFinite(parsed)) return
												setBillStatusPageSize(parsed)
												setBillStatusPage(0)
											}}
										>
											<SelectTrigger className="h-9 w-[110px]">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="25">25 / page</SelectItem>
												<SelectItem value="50">50 / page</SelectItem>
												<SelectItem value="100">100 / page</SelectItem>
												<SelectItem value="200">200 / page</SelectItem>
											</SelectContent>
										</Select>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => setBillStatusPage((value) => Math.max(0, value - 1))}
											disabled={billStatusPage === 0}
										>
											Previous
										</Button>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() =>
												setBillStatusPage((value) =>
													Math.min(Math.max(0, billStatusPageCount - 1), value + 1)
												)
											}
											disabled={billStatusPage + 1 >= billStatusPageCount}
										>
											Next
										</Button>
									</div>
								</div>
							</div>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Corporation Bill History</CardTitle>
						<CardDescription>
							Timeline view of bill events linked to corporation-scope tax assessments.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{!effectiveCorporationId ? (
							<div className="py-8 text-sm text-muted-foreground">
								Select a corporation to view assessment bill history.
							</div>
						) : billHistoryLoading ? (
							<div className="py-8 text-sm text-muted-foreground">Loading bill history...</div>
						) : billHistoryError ? (
							<div className="py-8 text-sm text-destructive">
								{billHistoryError instanceof Error
									? billHistoryError.message
									: 'Failed to load bill history'}
							</div>
						) : billHistory.length === 0 ? (
							<div className="py-8 text-sm text-muted-foreground">
								No bill history entries were found for this corporation.
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Assessment</TableHead>
										<TableHead>Bill</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Tax Due</TableHead>
										<TableHead>Tax Paid</TableHead>
										<TableHead>Period End</TableHead>
										<TableHead>Timeline Events</TableHead>
										<TableHead>Last Event</TableHead>
										<TableHead>Action</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{billHistory.map((row) => (
										<TableRow key={row.assessment.id}>
											<TableCell className="font-mono text-xs">{row.assessment.id}</TableCell>
											<TableCell className="font-mono text-xs">
												{row.assessment.billId ?? '-'}
											</TableCell>
											<TableCell>
												<Badge
													variant={billStatusBadgeVariant(
														(row.assessment.billStatus ?? 'unbilled') as TaxBillStatus | 'unbilled'
													)}
												>
													{row.assessment.billStatus ?? 'unbilled'}
												</Badge>
											</TableCell>
											<TableCell>{formatTaxIskFull(row.assessment.taxDue)}</TableCell>
											<TableCell>{formatTaxIskFull(row.assessment.taxPaid)}</TableCell>
											<TableCell>{formatTaxDateTime(row.assessment.taxPeriodEnd)}</TableCell>
											<TableCell>{formatTaxNumber(row.timeline.length)}</TableCell>
											<TableCell>{getLastTimelineDate(row.timeline)}</TableCell>
											<TableCell>
												<div className="flex items-center gap-2">
													<Button
														size="sm"
														variant="outline"
														disabled={
															!canIssue ||
															!row.assessment.billId ||
															syncAssessmentMutation.isPending
														}
														onClick={() => {
															if (!effectiveCorporationId) {
																return
															}
															syncAssessmentMutation.mutate({
																corporationId: effectiveCorporationId,
																assessmentId: row.assessment.id,
															})
														}}
													>
														{syncAssessmentMutation.isPending ? 'Syncing...' : 'Sync'}
													</Button>
													<Button
														size="sm"
														variant="outline"
														disabled={
															!canIssue ||
															!row.assessment.billId ||
															row.assessment.billStatus === 'paid' ||
															row.assessment.billStatus === 'cancelled' ||
															retractAssessmentMutation.isPending
														}
														onClick={() => setRetractingAssessmentId(row.assessment.id)}
													>
														Retract
													</Button>
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
						{syncAssessmentMutation.error ? (
							<div className="mt-3 text-sm text-destructive">
								{syncAssessmentMutation.error instanceof Error
									? syncAssessmentMutation.error.message
									: 'Failed to sync assessment bill status'}
							</div>
						) : null}
						{retractAssessmentMutation.error ? (
							<div className="mt-3 text-sm text-destructive">
								{retractAssessmentMutation.error instanceof Error
									? retractAssessmentMutation.error.message
									: 'Failed to retract assessment bill'}
							</div>
						) : null}
					</CardContent>
				</Card>
			</Section>

			<Dialog
				open={Boolean(retractingAssessmentId)}
				onOpenChange={(open) => {
					if (!open) {
						setRetractingAssessmentId(null)
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Retract Bill</DialogTitle>
						<DialogDescription>
							This will cancel the linked bill for assessment{' '}
							<span className="font-mono text-xs">{retractingAssessmentId ?? '-'}</span>.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							disabled={retractAssessmentMutation.isPending}
							onClick={() => setRetractingAssessmentId(null)}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={
								!canIssue ||
								!effectiveCorporationId ||
								!retractingAssessmentId ||
								!retractableAssessment?.billId ||
								retractAssessmentMutation.isPending
							}
							onClick={() => {
								if (!effectiveCorporationId || !retractingAssessmentId) {
									return
								}
								retractAssessmentMutation.mutate(
									{
										corporationId: effectiveCorporationId,
										assessmentId: retractingAssessmentId,
									},
									{
										onSuccess: () => {
											setRetractingAssessmentId(null)
										},
									}
								)
							}}
						>
							{retractAssessmentMutation.isPending ? 'Retracting...' : 'Retract Bill'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Container>
	)
}
