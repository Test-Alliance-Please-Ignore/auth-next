import { ArrowDown, ArrowLeft, ArrowUp } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'

import { RARITY_ORDER } from '@repo/moon-scan'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { usePageTitle } from '@/hooks/usePageTitle'

import { OreCompositionBar } from '../components/OreCompositionBar'
import { ScanStatusBadge } from '../components/ScanStatusBadge'
import { useMoonSystemDetail } from '../hooks'
import { getOreRarity, RARITY_COLORS } from '../ore-rarities'
import { useMoonScanPermissions } from '../permissions'
import { securityStatusTextClass } from '../security-status'
import { filterValidOreTypeIds, getValidCompositionSortOreTypeId } from '../system-view'

import type { OreRarity } from '../types'

interface OreOption {
	value: string
	label: string
	rarity?: OreRarity
}

type SortColumn = 'moonName' | 'composition'
type SortDirection = 'asc' | 'desc'

interface PersistedSystemView {
	selectedOreTypeIds: string[]
	compositionSortOreTypeId: string
	activeSortColumn: SortColumn
	activeSortDirection: SortDirection
}

const SYSTEM_VIEW_STORAGE_PREFIX = 'moon-scan:system-view:'

function readPersistedSystemView(systemId: string | undefined): PersistedSystemView | null {
	if (!systemId || typeof window === 'undefined') return null
	try {
		const raw = window.localStorage.getItem(`${SYSTEM_VIEW_STORAGE_PREFIX}${systemId}`)
		if (!raw) return null
		const parsed = JSON.parse(raw) as Partial<PersistedSystemView>
		return {
			selectedOreTypeIds: Array.isArray(parsed.selectedOreTypeIds)
				? parsed.selectedOreTypeIds.filter((value): value is string => typeof value === 'string')
				: [],
			compositionSortOreTypeId:
				typeof parsed.compositionSortOreTypeId === 'string' ? parsed.compositionSortOreTypeId : '',
			activeSortColumn: parsed.activeSortColumn === 'composition' ? 'composition' : 'moonName',
			activeSortDirection: parsed.activeSortDirection === 'desc' ? 'desc' : 'asc',
		}
	} catch {
		return null
	}
}

function getUrlList(value: string | null): string[] | null {
	return value === null ? null : value.split(',').filter(Boolean)
}

function resolveActiveSortColumn(
	searchParams: URLSearchParams,
	persistedView: PersistedSystemView | null,
	compositionSortOreTypeId: string
): SortColumn {
	if (searchParams.get('sortColumn') === 'composition' && compositionSortOreTypeId) {
		return 'composition'
	}
	if (
		searchParams.has('sortColumn') ||
		searchParams.has('compositionSort') ||
		searchParams.has('sort')
	) {
		return 'moonName'
	}
	return persistedView?.activeSortColumn === 'composition' && persistedView.compositionSortOreTypeId
		? 'composition'
		: 'moonName'
}

function resolveActiveSortDirection(
	searchParams: URLSearchParams,
	persistedView: PersistedSystemView | null
): SortDirection {
	if (searchParams.has('sortColumn')) {
		return searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc'
	}
	if (searchParams.has('compositionSort') || searchParams.has('sort')) return 'asc'
	return persistedView?.activeSortDirection ?? 'asc'
}

function RarityBadge({ rarity }: { rarity: OreRarity }) {
	return (
		<span
			className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold text-white"
			style={{ backgroundColor: RARITY_COLORS[rarity] }}
		>
			{rarity}
		</span>
	)
}

function renderOreOption(option: OreOption) {
	return (
		<div className="flex min-w-0 items-center gap-2">
			{option.rarity ? <RarityBadge rarity={option.rarity} /> : null}
			<span className="truncate">{option.label}</span>
		</div>
	)
}

export default function SystemPage() {
	const { systemId } = useParams<{ systemId: string }>()
	const location = useLocation()
	const [searchParams, setSearchParams] = useSearchParams()
	const { canView } = useMoonScanPermissions()

	const { data: detail, isLoading, error } = useMoonSystemDetail(systemId!, canView)
	const searchParamString = searchParams.toString()
	const persistedView = useMemo(() => readPersistedSystemView(systemId), [systemId])
	const lastSearchParamStringRef = useRef(searchParamString)
	const lastSystemIdRef = useRef(systemId)
	const skipUrlSyncRef = useRef(false)
	const [selectedOreTypeIds, setSelectedOreTypeIds] = useState<string[]>(
		() =>
			getUrlList(searchParams.get('ore')) ??
			getUrlList(searchParams.get('composition')) ??
			persistedView?.selectedOreTypeIds ??
			[]
	)
	const [compositionSortOreTypeId, setCompositionSortOreTypeId] = useState(
		() =>
			searchParams.get('compositionSort') ??
			searchParams.get('sort') ??
			persistedView?.compositionSortOreTypeId ??
			''
	)
	const [activeSortColumn, setActiveSortColumn] = useState<SortColumn>(() =>
		resolveActiveSortColumn(
			searchParams,
			persistedView,
			searchParams.get('compositionSort') ??
				searchParams.get('sort') ??
				persistedView?.compositionSortOreTypeId ??
				''
		)
	)
	const [activeSortDirection, setActiveSortDirection] = useState<SortDirection>(() =>
		resolveActiveSortDirection(searchParams, persistedView)
	)
	const navigationState =
		location.state && typeof location.state === 'object'
			? (location.state as { from?: unknown; systemName?: unknown })
			: null
	const immediateSystemName =
		typeof navigationState?.systemName === 'string' ? navigationState.systemName : null
	const backTo =
		typeof navigationState?.from === 'string' && navigationState.from.startsWith('/moon-scan')
			? navigationState.from
			: '/moon-scan'
	const backLabel = backTo.startsWith('/moon-scan/scanned')
		? 'Back to Scanned Moons'
		: 'Back to Regions'
	usePageTitle(detail?.system?.solarSystemName ?? immediateSystemName ?? 'System')
	useEffect(() => {
		const systemChanged = lastSystemIdRef.current !== systemId
		const urlChanged = lastSearchParamStringRef.current !== searchParamString
		lastSystemIdRef.current = systemId
		lastSearchParamStringRef.current = searchParamString
		if (!systemChanged && !urlChanged) return
		if (!systemChanged && skipUrlSyncRef.current) {
			skipUrlSyncRef.current = false
			return
		}
		skipUrlSyncRef.current = false
		const urlSelectedOreTypeIds =
			getUrlList(searchParams.get('ore')) ?? getUrlList(searchParams.get('composition'))
		const urlCompositionSortOreTypeId =
			searchParams.get('compositionSort') ?? searchParams.get('sort')
		if (urlSelectedOreTypeIds !== null) setSelectedOreTypeIds(urlSelectedOreTypeIds)
		else setSelectedOreTypeIds(persistedView?.selectedOreTypeIds ?? [])
		if (urlCompositionSortOreTypeId !== null) {
			setCompositionSortOreTypeId(urlCompositionSortOreTypeId)
		} else {
			setCompositionSortOreTypeId(persistedView?.compositionSortOreTypeId ?? '')
		}
		setActiveSortColumn(
			resolveActiveSortColumn(searchParams, persistedView, urlCompositionSortOreTypeId ?? '')
		)
		setActiveSortDirection(resolveActiveSortDirection(searchParams, persistedView))
	}, [persistedView, searchParamString, searchParams, systemId])
	useEffect(() => {
		if (!systemId || typeof window === 'undefined') return
		try {
			window.localStorage.setItem(
				`${SYSTEM_VIEW_STORAGE_PREFIX}${systemId}`,
				JSON.stringify({
					selectedOreTypeIds,
					compositionSortOreTypeId,
					activeSortColumn,
					activeSortDirection,
				} satisfies PersistedSystemView)
			)
		} catch {
			// Local storage is an enhancement; private browsing or quota errors are non-fatal.
		}
	}, [
		activeSortColumn,
		activeSortDirection,
		compositionSortOreTypeId,
		selectedOreTypeIds,
		systemId,
	])
	const updateUrl = (updates: Record<string, string | null>) => {
		const next = new URLSearchParams(searchParams)
		for (const [key, value] of Object.entries(updates)) {
			if (value === null || value === '') next.delete(key)
			else next.set(key, value)
		}
		if (next.toString() === searchParamString) return
		skipUrlSyncRef.current = true
		setSearchParams(next, { replace: true })
	}
	const updateSystemView = (updates: Record<string, string | null>) => {
		updateUrl(updates)
	}
	const sys = detail?.system
	const secStatus =
		sys?.securityStatus !== null && sys?.securityStatus !== undefined
			? parseFloat(sys.securityStatus)
			: null

	const secColor = securityStatusTextClass(secStatus)
	const oreOptions = useMemo<OreOption[]>(() => {
		const options = new Map<string, OreOption>()
		for (const moon of detail?.moons ?? []) {
			for (const ore of moon.composition?.ores ?? []) {
				if (options.has(ore.oreTypeId)) continue
				const rarity = getOreRarity(ore.oreTypeId)
				options.set(ore.oreTypeId, {
					value: ore.oreTypeId,
					label: ore.oreTypeName ?? ore.oreTypeId,
					rarity,
				})
			}
		}
		return [...options.values()].sort((a, b) => {
			const rarityComparison =
				(b.rarity ? RARITY_ORDER[b.rarity] : Number.MIN_SAFE_INTEGER) -
				(a.rarity ? RARITY_ORDER[a.rarity] : Number.MIN_SAFE_INTEGER)
			return rarityComparison || a.label.localeCompare(b.label)
		})
	}, [detail?.moons])
	const compositionSortOptions = oreOptions
	const availableOreTypeIds = useMemo(
		() => new Set(oreOptions.map((option) => option.value)),
		[oreOptions]
	)
	const validSelectedOreTypeIds = useMemo(
		() => filterValidOreTypeIds(selectedOreTypeIds, availableOreTypeIds),
		[availableOreTypeIds, selectedOreTypeIds]
	)
	const validCompositionSortOreTypeId = getValidCompositionSortOreTypeId(
		compositionSortOreTypeId,
		availableOreTypeIds
	)
	const effectiveSortColumn =
		activeSortColumn === 'composition' && validCompositionSortOreTypeId
			? activeSortColumn
			: 'moonName'
	useEffect(() => {
		if (!detail) return
		if (validSelectedOreTypeIds.length !== selectedOreTypeIds.length) {
			setSelectedOreTypeIds(validSelectedOreTypeIds)
		}
		if (validCompositionSortOreTypeId !== compositionSortOreTypeId) {
			setCompositionSortOreTypeId(validCompositionSortOreTypeId)
		}
		if (activeSortColumn === 'composition' && !validCompositionSortOreTypeId) {
			setActiveSortColumn('moonName')
		}
	}, [
		activeSortColumn,
		compositionSortOreTypeId,
		detail,
		selectedOreTypeIds.length,
		validCompositionSortOreTypeId,
		validSelectedOreTypeIds,
	])
	const visibleMoons = useMemo(() => {
		const filteredMoons = (detail?.moons ?? []).filter(
			(moon) =>
				validSelectedOreTypeIds.length === 0 ||
				validSelectedOreTypeIds.some((oreTypeId) =>
					moon.composition?.ores.some((ore) => ore.oreTypeId === oreTypeId)
				)
		)

		return [...filteredMoons].sort((a, b) => {
			if (effectiveSortColumn === 'moonName') {
				const comparison = a.moonName.localeCompare(b.moonName)
				return activeSortDirection === 'asc' ? comparison : -comparison
			}
			const aQuantity = Number.parseFloat(
				a.composition?.ores.find((ore) => ore.oreTypeId === validCompositionSortOreTypeId)
					?.quantity ?? '0'
			)
			const bQuantity = Number.parseFloat(
				b.composition?.ores.find((ore) => ore.oreTypeId === validCompositionSortOreTypeId)
					?.quantity ?? '0'
			)
			const aPercentage = aQuantity * 100
			const bPercentage = bQuantity * 100
			const comparison = bPercentage - aPercentage || a.moonName.localeCompare(b.moonName)
			return activeSortDirection === 'asc' ? comparison : -comparison
		})
	}, [
		activeSortColumn,
		activeSortDirection,
		effectiveSortColumn,
		validCompositionSortOreTypeId,
		detail?.moons,
		validSelectedOreTypeIds,
	])
	const handleSort = (column: SortColumn) => {
		if (column === 'composition' && !validCompositionSortOreTypeId) return
		const nextDirection =
			activeSortColumn === column
				? activeSortDirection === 'asc'
					? 'desc'
					: 'asc'
				: column === 'composition'
					? 'desc'
					: 'asc'
		setActiveSortColumn(column)
		setActiveSortDirection(nextDirection)
		updateSystemView({ sortColumn: column, sortDir: nextDirection })
	}
	const resetSystemView = () => {
		setSelectedOreTypeIds([])
		setCompositionSortOreTypeId('')
		setActiveSortColumn('moonName')
		setActiveSortDirection('asc')
		updateSystemView({
			ore: null,
			composition: null,
			compositionSort: null,
			sort: null,
			sortColumn: null,
			sortDir: null,
		})
	}
	const hasActiveSystemView =
		validSelectedOreTypeIds.length > 0 ||
		validCompositionSortOreTypeId !== '' ||
		effectiveSortColumn !== 'moonName' ||
		activeSortDirection !== 'asc'
	const SortIndicator = ({ column }: { column: SortColumn }) => {
		if (effectiveSortColumn !== column) return null
		return activeSortDirection === 'asc' ? (
			<ArrowUp className="h-3.5 w-3.5" />
		) : (
			<ArrowDown className="h-3.5 w-3.5" />
		)
	}
	if (!canView) {
		return (
			<Container>
				<PageHeader
					title="System Detail"
					description="You do not have permission to view moon data."
				/>
			</Container>
		)
	}

	const verifiedMoons = (detail?.moons ?? []).filter((m) => m.isVerified).length
	const scannedMoons = (detail?.moons ?? []).filter((m) => m.hasScans).length

	return (
		<Container>
			<div className="mb-section md:mb-10">
				<div className="flex items-start justify-between gap-4">
					<div className="space-y-3">
						<div className="flex items-center gap-3">
							<h1 className="text-4xl md:text-5xl font-bold leading-none gradient-text">
								{sys?.solarSystemName ?? immediateSystemName ?? 'System'}
							</h1>
							{sys && (
								<span className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm">
									<span className="text-muted-foreground">Security</span>
									<span className={`font-mono font-semibold tabular-nums ${secColor}`}>
										{secStatus !== null ? secStatus.toFixed(2) : '—'}
									</span>
								</span>
							)}
						</div>
						<p className="text-muted-foreground text-lg">
							{isLoading
								? 'Loading…'
								: `${detail?.moons.length ?? 0} moons · ${scannedMoons} scanned · ${verifiedMoons} verified`}
						</p>
					</div>
					<div className="flex flex-col items-end gap-2">
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Link to="/moon-scan" className="hover:underline">
								Moon Scanning
							</Link>
							<span>/</span>
							<span>{sys?.solarSystemName ?? immediateSystemName ?? 'System'}</span>
						</div>
						<Button variant="ghost" size="sm" asChild>
							<Link to={backTo}>
								<ArrowLeft className="mr-2 h-4 w-4" />
								{backLabel}
							</Link>
						</Button>
					</div>
				</div>
			</div>

			{error && (
				<div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-500">
					Failed to load system data
				</div>
			)}

			<div className="mt-4 flex flex-wrap items-end gap-3 rounded-md border bg-card p-4">
				<div className="w-full sm:w-72">
					<div className="mb-1.5 text-xs font-medium text-muted-foreground">
						Compositions present
					</div>
					<Select<OreOption>
						options={oreOptions}
						values={validSelectedOreTypeIds}
						onValuesChange={(values) => {
							setSelectedOreTypeIds(values)
							updateUrl({ ore: values.length > 0 ? values.join(',') : null, composition: null })
						}}
						multiple
						searchable
						placeholder="All compositions"
						disabled={oreOptions.length === 0}
						renderOption={renderOreOption}
						inputClassName="h-9"
					/>
				</div>
				<div className="w-full sm:w-72">
					<div className="mb-1.5 text-xs font-medium text-muted-foreground">
						Sort composition by
					</div>
					<Select<OreOption>
						options={compositionSortOptions}
						value={validCompositionSortOreTypeId}
						onValueChange={(value) => {
							setCompositionSortOreTypeId(value)
							updateUrl({ compositionSort: value || null, sort: null })
						}}
						placeholder="No composition sort"
						searchable
						renderOption={renderOreOption}
						inputClassName="h-9"
					/>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={resetSystemView}
					disabled={!hasActiveSystemView}
				>
					Reset
				</Button>
			</div>

			<div className="mt-8 rounded-md border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead
								aria-sort={
									activeSortColumn === 'moonName'
										? activeSortDirection === 'asc'
											? 'ascending'
											: 'descending'
										: 'none'
								}
							>
								<button
									type="button"
									onClick={() => handleSort('moonName')}
									className="inline-flex items-center gap-1.5 hover:text-foreground"
								>
									Moon <SortIndicator column="moonName" />
								</button>
							</TableHead>
							<TableHead>Status</TableHead>
							<TableHead
								className="w-96"
								aria-sort={
									activeSortColumn === 'composition'
										? activeSortDirection === 'asc'
											? 'ascending'
											: 'descending'
										: 'none'
								}
							>
								<button
									type="button"
									onClick={() => handleSort('composition')}
									disabled={!compositionSortOreTypeId}
									className="inline-flex items-center gap-1.5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
								>
									Composition <SortIndicator column="composition" />
								</button>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading
							? Array.from({ length: 4 }).map((_, i) => (
									<TableRow key={i}>
										{Array.from({ length: 3 }).map((__, j) => (
											<TableCell key={j}>
												<Skeleton className="h-4 w-28" />
											</TableCell>
										))}
									</TableRow>
								))
							: visibleMoons.map((moon) => (
									<TableRow key={moon.moonId}>
										<TableCell>
											<Link
												to={`/moon-scan/moon/${moon.moonId}`}
												state={{
													from: `${location.pathname}${location.search}`,
													systemFrom: backTo,
													moonName: moon.moonName,
													solarSystemName: sys?.solarSystemName,
												}}
												className="hover:underline text-foreground"
											>
												{moon.moonName}
											</Link>
										</TableCell>
										<TableCell>
											{moon.isVerified ? (
												<ScanStatusBadge status="verified" />
											) : moon.hasScans ? (
												<ScanStatusBadge status="pending" />
											) : (
												<Badge variant="ghost" className="text-muted-foreground">
													No data
												</Badge>
											)}
										</TableCell>
										<TableCell>
											{moon.composition ? (
												<OreCompositionBar ores={moon.composition.ores} />
											) : (
												<span className="text-xs text-muted-foreground">—</span>
											)}
										</TableCell>
									</TableRow>
								))}
						{!isLoading && visibleMoons.length === 0 && (
							<TableRow>
								<TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
									{detail?.moons.length
										? 'No moons match the current filters.'
										: 'No moons found in this system.'}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
		</Container>
	)
}
