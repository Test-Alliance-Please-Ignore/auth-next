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
import { resolveSelectInputValue, shouldClearSelectQueryOnSelect } from './select-behavior'
import {
	buildKnownSelectOptions,
	buildRenderedSelectOptions,
	filterSelectOptions,
	isSelectAllInternalOption,
	resolveBaseOptions,
	resolveCanShowSelectOptions,
	resolveSelectedLabel,
	resolveSelectedOption,
	resolveSelectInputPlaceholder,
	resolveSelectSearchFlags,
	resolveShouldOpenSelectOnFocus,
} from './select-logic'

import type { CSSProperties, ReactNode } from 'react'
import type { InternalSelectOption } from './select-logic'

export interface SelectOption {
	value: string
	label: string
	description?: string
}

export type SelectSearchDelegate<TOption extends SelectOption> = (
	query: string
) => Promise<TOption[] | readonly TOption[]> | TOption[] | readonly TOption[]

interface SelectAllOption {
	value: string
	label: string
	description?: string
}

export interface SelectProps<TOption extends SelectOption> {
	inputId?: string
	options: TOption[]
	value?: string
	defaultValue?: string
	initialValue?: string
	onValueChange?: (value: string, option: TOption | null) => void
	searchable?: boolean
	query?: string
	defaultQuery?: string
	onQueryChange?: (query: string) => void
	searchDelegate?: SelectSearchDelegate<TOption>
	minQueryLength?: number
	debounceMs?: number
	placeholder?: string
	loading?: boolean
	disabled?: boolean
	className?: string
	contentClassName?: string
	inputClassName?: string
	listClassName?: string
	listMinHeight?: CSSProperties['minHeight']
	listMaxHeight?: CSSProperties['maxHeight']
	queryHintText?: string
	loadingText?: string
	emptyText?: string
	renderOption?: (option: TOption) => ReactNode
	getOptionSearchText?: (option: TOption) => string
	showValueHint?: boolean
	selectAllOption?: SelectAllOption
}

export function Select<TOption extends SelectOption>({
	inputId,
	options,
	value,
	defaultValue,
	initialValue,
	onValueChange,
	searchable = false,
	query,
	defaultQuery = '',
	onQueryChange,
	searchDelegate,
	minQueryLength = 2,
	debounceMs = 250,
	placeholder = 'Select an option',
	loading = false,
	disabled = false,
	className,
	contentClassName,
	inputClassName,
	listClassName,
	listMinHeight,
	listMaxHeight,
	queryHintText,
	loadingText = 'Searching...',
	emptyText = 'No results found',
	renderOption,
	getOptionSearchText,
	showValueHint = false,
	selectAllOption,
}: SelectProps<TOption>) {
	const [open, setOpen] = useState(false)
	const [isInputFocused, setIsInputFocused] = useState(false)
	const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)
	const optionRefs = useRef<Array<HTMLElement | null>>([])
	const listRef = useRef<HTMLDivElement | null>(null)
	const anchorRef = useRef<HTMLDivElement | null>(null)
	const [canScrollUp, setCanScrollUp] = useState(false)
	const [canScrollDown, setCanScrollDown] = useState(false)

	const [uncontrolledSelectedValue, setUncontrolledSelectedValue] = useState(
		defaultValue ?? initialValue ?? ''
	)
	const [uncontrolledQuery, setUncontrolledQuery] = useState(defaultQuery)
	const [delegateOptions, setDelegateOptions] = useState<TOption[]>([])
	const [delegateLoading, setDelegateLoading] = useState(false)
	const delegateRequestIdRef = useRef(0)
	const selectedLabelByValueRef = useRef<Map<string, string>>(new Map())
	const [controlledQueryOverride, setControlledQueryOverride] = useState<string | null>(null)
	const previousControlledQueryRef = useRef(query ?? '')
	const [isCommitted, setIsCommitted] = useState(() => {
		const initialQuery = query ?? defaultQuery
		return initialQuery.trim().length === 0
	})

	const isSelectedValueControlled = value !== undefined
	const isQueryControlled = query !== undefined
	const selectedValue = isSelectedValueControlled ? (value ?? '') : uncontrolledSelectedValue
	const queryValue = isQueryControlled ? (query ?? '') : uncontrolledQuery
	const effectiveQueryValue = isQueryControlled
		? (controlledQueryOverride ?? queryValue)
		: queryValue
	const trimmedQuery = effectiveQueryValue.trim()
	const { hasSearchDelegate, queryMeetsMinimum, queryTooShort } = resolveSelectSearchFlags({
		searchable,
		searchDelegate,
		trimmedQuery,
		minQueryLength,
	})
	const resolvedQueryHintText =
		queryHintText ?? `Type at least ${minQueryLength} characters to search`

	useEffect(() => {
		if (!isSelectedValueControlled && initialValue !== undefined) {
			setUncontrolledSelectedValue(initialValue)
		}
	}, [initialValue, isSelectedValueControlled])

	useEffect(() => {
		if (!isQueryControlled) {
			if (controlledQueryOverride !== null) {
				setControlledQueryOverride(null)
			}
			return
		}

		if (controlledQueryOverride !== null && queryValue !== previousControlledQueryRef.current) {
			setControlledQueryOverride(null)
		}

		previousControlledQueryRef.current = queryValue
	}, [controlledQueryOverride, isQueryControlled, queryValue])

	useEffect(() => {
		if (!isQueryControlled || controlledQueryOverride !== null) {
			return
		}

		setIsCommitted(queryValue.trim().length === 0)
	}, [controlledQueryOverride, isQueryControlled, queryValue])

	useEffect(() => {
		if (!hasSearchDelegate || searchDelegate === undefined) {
			setDelegateOptions([])
			setDelegateLoading(false)
			return
		}

		if (trimmedQuery.length === 0) {
			setDelegateOptions([])
			setDelegateLoading(false)
			return
		}

		if (!queryMeetsMinimum) {
			setDelegateOptions([])
			setDelegateLoading(false)
			return
		}

		const requestId = delegateRequestIdRef.current + 1
		delegateRequestIdRef.current = requestId
		setDelegateLoading(true)
		setDelegateOptions([])

		const timer = setTimeout(
			() => {
				void Promise.resolve(searchDelegate(trimmedQuery))
					.then((nextOptions) => {
						if (delegateRequestIdRef.current !== requestId) {
							return
						}
						setDelegateOptions([...nextOptions])
					})
					.catch(() => {
						if (delegateRequestIdRef.current !== requestId) {
							return
						}
						setDelegateOptions([])
					})
					.finally(() => {
						if (delegateRequestIdRef.current !== requestId) {
							return
						}
						setDelegateLoading(false)
					})
			},
			Math.max(0, debounceMs)
		)

		return () => clearTimeout(timer)
	}, [debounceMs, hasSearchDelegate, queryMeetsMinimum, searchDelegate, trimmedQuery])

	const baseOptions = useMemo(() => {
		return resolveBaseOptions({
			hasSearchDelegate,
			options,
			isCommitted,
			trimmedQuery,
			queryMeetsMinimum,
			delegateOptions,
		})
	}, [
		delegateOptions,
		hasSearchDelegate,
		isCommitted,
		options,
		queryMeetsMinimum,
		trimmedQuery.length,
	])

	const filteredOptions = useMemo(() => {
		return filterSelectOptions({
			searchable,
			hasSearchDelegate,
			baseOptions,
			trimmedQuery,
			getOptionSearchText,
		})
	}, [baseOptions, getOptionSearchText, hasSearchDelegate, searchable, trimmedQuery])

	const renderedOptions = useMemo<Array<InternalSelectOption<TOption>>>(
		() =>
			buildRenderedSelectOptions({
				filteredOptions,
				selectAllOption,
			}),
		[filteredOptions, selectAllOption]
	)

	const knownOptions = useMemo(() => {
		return buildKnownSelectOptions({
			options,
			delegateOptions,
			filteredOptions,
		})
	}, [delegateOptions, filteredOptions, options])

	const selectedOption = useMemo(() => {
		return resolveSelectedOption({
			knownOptions,
			selectedValue,
		})
	}, [knownOptions, selectedValue])

	useEffect(() => {
		for (const option of knownOptions) {
			selectedLabelByValueRef.current.set(option.value, option.label)
		}
	}, [knownOptions])

	const selectedLabel = useMemo(
		() =>
			resolveSelectedLabel({
				selectedValue,
				selectedOptionLabel: selectedOption?.label ?? null,
				cachedSelectedLabel: selectedLabelByValueRef.current.get(selectedValue) ?? null,
			}),
		[selectedOption, selectedValue]
	)

	const minQueryBlocked = queryTooShort
	const isLoading = loading || delegateLoading
	const canShowOptions = resolveCanShowSelectOptions({
		minQueryBlocked,
		renderedOptionsLength: renderedOptions.length,
	})
	const shouldOpenOnFocus = resolveShouldOpenSelectOnFocus({
		searchable,
		isCommitted,
		trimmedQuery,
		renderedOptionsLength: renderedOptions.length,
	})
	const inputValue = resolveSelectInputValue({
		searchable,
		queryValue: effectiveQueryValue,
		selectedOptionLabel: selectedLabel,
		open,
		focused: isInputFocused,
	})
	const inputPlaceholder = resolveSelectInputPlaceholder({
		searchable,
		effectiveQueryValue,
		selectedLabel,
		placeholder,
	})

	useEffect(() => {
		if (!canShowOptions) {
			setHighlightedIndex(-1)
			return
		}
		setHighlightedIndex((prev) => {
			if (prev < 0) return 0
			if (prev >= renderedOptions.length) return renderedOptions.length - 1
			return prev
		})
	}, [canShowOptions, renderedOptions.length])

	useEffect(() => {
		if (!open || highlightedIndex < 0) return
		optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
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
		const frame = requestAnimationFrame(() => updateScrollButtons())
		return () => cancelAnimationFrame(frame)
	}, [open, renderedOptions.length, isLoading, minQueryBlocked])

	useEffect(() => {
		if (!open) return
		const listEl = listRef.current
		if (!listEl || typeof ResizeObserver === 'undefined') return
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

	useEffect(() => {
		if (disabled && isInputFocused) {
			setIsInputFocused(false)
		}
	}, [disabled, isInputFocused])

	const emitSelectionChange = (nextValue: string, option: TOption | null) => {
		if (!isSelectedValueControlled) {
			setUncontrolledSelectedValue(nextValue)
		}
		onValueChange?.(nextValue, option)
	}

	const setQueryText = (nextQuery: string, options?: { silent?: boolean }) => {
		const silent = options?.silent ?? false
		if (!silent) {
			setIsCommitted(nextQuery.trim().length === 0)
		}

		if (!isQueryControlled) {
			setUncontrolledQuery(nextQuery)
			if (!silent) {
				onQueryChange?.(nextQuery)
			}
			return
		}

		setControlledQueryOverride(nextQuery)
		if (!silent) {
			onQueryChange?.(nextQuery)
		}
	}

	const clearQuery = () => {
		if (!shouldClearSelectQueryOnSelect({ searchable, queryValue: effectiveQueryValue })) {
			return
		}
		setIsCommitted(true)
		setQueryText('', { silent: true })
	}

	const selectOption = (option: InternalSelectOption<TOption>) => {
		if (disabled) return
		setIsCommitted(true)

		if (isSelectAllInternalOption(option)) {
			selectedLabelByValueRef.current.set(option.value, option.label)
			emitSelectionChange(option.value, null)
			clearQuery()
			setOpen(false)
			setHighlightedIndex(-1)
			return
		}

		selectedLabelByValueRef.current.set(option.value, option.label)
		emitSelectionChange(option.value, option)
		clearQuery()
		setOpen(false)
		setHighlightedIndex(-1)
	}

	const scrollListBy = (delta: number) => {
		listRef.current?.scrollBy({ top: delta, behavior: 'smooth' })
	}

	return (
		<div className={cn('relative', className)}>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverAnchor asChild>
					<div ref={anchorRef} className="relative">
						<Input
							id={inputId}
							type="text"
							value={inputValue}
							readOnly={!searchable}
							onChange={(event) => {
								if (disabled || !searchable) return
								setQueryText(event.target.value)
								setHighlightedIndex(0)
								setOpen(true)
							}}
							onFocus={() => {
								if (disabled) return
								setIsInputFocused(true)
								if (shouldOpenOnFocus) setOpen(true)
							}}
							onBlur={() => setIsInputFocused(false)}
							onMouseDown={() => {
								if (disabled) return
								if (!open && shouldOpenOnFocus) setOpen(true)
							}}
							onKeyDown={(event) => {
								if (disabled) return
								if (event.key === 'Escape') {
									setOpen(false)
									setHighlightedIndex(-1)
									return
								}
								if (event.key === 'ArrowDown') {
									event.preventDefault()
									if (!open) {
										if (!shouldOpenOnFocus) return
										setOpen(true)
									}
									if (!canShowOptions) return
									setHighlightedIndex((prev) =>
										prev < 0 ? 0 : Math.min(prev + 1, renderedOptions.length - 1)
									)
									return
								}
								if (event.key === 'ArrowUp') {
									event.preventDefault()
									if (!open) {
										if (!shouldOpenOnFocus) return
										setOpen(true)
									}
									if (!canShowOptions) return
									setHighlightedIndex((prev) => (prev <= 0 ? 0 : prev - 1))
									return
								}
								if (event.key === 'Enter' && open && canShowOptions && highlightedIndex >= 0) {
									event.preventDefault()
									const option = renderedOptions[highlightedIndex]
									if (option) selectOption(option)
								}
							}}
							placeholder={inputPlaceholder}
							autoComplete="off"
							disabled={disabled}
							className={cn(
								'w-full',
								'pr-9',
								!searchable && 'cursor-pointer',
								disabled &&
									'border-border/60 bg-muted/45 text-muted-foreground placeholder:text-muted-foreground',
								inputClassName
							)}
						/>
						{isLoading ? (
							<div className="absolute right-3 top-1/2 -translate-y-1/2">
								<div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
							</div>
						) : (
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
					onOpenAutoFocus={(event) => event.preventDefault()}
					onCloseAutoFocus={(event) => event.preventDefault()}
					onInteractOutside={(event) => {
						const target = event.target as Node | null
						if (target && anchorRef.current?.contains(target)) {
							event.preventDefault()
						}
					}}
				>
					<Command shouldFilter={false}>
						{canScrollUp && (
							<PopoverListScrollButton direction="up" onClick={() => scrollListBy(-120)} />
						)}
						<CommandList
							ref={listRef}
							className={cn('max-h-60', popoverListViewportClass, listClassName)}
							style={{ minHeight: listMinHeight, maxHeight: listMaxHeight }}
							onScroll={() => updateScrollButtons()}
						>
							{minQueryBlocked ? (
								<CommandEmpty>{resolvedQueryHintText}</CommandEmpty>
							) : isLoading ? (
								<CommandEmpty>{loadingText}</CommandEmpty>
							) : renderedOptions.length === 0 ? (
								<CommandEmpty>{emptyText}</CommandEmpty>
							) : (
								<CommandGroup>
									{renderedOptions.map((option, index) => (
										<CommandItem
											key={`${option.value}::${index}`}
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
											{!isSelectAllInternalOption(option) && renderOption ? (
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
													{showValueHint && (
														<div
															className="truncate text-xs text-muted-foreground"
															title={option.value}
														>
															{option.value}
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
