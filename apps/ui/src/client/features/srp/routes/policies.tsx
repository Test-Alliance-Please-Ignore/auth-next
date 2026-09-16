import { Edit2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'

import { MAX_SRP_LOSS_AGE_DAYS } from '@repo/srp'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { formatNumber, useAppTranslation } from '@/i18n'
import { api } from '@/lib/api'
import toast from '@/lib/toast'

import { SRPFeedback } from '../components/SRPFeedback'
import { SRPNumberInput as NumberInput } from '../components/SRPNumberInput'
import {
	useCreatePolicy,
	useDeletePolicy,
	useSRPConfig,
	useSRPDiscordGuilds,
	useSRPPolicies,
	useUpdatePolicy,
	useUpdateSRPConfig,
} from '../hooks'
import { formatISK } from '../utils'

import type { CapConfig, PayoutModifierConfig } from '@repo/srp'
import type { SelectOption } from '@/components/ui/select'
import type { SRPConfigResponse, SRPPolicy, SRPPredefinedAdhocModifier } from '../types'

function isPayoutModifierConfig(c: unknown): c is PayoutModifierConfig {
	return typeof c === 'object' && c !== null && 'rate' in c
}

function isCapConfig(c: unknown): c is CapConfig {
	return typeof c === 'object' && c !== null && 'maxPayoutMillions' in c
}

function upsertSelectOption(
	current: SelectOption[],
	next: SelectOption,
	limit = 50
): SelectOption[] {
	const without = current.filter((option) => option.value !== next.value)
	return [next, ...without].slice(0, limit)
}

function formatTemplateAmount(modifier: SRPPredefinedAdhocModifier): string {
	if (modifier.mode === 'percentage') {
		return formatNumber(modifier.amount / 100, { style: 'percent', maximumFractionDigits: 2 })
	}

	return formatISK(String(Math.round(modifier.amount * 1_000_000)))
}

export default function PoliciesPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('srp.policies.pageTitle'))

	const { hasPermission, isAdmin } = useUserPermissions()

	if (!(isAdmin || hasPermission('urn:srp:manager'))) {
		return <Navigate to="/srp" replace />
	}

	const { data: policies = [], isLoading } = useSRPPolicies()
	const { data: config } = useSRPConfig()

	const modifierPolicies = policies.filter((p) => p.effect === 'payout_modifier')
	const capPolicies = policies.filter((p) => p.effect === 'cap')

	if (isLoading) {
		return (
			<Container>
				<PageHeader
					title={t('srp.policies.title')}
					description={t('srp.policies.shortDescription')}
				/>
				<div className="space-y-4">
					{[...Array(4)].map((_, i) => (
						<div key={i} className="h-14 animate-pulse rounded-md bg-muted/30" />
					))}
				</div>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader title={t('srp.policies.title')} description={t('srp.policies.description')} />

			<div className="space-y-8">
				<GeneralConfigPanel config={config} />
				<PolicySection
					title={t('srp.policies.modifiers')}
					description={t('srp.policies.modifiersDescription')}
					effect="payout_modifier"
					policies={modifierPolicies}
				/>
				<PolicySection
					title={t('srp.policies.caps')}
					description={t('srp.policies.capsDescription')}
					effect="cap"
					policies={capPolicies}
				/>
				<PredefinedAdhocModifiersSection
					initialModifiers={config?.predefinedAdhocModifiers ?? []}
				/>
			</div>
		</Container>
	)
}

function GeneralConfigPanel({ config }: { config?: SRPConfigResponse }) {
	const { t } = useAppTranslation()
	const updateConfigMutation = useUpdateSRPConfig()
	const [defaultCoverageRatePercent, setDefaultCoverageRatePercent] = useState('100')
	const [maxPayoutAmount, setMaxPayoutAmount] = useState('')
	const [maxLossAgeDays, setMaxLossAgeDays] = useState('30')
	const [paymentProcessorCorporationId, setPaymentProcessorCorporationId] = useState('')
	const [srpGroupId, setSrpGroupId] = useState('')
	const [srpDiscordGuildId, setSrpDiscordGuildId] = useState('')
	const [srpDiscordChannelId, setSrpDiscordChannelId] = useState('')
	const [paymentProcessorCorporationOptions, setPaymentProcessorCorporationOptions] = useState<
		SelectOption[]
	>([])
	const [srpGroupOptions, setSrpGroupOptions] = useState<SelectOption[]>([])
	const { data: discordServers = [] } = useSRPDiscordGuilds()

	useEffect(() => {
		if (!config) return
		setDefaultCoverageRatePercent(String(Math.round(parseFloat(config.defaultCoverageRate) * 100)))
		setMaxPayoutAmount(config.maxPayoutAmount ?? '')
		setMaxLossAgeDays(String(config.maxLossAgeDays))
		setPaymentProcessorCorporationId(config.paymentProcessorCorporationId ?? '')
		setSrpGroupId(config.srpGroupId ?? '')
		setSrpDiscordGuildId(config.srpDiscordGuildId ?? '')
		setSrpDiscordChannelId(config.srpDiscordChannelId ?? '')
	}, [config])

	useEffect(() => {
		if (!paymentProcessorCorporationId) {
			return
		}

		let cancelled = false
		void api
			.searchSRPPaymentProcessorCorporations(paymentProcessorCorporationId)
			.then((rows) => {
				if (cancelled) return
				const matched = rows.find((row) => row.corporationId === paymentProcessorCorporationId)
				const option = matched
					? ({
							value: matched.corporationId,
							label: `${matched.name} (${matched.corporationId})`,
						} satisfies SelectOption)
					: ({
							value: paymentProcessorCorporationId,
							label: paymentProcessorCorporationId,
						} satisfies SelectOption)
				setPaymentProcessorCorporationOptions((current) => upsertSelectOption(current, option))
			})
			.catch(() => {
				if (!cancelled) {
					setPaymentProcessorCorporationOptions((current) =>
						upsertSelectOption(current, {
							value: paymentProcessorCorporationId,
							label: paymentProcessorCorporationId,
						})
					)
				}
			})

		return () => {
			cancelled = true
		}
	}, [paymentProcessorCorporationId])

	useEffect(() => {
		if (!srpGroupId) {
			return
		}

		let cancelled = false
		void api
			.getGroup(srpGroupId)
			.then((group) => {
				if (cancelled) return
				setSrpGroupOptions((current) =>
					upsertSelectOption(current, {
						value: group.id,
						label: `${group.name} (${group.id})`,
					})
				)
			})
			.catch(() => {
				if (!cancelled) {
					setSrpGroupOptions((current) =>
						upsertSelectOption(current, {
							value: srpGroupId,
							label: srpGroupId,
						})
					)
				}
			})

		return () => {
			cancelled = true
		}
	}, [srpGroupId])

	const save = async () => {
		try {
			await updateConfigMutation.mutateAsync({
				defaultCoverageRate: String((Number.parseFloat(defaultCoverageRatePercent) || 0) / 100),
				maxPayoutAmount: maxPayoutAmount.trim() ? maxPayoutAmount.trim() : null,
				maxLossAgeDays: Math.max(1, Number.parseInt(maxLossAgeDays, 10) || 30),
				paymentProcessorCorporationId: paymentProcessorCorporationId.trim()
					? paymentProcessorCorporationId.trim()
					: null,
				srpGroupId: srpGroupId.trim() ? srpGroupId.trim() : null,
				srpDiscordGuildId: srpDiscordGuildId.trim() ? srpDiscordGuildId.trim() : null,
				srpDiscordChannelId: srpDiscordChannelId.trim() ? srpDiscordChannelId.trim() : null,
			})
			toast.success(<SRPFeedback messageKey="srp.policies.configSaved" />)
		} catch (error: any) {
			toast.error(<SRPFeedback messageKey="srp.policies.configFailed" />, {
				description: error.message,
			})
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">{t('srp.policies.general')}</CardTitle>
				<CardDescription>{t('srp.policies.generalDescription')}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid gap-4 sm:grid-cols-2">
					<div>
						<Label htmlFor="defaultCoverageRatePercent">{t('srp.policies.defaultCoverage')}</Label>
						<NumberInput
							id="defaultCoverageRatePercent"
							min={0}
							max={200}
							step={1}
							allowDecimal={false}
							suffix="%"
							value={defaultCoverageRatePercent}
							onChange={setDefaultCoverageRatePercent}
						/>
					</div>
					<div>
						<Label htmlFor="maxPayoutAmount">{t('srp.policies.maxPayoutOptional')}</Label>
						<NumberInput
							id="maxPayoutAmount"
							min={0}
							step={1}
							allowDecimal={false}
							suffix=" ISK"
							value={maxPayoutAmount}
							onChange={setMaxPayoutAmount}
							placeholder={t('srp.policies.maxPlaceholder', { amount: formatNumber(1000000000) })}
						/>
					</div>
					<div>
						<Label htmlFor="maxLossAgeDays">{t('srp.policies.maxAge')}</Label>
						<NumberInput
							id="maxLossAgeDays"
							min={1}
							max={MAX_SRP_LOSS_AGE_DAYS}
							step={1}
							allowDecimal={false}
							value={maxLossAgeDays}
							onChange={setMaxLossAgeDays}
						/>
					</div>
					<div className="sm:col-span-2">
						<Label htmlFor="paymentProcessorCorporationId">{t('srp.policies.processor')}</Label>
						<Select
							inputId="paymentProcessorCorporationId"
							searchable
							value={paymentProcessorCorporationId}
							onValueChange={(next, option) => {
								setPaymentProcessorCorporationId(next)
								if (option) {
									setPaymentProcessorCorporationOptions((current) =>
										upsertSelectOption(current, { value: option.value, label: option.label })
									)
								}
							}}
							options={paymentProcessorCorporationOptions}
							placeholder={t('srp.policies.searchCorporations')}
							queryHintText={t('srp.policies.searchCorporationsHint')}
							searchDelegate={(query) =>
								api.searchSRPPaymentProcessorCorporations(query).then((rows) =>
									rows.map((row) => ({
										value: row.corporationId,
										label: `${row.name} (${row.corporationId})`,
									}))
								)
							}
						/>
					</div>
					<div>
						<Label htmlFor="srpDiscordGuildId">{t('srp.policies.guild')}</Label>
						<Select
							inputId="srpDiscordGuildId"
							value={srpDiscordGuildId}
							onValueChange={(next) => {
								setSrpDiscordGuildId(next)
								if (next !== srpDiscordGuildId) setSrpDiscordChannelId('')
							}}
							options={discordServers.map((server) => ({
								value: server.guildId,
								label: `${server.guildName} (${server.guildId})`,
							}))}
							placeholder={t('srp.policies.selectGuild')}
						/>
					</div>
					<div>
						<Label htmlFor="srpDiscordChannelId">{t('srp.policies.channel')}</Label>
						<Input
							id="srpDiscordChannelId"
							value={srpDiscordChannelId}
							onChange={(event) => setSrpDiscordChannelId(event.target.value)}
							placeholder={t('srp.policies.channelPlaceholder')}
							inputMode="numeric"
						/>
						<p className="mt-1 text-xs text-muted-foreground">{t('srp.policies.channelHint')}</p>
					</div>
					<div className="sm:col-span-2">
						<Label htmlFor="srpGroupId">{t('srp.policies.group')}</Label>
						<Select
							inputId="srpGroupId"
							searchable
							value={srpGroupId}
							onValueChange={(next, option) => {
								setSrpGroupId(next)
								if (option) {
									setSrpGroupOptions((current) =>
										upsertSelectOption(current, { value: option.value, label: option.label })
									)
								}
							}}
							options={srpGroupOptions}
							placeholder={t('srp.policies.searchGroups')}
							queryHintText={t('srp.policies.searchGroupsHint')}
							searchDelegate={(query) =>
								api.getGroups({ search: query, limit: 25 }).then((rows) =>
									rows.map((row) => ({
										value: row.id,
										label: `${row.name} (${row.id})`,
									}))
								)
							}
						/>
					</div>
				</div>

				<div className="flex justify-end">
					<div className="flex items-center gap-2">
						<Button onClick={save} disabled={updateConfigMutation.isPending}>
							{updateConfigMutation.isPending
								? t('srp.common.saving')
								: t('srp.policies.saveConfig')}
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}

function PredefinedAdhocModifiersSection({
	initialModifiers,
}: {
	initialModifiers: SRPPredefinedAdhocModifier[]
}) {
	const { t } = useAppTranslation()
	const updateConfigMutation = useUpdateSRPConfig()
	const [modifiers, setModifiers] = useState<SRPPredefinedAdhocModifier[]>(initialModifiers)
	const [editingIndex, setEditingIndex] = useState<number | null>(null)
	const [isCreating, setIsCreating] = useState(false)
	const [draftModifier, setDraftModifier] = useState<SRPPredefinedAdhocModifier | null>(null)

	useEffect(() => {
		setModifiers(initialModifiers)
		setEditingIndex(null)
		setIsCreating(false)
		setDraftModifier(null)
	}, [initialModifiers])

	const persistModifiers = async (nextModifiers: SRPPredefinedAdhocModifier[]) => {
		try {
			await updateConfigMutation.mutateAsync({
				predefinedAdhocModifiers: nextModifiers.map((modifier) => ({
					...modifier,
					reason: modifier.reason.trim(),
				})),
			} as any)
		} catch (error: any) {
			toast.error(<SRPFeedback messageKey="srp.policies.templatesFailed" />, {
				description: error.message,
			})
		}
	}

	const addModifier = () => {
		setEditingIndex(modifiers.length)
		setIsCreating(true)
		setDraftModifier({
			modifierType: 'deduction',
			mode: 'percentage',
			amount: 10,
			reason: '',
		})
	}

	const startEdit = (index: number) => {
		setEditingIndex(index)
		setIsCreating(false)
		setDraftModifier({ ...modifiers[index] })
	}

	const cancelEdit = () => {
		setEditingIndex(null)
		setIsCreating(false)
		setDraftModifier(null)
	}

	const saveEdit = async () => {
		if (editingIndex === null || !draftModifier) return
		if (draftModifier.reason.trim().length === 0) {
			toast.error(<SRPFeedback messageKey="srp.validation.reasonRequired" />)
			return
		}

		const cleaned = { ...draftModifier, reason: draftModifier.reason.trim() }
		const next = isCreating
			? [...modifiers, cleaned]
			: modifiers.map((modifier, index) => (index === editingIndex ? cleaned : modifier))

		setModifiers(next)
		setEditingIndex(null)
		setIsCreating(false)
		setDraftModifier(null)
		await persistModifiers(next)
	}

	const removeModifier = (index: number) => {
		const next = modifiers.filter((_, currentIndex) => currentIndex !== index)
		setModifiers(next)
		void persistModifiers(next)
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
				<div>
					<CardTitle className="text-lg">{t('srp.policies.templates')}</CardTitle>
					<CardDescription>{t('srp.policies.templatesDescription')}</CardDescription>
				</div>
				<Button size="sm" onClick={addModifier} disabled={updateConfigMutation.isPending}>
					<Plus className="mr-1 h-4 w-4" />
					{t('srp.policies.addTemplate')}
				</Button>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="overflow-hidden rounded-lg border border-border/50 bg-card">
					{modifiers.length === 0 &&
					!(isCreating && draftModifier && editingIndex === modifiers.length) ? (
						<div className="p-8 text-center text-sm text-muted-foreground">
							{t('srp.policies.noModifiers')}
						</div>
					) : (
						<div className="space-y-2 p-3">
							<div className="grid items-center gap-2 px-2 text-xs font-medium text-muted-foreground sm:grid-cols-[150px_140px_140px_1fr_auto]">
								<div>{t('srp.common.type')}</div>
								<div>{t('srp.policies.mode')}</div>
								<div>{t('srp.common.amount')}</div>
								<div>{t('srp.common.reason')}</div>
								<div className="text-right">{t('srp.common.actions')}</div>
							</div>
							{modifiers.map((modifier, index) => (
								<div
									key={index}
									className="grid items-center gap-2 rounded-md border border-border/40 p-3 sm:grid-cols-[150px_140px_140px_1fr_auto]"
								>
									{editingIndex === index && !isCreating && draftModifier ? (
										<>
											<Select
												value={draftModifier.modifierType}
												onValueChange={(value) =>
													setDraftModifier({
														...draftModifier,
														modifierType: value as SRPPredefinedAdhocModifier['modifierType'],
													})
												}
												options={[
													{ value: 'deduction', label: t('srp.common.deduction') },
													{ value: 'bonus', label: t('srp.common.bonus') },
												]}
											/>
											<Select
												value={draftModifier.mode}
												onValueChange={(value) =>
													setDraftModifier({
														...draftModifier,
														mode: value as SRPPredefinedAdhocModifier['mode'],
													})
												}
												options={[
													{ value: 'percentage', label: t('srp.policies.percentage') },
													{ value: 'value', label: t('srp.common.millionIsk') },
												]}
											/>
											<NumberInput
												min={0}
												step={0.01}
												value={draftModifier.amount}
												onChange={(value) =>
													setDraftModifier({
														...draftModifier,
														amount: Number.parseFloat(value) || 0,
													})
												}
												placeholder={t('srp.common.amount')}
											/>
											<Input
												value={draftModifier.reason}
												onChange={(e) =>
													setDraftModifier({
														...draftModifier,
														reason: e.target.value,
													})
												}
												placeholder={t('srp.common.reason')}
											/>
											<div className="flex gap-1">
												<Button variant="primary" size="sm" onClick={() => void saveEdit()}>
													{t('srp.common.save')}
												</Button>
												<Button variant="ghost" size="sm" onClick={cancelEdit}>
													{t('srp.common.cancel')}
												</Button>
											</div>
										</>
									) : (
										<>
											<div className="text-sm">
												<Badge
													variant={
														modifier.modifierType === 'deduction' ? 'destructive' : 'default'
													}
													className={
														modifier.modifierType === 'bonus'
															? 'bg-green-600 text-white'
															: undefined
													}
												>
													{modifier.modifierType === 'deduction'
														? t('srp.common.deduction')
														: t('srp.common.bonus')}
												</Badge>
											</div>
											<div className="text-sm font-semibold">
												{modifier.mode === 'percentage'
													? t('srp.policies.percentage')
													: t('srp.common.millionIsk')}
											</div>
											<div className="font-mono font-semibold text-sm tabular-nums">
												{formatTemplateAmount(modifier)}
											</div>
											<div className="text-sm">{modifier.reason}</div>
											<div className="flex justify-end gap-1">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => startEdit(index)}
													disabled={updateConfigMutation.isPending}
													aria-label={t('srp.policies.editTemplate')}
												>
													<Pencil className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => removeModifier(index)}
													disabled={updateConfigMutation.isPending}
													aria-label={t('srp.policies.removeTemplate')}
													className="text-destructive hover:text-destructive"
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</div>
										</>
									)}
								</div>
							))}
							{isCreating && draftModifier && editingIndex === modifiers.length && (
								<div className="grid items-center gap-2 rounded-md border border-border/40 p-3 sm:grid-cols-[150px_140px_140px_1fr_auto]">
									<Select
										value={draftModifier.modifierType}
										onValueChange={(value) =>
											setDraftModifier({
												...draftModifier,
												modifierType: value as SRPPredefinedAdhocModifier['modifierType'],
											})
										}
										options={[
											{ value: 'deduction', label: t('srp.common.deduction') },
											{ value: 'bonus', label: t('srp.common.bonus') },
										]}
									/>
									<Select
										value={draftModifier.mode}
										onValueChange={(value) =>
											setDraftModifier({
												...draftModifier,
												mode: value as SRPPredefinedAdhocModifier['mode'],
											})
										}
										options={[
											{ value: 'percentage', label: t('srp.policies.percentage') },
											{ value: 'value', label: t('srp.common.millionIsk') },
										]}
									/>
									<NumberInput
										min={0}
										step={0.01}
										value={draftModifier.amount}
										onChange={(value) =>
											setDraftModifier({
												...draftModifier,
												amount: Number.parseFloat(value) || 0,
											})
										}
										placeholder={t('srp.common.amount')}
									/>
									<Input
										value={draftModifier.reason}
										onChange={(e) =>
											setDraftModifier({
												...draftModifier,
												reason: e.target.value,
											})
										}
										placeholder={t('srp.common.reason')}
									/>
									<div className="flex gap-1">
										<Button variant="primary" size="sm" onClick={() => void saveEdit()}>
											{t('srp.common.save')}
										</Button>
										<Button variant="ghost" size="sm" onClick={cancelEdit}>
											{t('srp.common.cancel')}
										</Button>
									</div>
								</div>
							)}
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	)
}

interface PolicySectionProps {
	title: string
	description: string
	effect: 'payout_modifier' | 'cap'
	policies: SRPPolicy[]
}

function PolicySection({ title, description, effect, policies }: PolicySectionProps) {
	const { t } = useAppTranslation()
	const [showAddForm, setShowAddForm] = useState(false)

	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
				<div>
					<CardTitle className="text-lg">{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
				</div>
				<Button size="sm" onClick={() => setShowAddForm((v) => !v)}>
					<Plus className="mr-1 h-4 w-4" />
					{t('srp.policies.addPolicy')}
				</Button>
			</CardHeader>
			<CardContent className="space-y-4">
				{showAddForm && (
					<Card className="p-4">
						<PolicyForm
							effect={effect}
							onCancel={() => setShowAddForm(false)}
							onSaved={() => setShowAddForm(false)}
						/>
					</Card>
				)}

				<div className="overflow-hidden rounded-lg border border-border/50 bg-card">
					{policies.length === 0 ? (
						<div className="p-8 text-center text-sm text-muted-foreground">
							{t('srp.policies.empty')}
						</div>
					) : (
						<table className="w-full">
							<thead>
								<tr className="border-b border-border/50 bg-muted/20">
									<th className="p-3 text-left text-xs font-semibold text-muted-foreground">
										{t('srp.common.name')}
									</th>
									{effect === 'payout_modifier' ? (
										<>
											<th className="p-3 text-left text-xs font-semibold text-muted-foreground">
												{t('srp.policies.rate')}
											</th>
											<th className="p-3 text-left text-xs font-semibold text-muted-foreground">
												{t('srp.policies.insurance')}
											</th>
										</>
									) : (
										<th className="p-3 text-left text-xs font-semibold text-muted-foreground">
											{t('srp.policies.maxPayout')}
										</th>
									)}
									<th className="p-3 text-center text-xs font-semibold text-muted-foreground">
										{t('srp.policies.order')}
									</th>
									<th className="p-3 text-center text-xs font-semibold text-muted-foreground">
										{t('srp.policies.active')}
									</th>
									<th className="p-3 text-right text-xs font-semibold text-muted-foreground">
										{t('srp.common.actions')}
									</th>
								</tr>
							</thead>
							<tbody>
								{policies.map((policy) => (
									<PolicyRow key={policy.id} policy={policy} />
								))}
							</tbody>
						</table>
					)}
				</div>
			</CardContent>
		</Card>
	)
}

function PolicyRow({ policy }: { policy: SRPPolicy }) {
	const { t } = useAppTranslation()
	const [editing, setEditing] = useState(false)
	const updateMutation = useUpdatePolicy()
	const deleteMutation = useDeletePolicy()

	const toggleActive = async () => {
		try {
			await updateMutation.mutateAsync({
				id: policy.id,
				data: { ...policy, isActive: !policy.isActive } as any,
			})
			toast.success(
				policy.isActive ? (
					<SRPFeedback messageKey="srp.policies.deactivated" />
				) : (
					<SRPFeedback messageKey="srp.policies.activated" />
				)
			)
		} catch (e: any) {
			toast.error(<SRPFeedback messageKey="srp.policies.updateFailed" />, {
				description: e.message,
			})
		}
	}

	const removePolicy = async () => {
		if (!confirm(t('srp.policies.deleteConfirm'))) return

		try {
			await deleteMutation.mutateAsync(policy.id)
			toast.success(<SRPFeedback messageKey="srp.policies.deleted" />)
		} catch (e: any) {
			toast.error(<SRPFeedback messageKey="srp.policies.deleteFailed" />, {
				description: e.message,
			})
		}
	}

	return (
		<>
			<tr className="border-b border-border/30 hover:bg-muted/10">
				<td className="p-3">
					<div className="font-medium text-sm">{policy.name}</div>
					{policy.description && (
						<div className="text-xs text-muted-foreground">{policy.description}</div>
					)}
				</td>
				{policy.effect === 'payout_modifier' && isPayoutModifierConfig(policy.config) ? (
					<>
						<td className="p-3 text-sm">
							{formatNumber(parseFloat(policy.config.rate), {
								style: 'percent',
								maximumFractionDigits: 0,
							})}
						</td>
						<td className="p-3 text-sm text-muted-foreground">
							{policy.config.applyInsuranceDelta
								? t('srp.policies.deducted')
								: t('srp.policies.notDeducted')}
						</td>
					</>
				) : policy.effect === 'cap' && isCapConfig(policy.config) ? (
					<td className="p-3 text-sm font-mono">
						{formatISK(String(policy.config.maxPayoutMillions * 1_000_000))}
					</td>
				) : null}
				<td className="p-3 text-center text-sm">{policy.displayOrder}</td>
				<td className="p-3">
					<div className="flex items-center justify-center gap-2">
						<Switch
							checked={policy.isActive}
							onCheckedChange={() => void toggleActive()}
							disabled={updateMutation.isPending}
						/>
						<span className="text-xs text-muted-foreground">
							{policy.isActive ? t('srp.policies.active') : t('srp.policies.inactive')}
						</span>
					</div>
				</td>
				<td className="p-3 text-right">
					<div className="flex items-center justify-end gap-1">
						<Button
							variant="ghost"
							size="sm"
							className="h-8 w-8 p-0"
							onClick={() => setEditing((v) => !v)}
							aria-label={t('srp.policies.edit')}
							disabled={deleteMutation.isPending}
						>
							<Edit2 className="h-4 w-4" />
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="h-8 w-8 p-0 text-destructive hover:text-destructive"
							onClick={() => void removePolicy()}
							disabled={deleteMutation.isPending || updateMutation.isPending}
							aria-label={t('srp.policies.delete')}
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					</div>
				</td>
			</tr>
			{editing && (
				<tr className="border-b border-border/30 bg-muted/5">
					<td colSpan={7} className="p-4">
						<PolicyForm
							effect={policy.effect}
							existing={policy}
							onCancel={() => setEditing(false)}
							onSaved={() => setEditing(false)}
						/>
					</td>
				</tr>
			)}
		</>
	)
}

interface PolicyFormProps {
	effect: 'payout_modifier' | 'cap'
	existing?: SRPPolicy
	onCancel: () => void
	onSaved: () => void
}

function PolicyForm({ effect, existing, onCancel, onSaved }: PolicyFormProps) {
	const { t } = useAppTranslation()
	const createMutation = useCreatePolicy()
	const updateMutation = useUpdatePolicy()

	const existingModConfig =
		existing && isPayoutModifierConfig(existing.config) ? existing.config : null
	const existingCapConfig = existing && isCapConfig(existing.config) ? existing.config : null

	const [name, setName] = useState(existing?.name ?? '')
	const [description, setDescription] = useState(existing?.description ?? '')
	const [displayOrder, setDisplayOrder] = useState(String(existing?.displayOrder ?? 0))

	// Payout modifier fields
	const [rate, setRate] = useState(
		existingModConfig ? String(Math.round(parseFloat(existingModConfig.rate) * 100)) : '100'
	)
	const [applyInsurance, setApplyInsurance] = useState(
		existingModConfig?.applyInsuranceDelta ?? true
	)

	// Cap fields
	const [maxPayoutMillions, setMaxPayoutMillions] = useState(
		String(existingCapConfig?.maxPayoutMillions ?? 300)
	)

	const isPending = createMutation.isPending || updateMutation.isPending

	const handleSave = async () => {
		if (!name.trim()) {
			toast.error(<SRPFeedback messageKey="srp.validation.nameRequired" />)
			return
		}

		const config =
			effect === 'payout_modifier'
				? { rate: String(parseInt(rate, 10) / 100), applyInsuranceDelta: applyInsurance }
				: { maxPayoutMillions: parseInt(maxPayoutMillions, 10) }

		const data = {
			name: name.trim(),
			description: description.trim() || undefined,
			effect,
			config,
			displayOrder: parseInt(displayOrder, 10) || 0,
		}

		try {
			if (existing) {
				await updateMutation.mutateAsync({ id: existing.id, data: data as any })
				toast.success(<SRPFeedback messageKey="srp.policies.updated" />)
			} else {
				await createMutation.mutateAsync(data as any)
				toast.success(<SRPFeedback messageKey="srp.policies.created" />)
			}
			onSaved()
		} catch (e: any) {
			toast.error(<SRPFeedback messageKey="srp.policies.saveFailed" />, {
				description: e.message,
			})
		}
	}

	return (
		<div className="space-y-4">
			<div className="grid gap-4 sm:grid-cols-2">
				<div>
					<Label htmlFor="policyName">{t('srp.policies.nameRequired')}</Label>
					<Input
						id="policyName"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder={t('srp.policies.namePlaceholder')}
					/>
				</div>
				<div>
					<Label htmlFor="policyOrder">{t('srp.policies.displayOrder')}</Label>
					<NumberInput
						id="policyOrder"
						step={1}
						allowDecimal={false}
						value={displayOrder}
						onChange={setDisplayOrder}
					/>
				</div>
				<div className="sm:col-span-2">
					<Label htmlFor="policyDesc">{t('srp.policies.descriptionOptional')}</Label>
					<Textarea
						id="policyDesc"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						rows={2}
					/>
				</div>

				{effect === 'payout_modifier' ? (
					<>
						<div>
							<Label htmlFor="policyRate">{t('srp.policies.coverageRate')}</Label>
							<NumberInput
								id="policyRate"
								min={0}
								max={200}
								step={1}
								allowDecimal={false}
								suffix="%"
								value={rate}
								onChange={setRate}
								placeholder="100"
							/>
							<p className="mt-1 text-xs text-muted-foreground">{t('srp.policies.coverageHint')}</p>
						</div>
						<div className="flex items-center gap-3 pt-6">
							<input
								id="applyInsurance"
								type="checkbox"
								checked={applyInsurance}
								onChange={(e) => setApplyInsurance(e.target.checked)}
								className="h-4 w-4"
							/>
							<Label htmlFor="applyInsurance">{t('srp.policies.deductInsurance')}</Label>
						</div>
					</>
				) : (
					<div>
						<Label htmlFor="maxPayout">{t('srp.policies.maxPayoutMillions')}</Label>
						<NumberInput
							id="maxPayout"
							min={0}
							step={1}
							allowDecimal={false}
							value={maxPayoutMillions}
							onChange={setMaxPayoutMillions}
							placeholder="300"
						/>
						<p className="mt-1 text-xs text-muted-foreground">
							{maxPayoutMillions
								? `= ${formatISK(String(parseInt(maxPayoutMillions, 10) * 1_000_000))}`
								: ''}
						</p>
					</div>
				)}
			</div>

			<div className="flex justify-end gap-2">
				<Button variant="cancel" size="sm" onClick={onCancel}>
					{t('srp.common.cancel')}
				</Button>
				<Button size="sm" onClick={handleSave} disabled={isPending}>
					{isPending
						? t('srp.common.saving')
						: existing
							? t('srp.policies.update')
							: t('srp.policies.create')}
				</Button>
			</div>
		</div>
	)
}
