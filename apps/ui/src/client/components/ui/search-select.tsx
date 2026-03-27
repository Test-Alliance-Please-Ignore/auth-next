import { ChevronsUpDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from './command'
import { Input } from './input'
import { Popover, PopoverAnchor, PopoverContent } from './popover'
import {
	popoverListItemActiveClass,
	popoverListItemBaseClass,
	PopoverListScrollButton,
	popoverListViewportClass,
} from './popover-list'

import type { CSSProperties, ReactNode } from 'react'

export interface SearchSelectOption {
	id: string
	value: string
	label: string
	description?: string
}

type FilterMode = 'server' | 'local'
type SearchSelectMode = 'search' | 'dropdown'

interface SearchSelectProps<TOption extends SearchSelectOption> {
	inputId?: string
	value: string
	onValueChange: (value: string) => void
	options: TOption[]
	onSelect: (option: TOption) => void
	filterMode?: FilterMode
	mode?: SearchSelectMode
	minQueryLength?: number
	placeholder?: string
	loading?: boolean
	disabled?: boolean
	className?: string
	contentClassName?: string
	inputClassName?: string
	listClassName?: string
	listMinHeight?: CSSProperties['minHeight']
	listMaxHeight?: CSSProperties['maxHeight']
	minCharsText?: string
	loadingText?: string
	emptyText?: string
	renderOption?: (option: TOption) => ReactNode
	getSearchText?: (option: TOption) => string
}

export function SearchSelect<TOption extends SearchSelectOption>({
	inputId,
	value,
	onValueChange,
	options,
	onSelect,
	filterMode = 'server',
	mode = 'search',
	minQueryLength = 2,
	placeholder = 'Search...',
	loading = false,
	disabled = false,
	className,
	contentClassName,
	inputClassName,
	listClassName,
	listMinHeight,
	listMaxHeight,
	minCharsText = 'Type more characters to search',
	loadingText = 'Searching...',
	emptyText = 'No results found',
	renderOption,
	getSearchText,
}: SearchSelectProps<TOption>) {
	const [open, setOpen] = useState(false)
	const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)
	const optionRefs = useRef<Array<HTMLElement | null>>([])
	const listRef = useRef<HTMLDivElement | null>(null)
	const anchorRef = useRef<HTMLDivElement | null>(null)
	const [canScrollUp, setCanScrollUp] = useState(false)
	const [canScrollDown, setCanScrollDown] = useState(false)

	const trimmedQuery = value.trim()
	const queryMeetsMinimum = trimmedQuery.length >= minQueryLength

	const filteredOptions = useMemo(() => {
		if (filterMode === 'server') {
			// Server mode treats API results as source-of-truth to avoid client-side mismatches.
			return options
		}

		if (!trimmedQuery) {
			return options
		}

		const q = trimmedQuery.toLowerCase()
		return options.filter((opt) => {
			const defaultSearch = `${opt.label} ${opt.value} ${opt.description ?? ''}`
			const searchText = getSearchText ? getSearchText(opt) : defaultSearch
			return searchText.toLowerCase().includes(q)
		})
	}, [filterMode, getSearchText, options, trimmedQuery])

	const canShowOptions =
		!(filterMode === 'server' && !queryMeetsMinimum) && filteredOptions.length > 0

	const shouldOpenOnFocus =
		mode === 'dropdown' ? true : trimmedQuery.length > 0 || filteredOptions.length > 0

	useEffect(() => {
		if (!canShowOptions) {
			setHighlightedIndex(-1)
			return
		}

		setHighlightedIndex((prev) => {
			if (prev < 0) return 0
			if (prev >= filteredOptions.length) return filteredOptions.length - 1
			return prev
		})
	}, [canShowOptions, filteredOptions.length])

	useEffect(() => {
		if (!open || highlightedIndex < 0) return
		const activeOption = optionRefs.current[highlightedIndex]
		activeOption?.scrollIntoView({ block: 'nearest' })
	}, [highlightedIndex, open])

	const updateScrollButtons = () => {
		const listEl = listRef.current
		if (!listEl) {
			setCanScrollUp(false)
			setCanScrollDown(false)
			return
		}

		const { scrollTop, scrollHeight, clientHeight } = listEl
		setCanScrollUp(scrollTop > 0)
		setCanScrollDown(scrollTop + clientHeight < scrollHeight - 1)
	}

	useEffect(() => {
		if (!open) {
			setCanScrollUp(false)
			setCanScrollDown(false)
			return
		}

		// Measure after popover/layout commit so overflow chevrons are correct on first render.
		const frame = requestAnimationFrame(() => updateScrollButtons())
		return () => cancelAnimationFrame(frame)
	}, [open, filteredOptions.length, loading, queryMeetsMinimum])

	useEffect(() => {
		if (!open) {
			return
		}

		const listEl = listRef.current
		if (!listEl || typeof ResizeObserver === 'undefined') {
			return
		}

		const observer = new ResizeObserver(() => updateScrollButtons())
		observer.observe(listEl)
		return () => observer.disconnect()
	}, [open])

	useEffect(() => {
		if (disabled && open) {
			setOpen(false)
			setHighlightedIndex(-1)
		}
	}, [disabled, open])

	const scrollListBy = (delta: number) => {
		const listEl = listRef.current
		if (!listEl) return
		listEl.scrollBy({ top: delta, behavior: 'smooth' })
	}

	const selectOption = (option: TOption) => {
		if (disabled) {
			return
		}
		if (mode === 'search') {
			// Search mode keeps the chosen label in the input; dropdown mode should fall back to
			// placeholder-based selection display so reopening does not self-filter the list.
			onValueChange(option.label)
		}
		onSelect(option)
		setOpen(false)
		setHighlightedIndex(-1)
	}

	return (
		<div className={cn('relative', className)}>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverAnchor asChild>
					<div ref={anchorRef} className="relative">
						<Input
							id={inputId}
							type="text"
							value={value}
							onChange={(e) => {
								if (disabled) return
								onValueChange(e.target.value)
								setHighlightedIndex(0)
								setOpen(true)
							}}
							onFocus={() => {
								if (disabled) return
								// Avoid showing the "min chars" empty-state on first click into an empty field.
								if (shouldOpenOnFocus) {
									setOpen(true)
								}
							}}
							onMouseDown={() => {
								if (disabled) return
								if (mode === 'dropdown' && !open) {
									setOpen(true)
								}
							}}
							onKeyDown={(e) => {
								if (disabled) return
								if (e.key === 'Escape') {
									setOpen(false)
									setHighlightedIndex(-1)
									return
								}

								if (e.key === 'ArrowDown') {
									e.preventDefault()
									if (!open) {
										setOpen(true)
									}
									if (!canShowOptions) return
									setHighlightedIndex((prev) =>
										prev < 0 ? 0 : Math.min(prev + 1, filteredOptions.length - 1)
									)
									return
								}

								if (e.key === 'ArrowUp') {
									e.preventDefault()
									if (!open) {
										setOpen(true)
									}
									if (!canShowOptions) return
									setHighlightedIndex((prev) => (prev <= 0 ? 0 : prev - 1))
									return
								}

								if (e.key === 'Enter' && open && canShowOptions && highlightedIndex >= 0) {
									e.preventDefault()
									const option = filteredOptions[highlightedIndex]
									if (option) {
										selectOption(option)
									}
								}
							}}
							placeholder={placeholder}
							autoComplete="off"
							disabled={disabled}
							className={cn(
								'w-full',
								mode === 'dropdown' && 'pr-9',
								disabled &&
									'border-border/60 bg-muted/45 text-muted-foreground placeholder:text-muted-foreground',
								inputClassName
							)}
						/>
						{loading && (
							<div className="absolute right-3 top-1/2 -translate-y-1/2">
								<div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
							</div>
						)}
						{!loading && mode === 'dropdown' && (
							<div
								className={cn(
									'pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground',
									disabled && 'opacity-50'
								)}
							>
								<ChevronsUpDown className="h-4 w-4" />
							</div>
						)}
					</div>
				</PopoverAnchor>
				<PopoverContent
					align="start"
					sideOffset={6}
					className={cn(
						'w-[var(--radix-popover-trigger-width)] min-w-[var(--radix-popover-trigger-width)] p-0',
						contentClassName
					)}
					onOpenAutoFocus={(event) => {
						// Keep typing focus on the anchor input instead of moving focus into popover content.
						event.preventDefault()
					}}
					onCloseAutoFocus={(event) => {
						// Prevent focus jump loops that can cause immediate close/reopen flicker.
						event.preventDefault()
					}}
					onInteractOutside={(event) => {
						// Clicking the anchor input should not count as "outside" and immediately close the popover.
						const target = event.target as Node | null
						if (target && anchorRef.current?.contains(target)) {
							event.preventDefault()
						}
					}}
				>
					{/* Filtering is controlled explicitly so local/server modes stay predictable. */}
					<Command shouldFilter={false}>
						{canScrollUp && (
							<PopoverListScrollButton direction="up" onClick={() => scrollListBy(-120)} />
						)}
						<CommandList
							ref={listRef}
							className={cn('max-h-60', popoverListViewportClass, listClassName)}
							style={{
								minHeight: listMinHeight,
								maxHeight: listMaxHeight,
							}}
							onScroll={() => updateScrollButtons()}
						>
							{filterMode === 'server' && !queryMeetsMinimum ? (
								<CommandEmpty>{minCharsText}</CommandEmpty>
							) : loading ? (
								<CommandEmpty>{loadingText}</CommandEmpty>
							) : filteredOptions.length === 0 ? (
								<CommandEmpty>{emptyText}</CommandEmpty>
							) : (
								<CommandGroup>
									{filteredOptions.map((option, index) => (
										<CommandItem
											key={option.id}
											value={option.value}
											ref={(node) => {
												optionRefs.current[index] = node
											}}
											className={cn(
												`cursor-pointer ${popoverListItemBaseClass}`,
												highlightedIndex === index && popoverListItemActiveClass
											)}
											onMouseEnter={() => setHighlightedIndex(index)}
											onMouseMove={() => setHighlightedIndex(index)}
											onSelect={() => selectOption(option)}
										>
											{renderOption ? (
												renderOption(option)
											) : (
												<div className="min-w-0">
													<div className="truncate font-medium" title={option.label}>
														{option.label}
													</div>
													{option.description && (
														<div
															className="truncate text-xs text-muted-foreground"
															title={option.description}
														>
															{option.description}
														</div>
													)}
												</div>
											)}
										</CommandItem>
									))}
								</CommandGroup>
							)}
						</CommandList>
						{canScrollDown && (
							<PopoverListScrollButton direction="down" onClick={() => scrollListBy(120)} />
						)}
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	)
}
