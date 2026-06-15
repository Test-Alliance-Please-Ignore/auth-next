import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

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

import type { InventoryDisplayBay, InventoryDisplayItem } from '@repo/inventory-display'

export interface InventoryBaysTableProps {
	bays: InventoryDisplayBay[]
	emptyLabel?: string
	searchPlaceholder?: string
	className?: string
	renderItemIcon?: (item: InventoryDisplayItem) => ReactNode
}

function formatCount(value: number): string {
	return value.toLocaleString()
}

export function InventoryBaysTable({
	bays,
	emptyLabel = 'No inventory recorded for this structure.',
	searchPlaceholder = 'Search inventory bays...',
	className,
	renderItemIcon,
}: InventoryBaysTableProps) {
	const [search, setSearch] = useState('')
	const [expandedBays, setExpandedBays] = useState<Set<string>>(new Set())

	const visibleBays = useMemo(() => {
		const query = search.trim().toLowerCase()
		if (!query) {
			return bays
		}

		return bays
			.map((bay) => {
				const bayMatches = bay.label.toLowerCase().includes(query) || bay.locationFlag.toLowerCase().includes(query)
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

	if (bays.length === 0) {
		return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
	}

	return (
		<div className={cn('space-y-4', className)}>
			<div className="relative max-w-md">
				<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="search"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					placeholder={searchPlaceholder}
					className="pl-9"
				/>
			</div>

			<div className="overflow-hidden rounded-lg border border-border/60">
				<Table>
					<TableHeader>
						<TableRow className="bg-muted/40">
							<TableHead>Bay</TableHead>
							<TableHead className="text-right">Stacks</TableHead>
							<TableHead className="text-right">Units</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{visibleBays.length > 0 ? (
							visibleBays.map((bay) => {
								const isExpanded = search.trim().length > 0 || expandedBays.has(bay.locationFlag)
								return (
									<Fragment key={bay.locationFlag}>
										<TableRow
											className="cursor-pointer bg-card hover:bg-muted/40"
											onClick={() => toggleBay(bay.locationFlag)}
										>
											<TableCell>
												<div className="flex items-start gap-2">
													<div className="mt-0.5 text-muted-foreground">
														{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
													</div>
											<div className="min-w-0">
												<div className="font-medium">{bay.label}</div>
											</div>
										</div>
									</TableCell>
											<TableCell className="text-right font-mono">{formatCount(bay.totalStacks)}</TableCell>
											<TableCell className="text-right font-mono">{formatCount(bay.totalQuantity)}</TableCell>
										</TableRow>
										{isExpanded ? (
											<TableRow className="bg-muted/20">
												<TableCell colSpan={3} className="px-0 py-0">
													<div className="border-l-2 border-muted px-4 py-3">
														<Table>
															<TableHeader>
																<TableRow className="bg-transparent">
																	<TableHead>Item</TableHead>
																	<TableHead className="text-right">Qty</TableHead>
																	<TableHead className="text-right">Stacks</TableHead>
																</TableRow>
															</TableHeader>
															<TableBody>
																{bay.items.length > 0 ? (
																	bay.items.map((item) => (
																		<TableRow key={`${bay.locationFlag}-${item.typeId}`}>
																			<TableCell>
																				<div className="flex items-start gap-2">
																					{renderItemIcon ? (
																						<div className="mt-0.5 shrink-0">{renderItemIcon(item)}</div>
																					) : null}
																					<div className="min-w-0">
																						<div className="font-medium">{item.typeName ?? item.typeId}</div>
																					</div>
																				</div>
																			</TableCell>
																			<TableCell className="text-right font-mono">{formatCount(item.quantity)}</TableCell>
																			<TableCell className="text-right font-mono">{formatCount(item.stackCount)}</TableCell>
																		</TableRow>
																	))
																) : (
																	<TableRow>
																		<TableCell colSpan={3} className="text-sm italic text-muted-foreground">
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
								<TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
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
