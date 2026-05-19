import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'

import { useAdminSettings, useUpdateExtractionSettings, useUpdateStructureProfile } from '../../hooks'
import { useMoonScanPermissions } from '../../permissions'

import type { ExtractionSettings, StructureProfile, StructureType } from '../../types'

interface ProfileDraft {
	baseVolumePerHr: string
	fuelPerHr: string
	magmaticGasPerHr: string | null
}

function ProfileRow({
	label,
	profile,
	onSave,
	isSaving,
}: {
	label: string
	profile: StructureProfile
	onSave: (draft: ProfileDraft) => void
	isSaving: boolean
}) {
	const [draft, setDraft] = useState<ProfileDraft>({
		baseVolumePerHr: profile.baseVolumePerHr,
		fuelPerHr: profile.fuelPerHr,
		magmaticGasPerHr: profile.magmaticGasPerHr,
	})

	return (
		<div className="rounded-md border p-4">
			<div className="mb-3 flex items-center justify-between gap-3">
				<div className="font-medium">{label}</div>
				{profile.isPassive ? <Badge variant="secondary">Passive</Badge> : <Badge>Active</Badge>}
			</div>
			<div className="grid gap-4 sm:grid-cols-3">
				<div>
					<Label>Base Rate (m³/hr)</Label>
					<Input
						type="number"
						className="mt-1 text-sm font-mono"
						value={draft.baseVolumePerHr}
						step="0.01"
						onChange={(e) => setDraft((d) => ({ ...d, baseVolumePerHr: e.target.value }))}
					/>
				</div>
				<div>
					<Label>Fuel Blocks/hr</Label>
					<Input
						type="number"
						className="mt-1 text-sm font-mono"
						value={draft.fuelPerHr}
						step="0.1"
						onChange={(e) => setDraft((d) => ({ ...d, fuelPerHr: e.target.value }))}
					/>
				</div>
				<div>
					<Label>Magmatic Gas/hr</Label>
					{draft.magmaticGasPerHr !== null ? (
						<Input
							type="number"
							className="mt-1 text-sm font-mono"
							value={draft.magmaticGasPerHr}
							step="0.1"
							onChange={(e) => setDraft((d) => ({ ...d, magmaticGasPerHr: e.target.value }))}
						/>
					) : (
						<Input className="mt-1 text-sm font-mono" value="0.0" disabled />
					)}
				</div>
			</div>
			<div className="mt-4 flex justify-end">
				<Button size="sm" onClick={() => onSave(draft)} disabled={isSaving}>Save</Button>
			</div>
		</div>
	)
}

function GlobalSettingsForm({
	settings,
	onSave,
	isSaving,
}: {
	settings: ExtractionSettings
	onSave: (s: Partial<ExtractionSettings>) => void
	isSaving: boolean
}) {
	const [draft, setDraft] = useState({
		defaultCycleDays: String(settings.defaultCycleDays),
		defaultReprocessingYield: settings.defaultReprocessingYield,
		fuelBlockPriceOverride: settings.fuelBlockPriceOverride ?? '0',
		magmaticGasPriceOverride: settings.magmaticGasPriceOverride ?? '0',
	})

	const rows: Array<{ key: keyof typeof draft; label: string; step: string; description: string }> = [
		{
			key: 'defaultCycleDays',
			label: 'Default Cycle Days',
			step: '1',
			description: 'Default cycle days for Metenox and Refinery profit calculations.',
		},
		{
			key: 'defaultReprocessingYield',
			label: 'Default Reprocessing Yield',
			step: '0.0001',
			description: 'Default reprocessing efficiency (0.0–1.0). Typical for well-skilled Tatara.',
		},
		{
			key: 'fuelBlockPriceOverride',
			label: 'Fuel Block Price Override',
			step: '0.0001',
			description: 'Override fuel block price (0 = use cheapest Jita sell).',
		},
		{
			key: 'magmaticGasPriceOverride',
			label: 'Magmatic Gas Price Override',
			step: '0.0001',
			description: 'Override Magmatic Gas price (0 = use Jita sell).',
		},
	]

	return (
		<div className="space-y-4">
			<div className="grid gap-4 sm:grid-cols-2">
				{rows.map(({ key, label, step, description }) => (
					<div key={key}>
						<Label>{label}</Label>
						<Input
							type="number"
							className="mt-1 text-sm font-mono"
							value={draft[key]}
							step={step}
							onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
						/>
						<p className="mt-1 text-xs text-muted-foreground">{description}</p>
					</div>
				))}
			</div>
			<div className="flex justify-end border-t pt-4">
				<Button
					onClick={() => onSave({
						defaultCycleDays: parseInt(draft.defaultCycleDays, 10),
						defaultReprocessingYield: draft.defaultReprocessingYield,
						fuelBlockPriceOverride: draft.fuelBlockPriceOverride === '0' ? null : draft.fuelBlockPriceOverride,
						magmaticGasPriceOverride: draft.magmaticGasPriceOverride === '0' ? null : draft.magmaticGasPriceOverride,
					})}
					disabled={isSaving}
				>
					Save All Settings
				</Button>
			</div>
		</div>
	)
}

const PROFILE_ROWS: Array<{ id: StructureType; label: string }> = [
	{ id: 'metenox', label: 'Metenox Moon Drill' },
	{ id: 'tatara', label: 'Refinery' },
]

export default function AdminSettingsPage() {
	const { canAdmin } = useMoonScanPermissions()

	const { data, isLoading, error } = useAdminSettings()
	const updateSettings = useUpdateExtractionSettings()
	const updateProfile = useUpdateStructureProfile()

	if (!canAdmin) {
		return (
			<Container>
				<PageHeader title="Configuration" description="You do not have permission to manage moon settings." />
			</Container>
		)
	}

	const isSaving = updateSettings.isPending || updateProfile.isPending

	return (
		<Container>
			<PageHeader
				title="Configuration"
				description="Configure moon scanning defaults and structure extraction profiles."
			/>

			{error && (
				<div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-500">
					Failed to load settings
				</div>
			)}

			{isLoading ? (
				<div className="mt-section space-y-3">
					{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
				</div>
			) : data && (
				<div className="mt-section space-y-6">

					{/* Structure Profiles */}
					<Card>
						<CardHeader>
							<CardTitle className="text-lg">Structure Profiles</CardTitle>
							<CardDescription>
								Configure extraction rates and hourly consumables for each moon extraction structure type.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{PROFILE_ROWS.map(({ id, label }) => {
								const profile = data.profiles.find((p) => p.id === id)
								if (!profile) return null
								return (
									<ProfileRow
										key={id}
										label={label}
										profile={profile}
										isSaving={isSaving}
										onSave={(draft) => updateProfile.mutate({ id, profile: draft })}
									/>
								)
							})}
						</CardContent>
					</Card>

					{/* Global Settings */}
					<Card>
						<CardHeader>
							<CardTitle className="text-lg">Global Extraction Settings</CardTitle>
							<CardDescription>
								Set defaults for cycle duration, reprocessing yield, and optional live market price overrides.
							</CardDescription>
						</CardHeader>
						<CardContent>
						<GlobalSettingsForm
							settings={data.settings}
							isSaving={isSaving}
							onSave={(s) => updateSettings.mutate(s)}
						/>
						</CardContent>
					</Card>

				</div>
			)}
		</Container>
	)
}
