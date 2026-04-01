/**
 * Assets Section - Grouped by location with expandable groups and item icons
 */

import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Input } from '@/components/ui/input'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

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
	location_flag: string
	averagePrice?: number
	estimatedValue?: number
}

interface LocationGroup {
	locationName: string
	assets: ProcessedAsset[]
	totalItems: number
	estimatedValue: number
}

function formatIsk(value: number): string {
	if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B ISK`
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ISK`
	if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K ISK`
	return `${value.toLocaleString()} ISK`
}

function ItemIcon({ typeId }: { typeId: string }) {
	return (
		<img
			src={`https://images.evetech.net/types/${typeId}/icon?size=32`}
			alt=""
			className="h-6 w-6 rounded"
			loading="lazy"
		/>
	)
}

export function AssetsSection({ data }: { data: ProcessedAsset[] }) {
	const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set())
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
					a.marketGroupName?.toLowerCase().includes(q)
				)
			})
			: data

		const map = new Map<string, ProcessedAsset[]>()
		for (const asset of filtered) {
			const loc = asset.locationName || 'Unknown Location'
			const existing = map.get(loc)
			if (existing) {
				existing.push(asset)
			} else {
				map.set(loc, [asset])
			}
		}

		const result: LocationGroup[] = []
		for (const [locationName, assets] of map) {
			result.push({
				locationName,
				assets: assets.sort((a, b) => (a.typeName ?? '').localeCompare(b.typeName ?? '')),
				totalItems: assets.reduce((sum, a) => sum + a.quantity, 0),
				estimatedValue: assets.reduce((sum, a) => sum + (a.estimatedValue ?? 0), 0),
			})
		}
		return result.sort((a, b) => b.assets.length - a.assets.length)
	}, [data, search])

	const toggleLocation = (loc: string) => {
		setExpandedLocations((prev) => {
			const next = new Set(prev)
			if (next.has(loc)) {
				next.delete(loc)
			} else {
				next.add(loc)
			}
			return next
		})
	}

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
			</div>

			<div className="space-y-1">
				{groups.map((group) => {
					const isExpanded = expandedLocations.has(group.locationName)
					return (
						<div key={group.locationName}>
							<button
								type="button"
								onClick={() => toggleLocation(group.locationName)}
								className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/50 transition-colors"
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
								{group.assets.length} item{group.assets.length !== 1 ? 's' : ''}
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
											{group.assets.map((asset) => (
												<TableRow key={asset.item_id}>
													<TableCell className="w-10 pr-0">
														<ItemIcon typeId={asset.type_id} />
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
						No assets matching "{search}"
					</p>
				)}
			</div>
		</div>
	)
}
