import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'

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
		<TableRow>
			<TableCell className="font-medium whitespace-nowrap">{label}</TableCell>
			<TableCell>
				{profile.isPassive
					? <Badge variant="secondary">Passive</Badge>
					: <Badge>Active</Badge>}
			</TableCell>
			<TableCell>
				<Input
					type="number"
					className="w-28 rounded border bg-background px-2 py-1 text-sm font-mono"
					value={draft.baseVolumePerHr}
					step="0.01"
					onChange={(e) => setDraft((d) => ({ ...d, baseVolumePerHr: e.target.value }))}
				/>
			</TableCell>
			<TableCell>
				<Input
					type="number"
					className="w-24 rounded border bg-background px-2 py-1 text-sm font-mono"
					value={draft.fuelPerHr}
					step="0.1"
					onChange={(e) => setDraft((d) => ({ ...d, fuelPerHr: e.target.value }))}
				/>
			</TableCell>
			<TableCell>
				{draft.magmaticGasPerHr !== null ? (
						<Input
							type="number"
							className="w-24 rounded border bg-background px-2 py-1 text-sm font-mono"
							value={draft.magmaticGasPerHr}
							step="0.1"
							onChange={(e) => setDraft((d) => ({ ...d, magmaticGasPerHr: e.target.value }))}
						/>
				) : (
					<span className="text-muted-foreground tabular-nums">0.0</span>
				)}
			</TableCell>
			<TableCell>
				<Button size="sm" onClick={() => onSave(draft)} disabled={isSaving}>Save</Button>
			</TableCell>
		</TableRow>
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
			label: 'default_cycle_days',
			step: '1',
			description: 'Default cycle days for Metenox and Refinery profit calculations.',
		},
		{
			key: 'defaultReprocessingYield',
			label: 'default_reprocessing_yield',
			step: '0.0001',
			description: 'Default reprocessing efficiency (0.0–1.0). Typical for well-skilled Tatara.',
		},
		{
			key: 'fuelBlockPriceOverride',
			label: 'fuel_block_price_override',
			step: '0.0001',
			description: 'Override fuel block price (0 = use cheapest Jita sell).',
		},
		{
			key: 'magmaticGasPriceOverride',
			label: 'magmatic_gas_price_override',
			step: '0.0001',
			description: 'Override Magmatic Gas price (0 = use Jita sell).',
		},
	]

	return (
		<div>
			<div className="overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Setting</TableHead>
							<TableHead>Value</TableHead>
							<TableHead>Description</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map(({ key, label, step, description }) => (
							<TableRow key={key}>
								<TableCell className="font-mono text-xs whitespace-nowrap">{label}</TableCell>
								<TableCell>
										<Input
											type="number"
											className="w-36 rounded border bg-background px-2 py-1 text-sm font-mono"
											value={draft[key]}
											step={step}
											onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
										/>
								</TableCell>
								<TableCell className="text-xs text-muted-foreground">{description}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			<div className="px-4 py-3 border-t">
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
				<PageHeader title="Extraction Settings" description="You do not have permission to manage moon settings." />
			</Container>
		)
	}

	const isSaving = updateSettings.isPending || updateProfile.isPending

	return (
		<Container>
			<PageHeader
				title="Extraction Settings"
				description="Configure structure profiles and global extraction parameters."
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
					<div className="rounded-md border bg-card">
						<div className="border-b px-4 py-3 text-sm font-semibold">Structure Profiles</div>
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Structure</TableHead>
										<TableHead>Extraction Type</TableHead>
										<TableHead>Base Rate (m³/hr)</TableHead>
										<TableHead>Fuel Blocks/hr</TableHead>
										<TableHead>Magmatic Gas/hr</TableHead>
										<TableHead>Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
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
								</TableBody>
							</Table>
						</div>
					</div>

					{/* Global Settings */}
					<div className="rounded-md border bg-card">
						<div className="border-b px-4 py-3 text-sm font-semibold">Global Extraction Settings</div>
						<GlobalSettingsForm
							settings={data.settings}
							isSaving={isSaving}
							onSave={(s) => updateSettings.mutate(s)}
						/>
					</div>

				</div>
			)}
		</Container>
	)
}
