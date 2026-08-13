import { ChevronDown, ChevronRight, ChevronsUpDown, Search } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { formatISK } from '@/lib/format-utils'
import { cn } from '@/lib/utils'

import type { ReactNode } from 'react'
import type { InventoryDisplayBay, InventoryDisplayItem } from '@repo/inventory-display'

export interface InventoryBaysTableProps {
	bays: InventoryDisplayBay[]
	emptyLabel?: string
	searchPlaceholder?: string
	className?: string
	renderItemIcon?: (item: InventoryDisplayItem) => ReactNode
	renderItemDetails?: (item: InventoryDisplayItem) => ReactNode
}

function formatCount(value: number): string {
	return value.toLocaleString()
}

function formatVolumeM3(value: number | null | undefined): string {
	if (value === null || value === undefined) {
		return '-'
	}

	return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`
}

function formatEstimatedValue(value: number | null | undefined): string {
	return value === null || value === undefined ? '-' : formatISK(value, { showDecimals: false })
}

export function InventoryBaysTable({
	bays,
	emptyLabel = 'No inventory recorded for this structure.',
	searchPlaceholder = 'Search inventory bays...',
	className,
	renderItemIcon,
	renderItemDetails,
}: InventoryBaysTableProps) {
	const [search, setSearch] = useState('')
	const [expandedBays, setExpandedBays] = useState<Set<string>>(new Set())

	useEffect(() => {
		if (bays.length === 0) {
			return
		}

		setExpandedBays((previous) => {
			const next = new Set(previous)
			for (const bay of bays) {
				next.add(bay.locationFlag)
			}
			return next.size === previous.size ? previous : next
		})
	}, [bays])

	const visibleBays = useMemo(() => {
		const query = search.trim().toLowerCase()
		if (!query) {
			return bays
		}

		return bays
			.map((bay) => {
				const bayMatches =
					bay.label.toLowerCase().includes(query) || bay.locationFlag.toLowerCase().includes(query)
				const items = bay.items.filter((item) => {
					return (
						item.typeId.toLowerCase().includes(query) ||
						(item.typeName ?? '').toLowerCase().includes(query)
					)
				})

				if (!bayMatches && items.length === 0) {
					return null
				}

				return { ...bay, items }
			})
			.filter((bay): bay is InventoryDisplayBay => bay !== null)
	}, [bays, search])

	useEffect(() => {
		const query = search.trim()
		if (!query) {
			return
		}

		setExpandedBays((previous) => {
			const next = new Set(previous)
			for (const bay of visibleBays) {
				next.add(bay.locationFlag)
			}
			return next
		})
	}, [search, visibleBays])

	const toggleBay = (locationFlag: string) => {
		setExpandedBays((previous) => {
			const next = new Set(previous)
			if (next.has(locationFlag)) {
				next.delete(locationFlag)
			} else {
				next.add(locationFlag)
			}
			return next
		})
	}

	const allVisibleExpanded =
		visibleBays.length > 0 && visibleBays.every((bay) => expandedBays.has(bay.locationFlag))

	const toggleAllVisible = () => {
		setExpandedBays((previous) => {
			const next = new Set(previous)
			if (allVisibleExpanded) {
				for (const bay of visibleBays) {
					next.delete(bay.locationFlag)
				}
			} else {
				for (const bay of visibleBays) {
					next.add(bay.locationFlag)
				}
			}
			return next
		})
	}

	if (bays.length === 0) {
		return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
	}

	return (
		<div className={cn('space-y-4', className)}>
			<div className="flex flex-wrap items-center gap-3">
				<div className="relative max-w-md flex-1">
					<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						type="search"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder={searchPlaceholder}
						className="pl-9"
					/>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={toggleAllVisible}
					disabled={visibleBays.length === 0}
				>
					<ChevronsUpDown className="h-4 w-4" />
					{allVisibleExpanded ? 'Contract all' : 'Expand all'}
				</Button>
			</div>

			<div className="overflow-hidden rounded-lg border border-border/60">
				<Table className="text-xs">
					<TableHeader>
						<TableRow className="bg-muted/40">
							<TableHead>Bay</TableHead>
							<TableHead className="text-right">Units</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{visibleBays.length > 0 ? (
							visibleBays.map((bay) => {
								const isExpanded = expandedBays.has(bay.locationFlag)
								const showMoonMaterialDetails = bay.locationFlag === 'MoonMaterialBay'
								return (
									<Fragment key={bay.locationFlag}>
										<TableRow
											className="cursor-pointer bg-card hover:bg-muted/40"
											onClick={() => toggleBay(bay.locationFlag)}
										>
											<TableCell>
												<div className="flex items-start gap-2">
													<div className="mt-0.5 text-muted-foreground">
														{isExpanded ? (
															<ChevronDown className="h-4 w-4" />
														) : (
															<ChevronRight className="h-4 w-4" />
														)}
													</div>
													<div className="min-w-0">
														<div className="font-medium">{bay.label}</div>
													</div>
												</div>
											</TableCell>
											<TableCell className="text-right font-mono">
												{formatCount(bay.totalQuantity)}
											</TableCell>
										</TableRow>
										{isExpanded ? (
											<TableRow className="bg-muted/20">
												<TableCell colSpan={2} className="px-0 py-0">
													<div className="border-l-2 border-muted px-4 py-3">
														<Table className="text-xs">
															<TableHeader>
																<TableRow className="bg-transparent">
																	<TableHead>Item</TableHead>
																	<TableHead className="text-right">Qty</TableHead>
																	{showMoonMaterialDetails ? (
																		<>
																			<TableHead className="text-right">Volume</TableHead>
																			<TableHead className="text-right">Value</TableHead>
																		</>
																	) : null}
																</TableRow>
															</TableHeader>
															<TableBody>
																{bay.items.length > 0 ? (
																	bay.items.map((item) => (
																		<TableRow key={`${bay.locationFlag}-${item.typeId}`}>
																			<TableCell>
																				<div className="flex items-center gap-2">
																					{renderItemIcon ? (
																						<div className="shrink-0">{renderItemIcon(item)}</div>
																					) : null}
																					<div className="min-w-0">
																						<div className="font-medium">
																							{item.typeName ?? item.typeId}
																						</div>
																						{renderItemDetails ? (
																							<div className="text-xs text-muted-foreground">
																								{renderItemDetails(item)}
																							</div>
																						) : null}
																					</div>
																				</div>
																			</TableCell>
																			<TableCell className="text-right font-mono">
																				{formatCount(item.quantity)}
																			</TableCell>
																			{showMoonMaterialDetails ? (
																				<TableCell className="text-right font-mono">
																					{formatVolumeM3(item.volumeM3)}
																				</TableCell>
																			) : null}
																			{showMoonMaterialDetails ? (
																				<TableCell className="text-right font-mono">
																					{formatEstimatedValue(item.estimatedValue)}
																				</TableCell>
																			) : null}
																		</TableRow>
																	))
																) : (
																	<TableRow>
																		<TableCell
																			colSpan={showMoonMaterialDetails ? 4 : 2}
																			className="text-sm italic text-muted-foreground"
																		>
																			No items matched the current search.
																		</TableCell>
																	</TableRow>
																)}
															</TableBody>
														</Table>
													</div>
												</TableCell>
											</TableRow>
										) : null}
									</Fragment>
								)
							})
						) : (
							<TableRow>
								<TableCell colSpan={2} className="py-8 text-center text-sm text-muted-foreground">
									No inventory bays matched the current search.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	)
}
