import { useEffect, useMemo, useState } from 'react'

import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
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
	useCreateTaxRuleSet,
	useTaxCapabilities,
	useTaxCorporations,
	useTaxCorporationSettings,
	useTaxNotificationDestinations,
	useTaxRuleSets,
	useUpdateTaxCorporationSettings,
	useUpsertTaxNotificationDestination,
} from '@/hooks/useCorporationTax'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatTaxDateTime } from '@/lib/tax-date'
import { formatTaxNumber } from '@/lib/tax-display'

function toPercentText(bps: number): string {
	return (bps / 100).toFixed(2)
}

function parsePercentToBps(input: string): number | null {
	const parsed = Number(input)
	if (!Number.isFinite(parsed)) {
		return null
	}
	const bps = Math.round(parsed * 100)
	if (bps < 0 || bps > 10_000) {
		return null
	}
	return bps
}

export default function TaxSettingsPage() {
	usePageTitle('Tax Settings')

	const { data: globalCapabilities } = useTaxCapabilities()
	const canReadWithUrn = globalCapabilities?.global.canManage ?? false
	const canManageWithUrn = globalCapabilities?.global.canManage ?? false
	const { data: corporationAccess, isLoading: corporationAccessLoading } = useCorporationAccess()

	const { data: corporationSettings = [], isLoading: corporationsLoading } = useTaxCorporations({
		limit: 200,
		enabled: canReadWithUrn,
	})

	const corporationOptions = useMemo(() => {
		const map = new Map<string, string>()
		for (const corp of corporationAccess?.corporations ?? []) {
			map.set(corp.corporationId, corp.name)
		}
		for (const setting of corporationSettings) {
			if (!map.has(setting.corporationId)) {
				map.set(setting.corporationId, setting.corporationId)
			}
		}
		return Array.from(map.entries()).map(([corporationId, name]) => ({ corporationId, name }))
	}, [corporationAccess?.corporations, corporationSettings])

	const [selectedCorporationId, setSelectedCorporationId] = useState<string | undefined>(undefined)
	const effectiveCorporationId = useMemo(() => {
		if (selectedCorporationId) {
			return selectedCorporationId
		}
		if (!canReadWithUrn && (corporationAccess?.corporations?.length ?? 0) > 0) {
			return corporationAccess?.corporations?.[0]?.corporationId
		}
		return corporationOptions[0]?.corporationId
	}, [selectedCorporationId, canReadWithUrn, corporationAccess?.corporations, corporationOptions])

	const { data: scopedCapabilities, isLoading: scopedCapabilitiesLoading } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canReadScoped = scopedCapabilities?.scoped.canManage ?? false
	const canRead = canReadWithUrn || canReadScoped

	const canManageSelectedCorporation =
		canManageWithUrn || (scopedCapabilities?.scoped.canManage ?? false)

	const {
		data: settings,
		isLoading: settingsLoading,
		error: settingsError,
	} = useTaxCorporationSettings(
		effectiveCorporationId,
		canRead && !corporationAccessLoading && !!effectiveCorporationId
	)

	const {
		data: ruleSets = [],
		isLoading: rulesLoading,
		error: rulesError,
	} = useTaxRuleSets(effectiveCorporationId, {
		includeGlobal: true,
		onlyActive: false,
		limit: 100,
		enabled: canRead && !corporationAccessLoading && !!effectiveCorporationId,
	})

	const {
		data: notificationDestinations = [],
		isLoading: destinationLoading,
		error: destinationError,
	} = useTaxNotificationDestinations({
		scope: 'corporation',
		corporationId: effectiveCorporationId,
		limit: 20,
		enabled: canRead && !corporationAccessLoading && !!effectiveCorporationId,
	})

	const updateSettingsMutation = useUpdateTaxCorporationSettings()
	const createRuleSetMutation = useCreateTaxRuleSet()
	const upsertDestinationMutation = useUpsertTaxNotificationDestination()

	const [included, setIncluded] = useState(false)
	const [exclusionReason, setExclusionReason] = useState('')
	const [defaultRateText, setDefaultRateText] = useState('0.00')
	const [essRateText, setEssRateText] = useState('0.00')
	const [discrepancyText, setDiscrepancyText] = useState('5.00')
	const [memberSummaryEnabled, setMemberSummaryEnabled] = useState(false)
	const [billingEnabled, setBillingEnabled] = useState(false)
	const [billingDueDaysText, setBillingDueDaysText] = useState('14')

	const [ruleName, setRuleName] = useState('Default Income Rule')
	const [ruleRefType, setRuleRefType] = useState('')
	const [ruleRateText, setRuleRateText] = useState('7.50')
	const [ruleEssOnly, setRuleEssOnly] = useState(false)
	const [ruleApplyGlobally, setRuleApplyGlobally] = useState(false)

	const [guildId, setGuildId] = useState('')
	const [channelId, setChannelId] = useState('')
	const [destinationActive, setDestinationActive] = useState(true)

	useEffect(() => {
		if (!settings) {
			return
		}
		setIncluded(settings.included)
		setExclusionReason(settings.exclusionReason ?? '')
		setDefaultRateText(toPercentText(settings.defaultRateBps))
		setEssRateText(toPercentText(settings.essRateBps))
		setDiscrepancyText(toPercentText(settings.discrepancyThresholdBps))
		setMemberSummaryEnabled(settings.memberSummaryEnabled)
		setBillingEnabled(settings.billingEnabled)
		setBillingDueDaysText(String(settings.billingDueDays))
	}, [settings])

	useEffect(() => {
		const firstDestination = notificationDestinations[0]
		if (!firstDestination) {
			setGuildId('')
			setChannelId('')
			setDestinationActive(true)
			return
		}
		setGuildId(firstDestination.guildId)
		setChannelId(firstDestination.channelId)
		setDestinationActive(firstDestination.isActive)
	}, [notificationDestinations])

	if (!corporationAccessLoading && !scopedCapabilitiesLoading && !canRead) {
		return (
			<Container>
				<Card>
					<CardHeader>
						<CardTitle>Tax Settings</CardTitle>
						<CardDescription>You do not have permission to view tax settings.</CardDescription>
					</CardHeader>
				</Card>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title="Tax Settings"
				description="Manage corporation inclusion, tax rates, rule sets, and Discord destination overrides."
			/>

			<Section>
				{corporationsLoading ? (
					<div className="py-2 text-sm text-muted-foreground">Loading corporations...</div>
				) : corporationOptions.length === 0 ? (
					<div className="py-2 text-sm text-muted-foreground">
						No corporations are available for tax settings.
					</div>
				) : (
					<TaxCorporationScopeSelector
						corporations={corporationOptions}
						effectiveCorporationId={effectiveCorporationId}
						onSelect={setSelectedCorporationId}
					/>
				)}

				<Card>
					<CardHeader>
						<CardTitle>Corporation Configuration</CardTitle>
						<CardDescription>
							Set inclusion, rates, and billing defaults. Rates are entered as percentages.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{settingsLoading ? (
							<div className="py-2 text-sm text-muted-foreground">Loading settings...</div>
						) : settingsError ? (
							<div className="py-2 text-sm text-destructive">
								{settingsError instanceof Error ? settingsError.message : 'Failed to load settings'}
							</div>
						) : !settings ? (
							<div className="py-2 text-sm text-muted-foreground">
								No settings found for this corporation.
							</div>
						) : (
							<>
								<div className="grid gap-3 md:grid-cols-2">
									<label className="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											checked={included}
											onChange={(event) => setIncluded(event.target.checked)}
											disabled={!canManageSelectedCorporation}
										/>
										Included in taxation
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											checked={memberSummaryEnabled}
											onChange={(event) => setMemberSummaryEnabled(event.target.checked)}
											disabled={!canManageSelectedCorporation}
										/>
										Member summary enabled
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											checked={billingEnabled}
											onChange={(event) => setBillingEnabled(event.target.checked)}
											disabled={!canManageSelectedCorporation}
										/>
										Billing enabled
									</label>
								</div>

								<div className="grid gap-3 md:grid-cols-2">
									<Input
										value={defaultRateText}
										onChange={(event) => setDefaultRateText(event.target.value)}
										placeholder="Default rate (%)"
										disabled={!canManageSelectedCorporation}
									/>
									<Input
										value={essRateText}
										onChange={(event) => setEssRateText(event.target.value)}
										placeholder="ESS rate (%)"
										disabled={!canManageSelectedCorporation}
									/>
									<Input
										value={discrepancyText}
										onChange={(event) => setDiscrepancyText(event.target.value)}
										placeholder="Discrepancy threshold (%)"
										disabled={!canManageSelectedCorporation}
									/>
									<Input
										value={billingDueDaysText}
										onChange={(event) => setBillingDueDaysText(event.target.value)}
										placeholder="Billing due days"
										disabled={!canManageSelectedCorporation}
									/>
								</div>

								{!included ? (
									<Input
										value={exclusionReason}
										onChange={(event) => setExclusionReason(event.target.value)}
										placeholder="Exclusion reason"
										disabled={!canManageSelectedCorporation}
									/>
								) : null}

								<Button
									disabled={!canManageSelectedCorporation || updateSettingsMutation.isPending}
									onClick={() => {
										if (!effectiveCorporationId) {
											return
										}
										const defaultRateBps = parsePercentToBps(defaultRateText)
										const essRateBps = parsePercentToBps(essRateText)
										const discrepancyThresholdBps = parsePercentToBps(discrepancyText)
										const billingDueDays = Number(billingDueDaysText)
										if (
											defaultRateBps === null ||
											essRateBps === null ||
											discrepancyThresholdBps === null ||
											!Number.isInteger(billingDueDays) ||
											billingDueDays < 1 ||
											billingDueDays > 120
										) {
											return
										}

										updateSettingsMutation.mutate({
											corporationId: effectiveCorporationId,
											updates: {
												included,
												exclusionReason: included ? null : exclusionReason || null,
												defaultRateBps,
												essRateBps,
												discrepancyThresholdBps,
												memberSummaryEnabled,
												billingEnabled,
												billingDueDays,
											},
										})
									}}
								>
									{updateSettingsMutation.isPending ? 'Saving Settings...' : 'Save Settings'}
								</Button>

								{updateSettingsMutation.error ? (
									<div className="text-sm text-destructive">
										{updateSettingsMutation.error instanceof Error
											? updateSettingsMutation.error.message
											: 'Failed to update settings'}
									</div>
								) : null}
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>ESI Health</CardTitle>
						<CardDescription>
							Current auth and required scope status for inclusion validation.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{!settings?.esiAuthStatus ? (
							<div className="text-sm text-muted-foreground">
								No ESI auth status is available for this corporation.
							</div>
						) : (
							<div className="grid gap-2 text-sm md:grid-cols-2">
								<div>
									Required scopes:{' '}
									<Badge
										variant={settings.esiAuthStatus.hasRequiredScopes ? 'default' : 'destructive'}
									>
										{settings.esiAuthStatus.hasRequiredScopes ? 'satisfied' : 'missing'}
									</Badge>
								</div>
								<div>
									Director tokens: {settings.esiAuthStatus.healthyDirectorCount}/
									{settings.esiAuthStatus.directorCount}
								</div>
								<div>Last verified: {formatTaxDateTime(settings.esiAuthStatus.lastVerified)}</div>
								<div>
									Missing scopes:{' '}
									{settings.esiAuthStatus.missingRequiredScopes.length > 0
										? settings.esiAuthStatus.missingRequiredScopes.join(', ')
										: 'none'}
								</div>
							</div>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Rule Sets</CardTitle>
						<CardDescription>Create and review tax rule sets for this corporation.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-3 md:grid-cols-3">
							<Input
								value={ruleName}
								onChange={(event) => setRuleName(event.target.value)}
								placeholder="Rule name"
								disabled={!canManageSelectedCorporation}
							/>
							<Input
								value={ruleRefType}
								onChange={(event) => setRuleRefType(event.target.value)}
								placeholder="Optional ref_type"
								disabled={!canManageSelectedCorporation}
							/>
							<Input
								value={ruleRateText}
								onChange={(event) => setRuleRateText(event.target.value)}
								placeholder="Tax rate (%)"
								disabled={!canManageSelectedCorporation}
							/>
						</div>
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={ruleEssOnly}
								onChange={(event) => setRuleEssOnly(event.target.checked)}
								disabled={!canManageSelectedCorporation}
							/>
							ESS only
						</label>
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={ruleApplyGlobally}
								onChange={(event) => setRuleApplyGlobally(event.target.checked)}
								disabled={!canManageWithUrn}
							/>
							Apply as global default rule
						</label>
						<Button
							disabled={
								createRuleSetMutation.isPending ||
								(ruleApplyGlobally ? !canManageWithUrn : !canManageSelectedCorporation)
							}
							onClick={() => {
								if (!ruleName.trim()) {
									return
								}
								if (ruleApplyGlobally && !canManageWithUrn) {
									return
								}
								const targetCorporationId = ruleApplyGlobally ? undefined : effectiveCorporationId
								if (!targetCorporationId && !ruleApplyGlobally) {
									return
								}
								const rateBps = parsePercentToBps(ruleRateText)
								if (rateBps === null) {
									return
								}
								createRuleSetMutation.mutate({
									corporationId: targetCorporationId,
									ruleSet: {
										name: ruleName.trim(),
										conditions: [
											{
												appliesToRefType: ruleRefType.trim() || undefined,
												isEssOnly: ruleEssOnly || undefined,
											},
										],
										actions: [
											{
												taxRateBps: rateBps,
												isTaxable: true,
												label: `${ruleName.trim()} action`,
											},
										],
									},
								})
							}}
						>
							{createRuleSetMutation.isPending ? 'Creating Rule Set...' : 'Create Rule Set'}
						</Button>
						{createRuleSetMutation.error ? (
							<div className="text-sm text-destructive">
								{createRuleSetMutation.error instanceof Error
									? createRuleSetMutation.error.message
									: 'Failed to create rule set'}
							</div>
						) : null}

						{rulesLoading ? (
							<div className="py-2 text-sm text-muted-foreground">Loading rule sets...</div>
						) : rulesError ? (
							<div className="py-2 text-sm text-destructive">
								{rulesError instanceof Error ? rulesError.message : 'Failed to load rule sets'}
							</div>
						) : ruleSets.length === 0 ? (
							<div className="py-2 text-sm text-muted-foreground">No rule sets found.</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Name</TableHead>
										<TableHead>Active</TableHead>
										<TableHead>Priority</TableHead>
										<TableHead>Effective From</TableHead>
										<TableHead>Conditions</TableHead>
										<TableHead>Primary Rate</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{ruleSets.map((rule) => (
										<TableRow key={rule.id}>
											<TableCell className="font-medium">{rule.name}</TableCell>
											<TableCell>{rule.isActive ? 'yes' : 'no'}</TableCell>
											<TableCell>{formatTaxNumber(rule.priority)}</TableCell>
											<TableCell>{formatTaxDateTime(rule.effectiveFrom)}</TableCell>
											<TableCell>{formatTaxNumber(rule.conditions.length)}</TableCell>
											<TableCell>
												{rule.actions.length > 0 ? toPercentText(rule.actions[0]!.taxRateBps) : '-'}
												%
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Discord Destination Override</CardTitle>
						<CardDescription>
							Set a corporation-specific Discord channel override for tax alerts.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-3 md:grid-cols-2">
							<Input
								value={guildId}
								onChange={(event) => setGuildId(event.target.value)}
								placeholder="Guild ID"
								disabled={!canManageSelectedCorporation}
							/>
							<Input
								value={channelId}
								onChange={(event) => setChannelId(event.target.value)}
								placeholder="Channel ID"
								disabled={!canManageSelectedCorporation}
							/>
						</div>
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={destinationActive}
								onChange={(event) => setDestinationActive(event.target.checked)}
								disabled={!canManageSelectedCorporation}
							/>
							Destination active
						</label>
						<Button
							disabled={!canManageSelectedCorporation || upsertDestinationMutation.isPending}
							onClick={() => {
								if (!effectiveCorporationId || !guildId.trim() || !channelId.trim()) {
									return
								}
								upsertDestinationMutation.mutate({
									scope: 'corporation',
									corporationId: effectiveCorporationId,
									guildId: guildId.trim(),
									channelId: channelId.trim(),
									isActive: destinationActive,
								})
							}}
						>
							{upsertDestinationMutation.isPending ? 'Saving Destination...' : 'Save Destination'}
						</Button>
						{upsertDestinationMutation.error ? (
							<div className="text-sm text-destructive">
								{upsertDestinationMutation.error instanceof Error
									? upsertDestinationMutation.error.message
									: 'Failed to update destination'}
							</div>
						) : null}

						{destinationLoading ? (
							<div className="py-2 text-sm text-muted-foreground">Loading destination...</div>
						) : destinationError ? (
							<div className="py-2 text-sm text-destructive">
								{destinationError instanceof Error
									? destinationError.message
									: 'Failed to load destination'}
							</div>
						) : notificationDestinations.length === 0 ? (
							<div className="py-2 text-sm text-muted-foreground">
								No corporation destination override configured.
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Scope</TableHead>
										<TableHead>Guild</TableHead>
										<TableHead>Channel</TableHead>
										<TableHead>Active</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{notificationDestinations.map((destination) => (
										<TableRow key={destination.id}>
											<TableCell>{destination.scope}</TableCell>
											<TableCell>{destination.guildId}</TableCell>
											<TableCell>{destination.channelId}</TableCell>
											<TableCell>{destination.isActive ? 'yes' : 'no'}</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
