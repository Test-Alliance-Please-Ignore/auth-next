/**
 * Assets Section - Grouped by location with expandable groups and item icons
 */

import { ChevronDown, ChevronRight, Package, Search } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { typeImageUrl } from '@/lib/eve-images'
import { Input } from '@/components/ui/input'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'

interface ProcessedAsset {
	item_id: string
	type_id: string
	typeName?: string
	customName?: string
	locationName?: string
	categoryName?: string
	marketGroupName?: string
	quantity: number
	is_singleton: boolean
	is_blueprint_copy?: boolean
	location_flag: string
	averagePrice?: number
	estimatedValue?: number
	containerItemId?: string
	containerName?: string
}

interface ContainerGroup {
	containerItemId: string
	containerName: string
	assets: ProcessedAsset[]
	totalItems: number
	estimatedValue: number
}

interface LocationGroup {
	locationName: string
	looseAssets: ProcessedAsset[]
	containers: ContainerGroup[]
	totalItems: number
	estimatedValue: number
}

function formatIsk(value: number): string {
	if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B ISK`
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ISK`
	if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K ISK`
	return `${value.toLocaleString()} ISK`
}

function ItemIcon({ typeId, categoryName, isBpc }: { typeId: string; categoryName?: string; isBpc?: boolean }) {
	const [failed, setFailed] = useState(false)

	if (failed) {
		return (
			<div className="h-6 w-6 shrink-0 rounded bg-muted flex items-center justify-center">
				<Package className="h-3.5 w-3.5 text-muted-foreground" />
			</div>
		)
	}

	// Blueprints use /bp or /bpc endpoint, not /icon
	let variant = 'icon'
	if (categoryName === 'Blueprint') {
		variant = isBpc ? 'bpc' : 'bp'
	}

	return (
		<img
			src={typeImageUrl(typeId, variant, 32)}
			alt=""
			className="h-6 w-6 shrink-0 rounded"
			loading="lazy"
			onError={() => setFailed(true)}
		/>
	)
}

function AssetRow({ asset }: { asset: ProcessedAsset }) {
	return (
		<TableRow key={asset.item_id}>
			<TableCell className="w-10 pr-0">
				<ItemIcon typeId={asset.type_id} categoryName={asset.categoryName} isBpc={asset.is_blueprint_copy} />
			</TableCell>
			<TableCell className="font-medium">
				<div>
					{asset.typeName || asset.type_id}
					{asset.customName && (
						<span className="ml-2 text-xs italic text-muted-foreground">
							&ldquo;{asset.customName}&rdquo;
						</span>
					)}
				</div>
			</TableCell>
			<TableCell className="text-sm text-muted-foreground">
				{asset.categoryName || '-'}
			</TableCell>
			<TableCell className="text-right font-mono">
				{asset.quantity.toLocaleString()}
			</TableCell>
			<TableCell className="text-right font-mono text-xs text-muted-foreground">
				{asset.estimatedValue ? formatIsk(asset.estimatedValue) : '-'}
			</TableCell>
		</TableRow>
	)
}

function ContainerRows({
	container,
	isExpanded,
	onToggle,
}: {
	container: ContainerGroup
	isExpanded: boolean
	onToggle: () => void
}) {
	return (
		<>
			<TableRow
				className="cursor-pointer hover:bg-muted/50"
				onClick={onToggle}
			>
				<TableCell className="w-10 pr-0">
					{isExpanded ? (
						<ChevronDown className="h-4 w-4 text-muted-foreground" />
					) : (
						<ChevronRight className="h-4 w-4 text-muted-foreground" />
					)}
				</TableCell>
				<TableCell className="font-medium">
					<div className="flex items-center gap-2">
						<Package className="h-4 w-4 text-muted-foreground shrink-0" />
						<span>{container.containerName}</span>
						<span className="text-xs text-muted-foreground">
							({container.assets.length} item{container.assets.length !== 1 ? 's' : ''})
						</span>
					</div>
				</TableCell>
				<TableCell className="text-sm text-muted-foreground">Container</TableCell>
				<TableCell className="text-right font-mono">
					{container.totalItems.toLocaleString()}
				</TableCell>
				<TableCell className="text-right font-mono text-xs text-muted-foreground">
					{container.estimatedValue > 0 ? formatIsk(container.estimatedValue) : '-'}
				</TableCell>
			</TableRow>
			{isExpanded &&
				container.assets.map((asset) => (
					<TableRow key={asset.item_id} className="bg-muted/20">
						<TableCell className="w-10 pr-0 pl-4">
							<ItemIcon typeId={asset.type_id} categoryName={asset.categoryName} isBpc={asset.is_blueprint_copy} />
						</TableCell>
						<TableCell className="font-medium pl-8">
							<div>
								{asset.typeName || asset.type_id}
								{asset.customName && (
									<span className="ml-2 text-xs italic text-muted-foreground">
										&ldquo;{asset.customName}&rdquo;
									</span>
								)}
							</div>
						</TableCell>
						<TableCell className="text-sm text-muted-foreground">
							{asset.categoryName || '-'}
						</TableCell>
						<TableCell className="text-right font-mono">
							{asset.quantity.toLocaleString()}
						</TableCell>
						<TableCell className="text-right font-mono text-xs text-muted-foreground">
							{asset.estimatedValue ? formatIsk(asset.estimatedValue) : '-'}
						</TableCell>
					</TableRow>
				))}
		</>
	)
}

export function AssetsSection({ data }: { data: ProcessedAsset[] }) {
	const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set())
	const [expandedContainers, setExpandedContainers] = useState<Set<string>>(new Set())
	const [search, setSearch] = useState('')

	const groups = useMemo(() => {
		const filtered = search
			? data.filter((a) => {
				const q = search.toLowerCase()
				return (
					a.typeName?.toLowerCase().includes(q) ||
					a.customName?.toLowerCase().includes(q) ||
					a.categoryName?.toLowerCase().includes(q) ||
					a.locationName?.toLowerCase().includes(q) ||
					a.marketGroupName?.toLowerCase().includes(q) ||
					a.containerName?.toLowerCase().includes(q)
				)
			})
			: data

		// Collect all container item IDs so we can exclude the container items
		// themselves from the loose asset list (they show as expandable headers)
		const containerItemIds = new Set<string>()
		for (const asset of filtered) {
			if (asset.containerItemId) {
				containerItemIds.add(asset.containerItemId)
			}
		}

		const locationMap = new Map<string, { loose: ProcessedAsset[]; containerMap: Map<string, { name: string; assets: ProcessedAsset[] }> }>()

		for (const asset of filtered) {
			const loc = asset.locationName || 'Unknown Location'
			if (!locationMap.has(loc)) {
				locationMap.set(loc, { loose: [], containerMap: new Map() })
			}
			const group = locationMap.get(loc)!

			if (asset.containerItemId) {
				const cId = asset.containerItemId
				if (!group.containerMap.has(cId)) {
					group.containerMap.set(cId, {
						name: asset.containerName || 'Unknown Container',
						assets: [],
					})
				}
				group.containerMap.get(cId)!.assets.push(asset)
			} else if (!containerItemIds.has(asset.item_id)) {
				// Skip container items themselves - they're shown as expandable headers
				group.loose.push(asset)
			}
		}

		const result: LocationGroup[] = []
		for (const [locationName, { loose, containerMap }] of locationMap) {
			const containers: ContainerGroup[] = []
			for (const [containerItemId, { name, assets }] of containerMap) {
				containers.push({
					containerItemId,
					containerName: name,
					assets: assets.sort((a, b) => (a.typeName ?? '').localeCompare(b.typeName ?? '')),
					totalItems: assets.reduce((sum, a) => sum + a.quantity, 0),
					estimatedValue: assets.reduce((sum, a) => sum + (a.estimatedValue ?? 0), 0),
				})
			}
			containers.sort((a, b) => a.containerName.localeCompare(b.containerName))

			const looseAssets = loose.sort((a, b) => (a.typeName ?? '').localeCompare(b.typeName ?? ''))
			const allAssets = [...loose, ...containers.flatMap((c) => c.assets)]

			result.push({
				locationName,
				looseAssets,
				containers,
				totalItems: allAssets.reduce((sum, a) => sum + a.quantity, 0),
				estimatedValue: allAssets.reduce((sum, a) => sum + (a.estimatedValue ?? 0), 0),
			})
		}
		return result.sort((a, b) => {
			const aCount = a.looseAssets.length + a.containers.reduce((s, c) => s + c.assets.length, 0)
			const bCount = b.looseAssets.length + b.containers.reduce((s, c) => s + c.assets.length, 0)
			return bCount - aCount
		})
	}, [data, search])

	const toggleLocation = useCallback((loc: string) => {
		setExpandedLocations((prev) => {
			const next = new Set(prev)
			if (next.has(loc)) {
				next.delete(loc)
			} else {
				next.add(loc)
			}
			return next
		})
	}, [])

	const toggleContainer = useCallback((containerId: string) => {
		setExpandedContainers((prev) => {
			const next = new Set(prev)
			if (next.has(containerId)) {
				next.delete(containerId)
			} else {
				next.add(containerId)
			}
			return next
		})
	}, [])

	const totalEstimatedValue = useMemo(
		() => groups.reduce((sum, g) => sum + g.estimatedValue, 0),
		[groups],
	)

	if (data.length === 0) {
		return <p className="text-sm text-muted-foreground">No assets found.</p>
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-4">
				<div className="space-y-0.5">
					<p className="text-sm text-muted-foreground">
						{data.length} asset{data.length !== 1 ? 's' : ''} across {groups.length} location
						{groups.length !== 1 ? 's' : ''}
					</p>
					{totalEstimatedValue > 0 && (
						<p className="text-xs text-muted-foreground">
							Total est. value:{' '}
							<span className="font-mono font-medium text-foreground">
								{formatIsk(totalEstimatedValue)}
							</span>
						</p>
					)}
				</div>
				<div className="relative w-64">
					<Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
					<Input
						placeholder="Search assets..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="pl-9 h-9"
					/>
				</div>
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						onClick={() => {
							setExpandedLocations(new Set(groups.map((group) => group.locationName)))
							setExpandedContainers(
								new Set(groups.flatMap((group) => group.containers.map((container) => container.containerItemId)))
							)
						}}
						className="rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
					>
						Expand all
					</button>
					<button
						type="button"
						onClick={() => {
							setExpandedLocations(new Set())
							setExpandedContainers(new Set())
						}}
						className="rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
					>
						Collapse all
					</button>
				</div>
			</div>

			<div className="space-y-1">
				{groups.map((group) => {
					const isExpanded = expandedLocations.has(group.locationName)
					const itemCount =
						group.looseAssets.length +
						group.containers.reduce((s, c) => s + c.assets.length, 0)
					return (
						<div key={group.locationName}>
							<button
								type="button"
								onClick={() => toggleLocation(group.locationName)}
								className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/50 transition-colors"
							>
								{isExpanded ? (
									<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
								) : (
									<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
								)}
								<span className="font-medium text-sm flex-1 truncate">
									{group.locationName}
								</span>
								<span className="text-xs text-muted-foreground">
									{itemCount} item{itemCount !== 1 ? 's' : ''}
									{group.containers.length > 0 && (
										<span className="ml-1">
											({group.containers.length} container{group.containers.length !== 1 ? 's' : ''})
										</span>
									)}
									{group.estimatedValue > 0 && (
										<span className="ml-2 font-mono">
											· {formatIsk(group.estimatedValue)}
										</span>
									)}
								</span>
							</button>

							{isExpanded && (
								<div className="ml-6 overflow-hidden rounded-md border">
									<Table>
										<TableHeader>
											<TableRow className="bg-muted/50">
												<TableHead className="w-10" />
												<TableHead className="font-semibold">Item</TableHead>
												<TableHead className="font-semibold">Category</TableHead>
												<TableHead className="text-right font-semibold">Qty</TableHead>
												<TableHead className="text-right font-semibold">Est. Value</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{group.containers.map((container) => (
												<ContainerRows
													key={container.containerItemId}
													container={container}
													isExpanded={expandedContainers.has(container.containerItemId)}
													onToggle={() => toggleContainer(container.containerItemId)}
												/>
											))}
											{group.looseAssets.map((asset) => (
												<AssetRow key={asset.item_id} asset={asset} />
											))}
										</TableBody>
									</Table>
								</div>
							)}
						</div>
					)
				})}

				{groups.length === 0 && search && (
					<p className="py-8 text-center text-sm text-muted-foreground">
						No assets matching &ldquo;{search}&rdquo;
					</p>
				)}
			</div>
		</div>
	)
}
