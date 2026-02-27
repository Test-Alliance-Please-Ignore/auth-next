import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from './command'
import { Input } from './input'
import { Popover, PopoverAnchor, PopoverContent } from './popover'

export interface SearchSelectOption {
	id: string
	value: string
	label: string
	description?: string
}

type FilterMode = 'server' | 'local'

interface SearchSelectProps<TOption extends SearchSelectOption> {
	inputId?: string
	value: string
	onValueChange: (value: string) => void
	options: TOption[]
	onSelect: (option: TOption) => void
	filterMode?: FilterMode
	minQueryLength?: number
	placeholder?: string
	loading?: boolean
	disabled?: boolean
	className?: string
	contentClassName?: string
	inputClassName?: string
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
	minQueryLength = 2,
	placeholder = 'Search...',
	loading = false,
	disabled = false,
	className,
	contentClassName,
	inputClassName,
	minCharsText = 'Type more characters to search',
	loadingText = 'Searching...',
	emptyText = 'No results found',
	renderOption,
	getSearchText,
}: SearchSelectProps<TOption>) {
	const [open, setOpen] = useState(false)

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

	return (
		<div className={cn('relative', className)}>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverAnchor asChild>
					<div className="relative">
						<Input
							id={inputId}
							type="text"
							value={value}
							onChange={(e) => {
								onValueChange(e.target.value)
								setOpen(true)
							}}
							onFocus={() => setOpen(true)}
							placeholder={placeholder}
							autoComplete="off"
							disabled={disabled}
							className={cn('w-full', inputClassName)}
						/>
						{loading && (
							<div className="absolute right-3 top-1/2 -translate-y-1/2">
								<div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
							</div>
						)}
					</div>
				</PopoverAnchor>
				<PopoverContent
					align="start"
					sideOffset={6}
					className={cn('w-[var(--radix-popover-anchor-width)] p-0', contentClassName)}
				>
					{/* Filtering is controlled explicitly so local/server modes stay predictable. */}
					<Command shouldFilter={false}>
						<CommandList className="max-h-60">
							{filterMode === 'server' && !queryMeetsMinimum ? (
								<CommandEmpty>{minCharsText}</CommandEmpty>
							) : loading ? (
								<CommandEmpty>{loadingText}</CommandEmpty>
							) : filteredOptions.length === 0 ? (
								<CommandEmpty>{emptyText}</CommandEmpty>
							) : (
								<CommandGroup>
									{filteredOptions.map((option) => (
										<CommandItem
											key={option.id}
											value={option.value}
											onSelect={() => {
												onSelect(option)
												setOpen(false)
											}}
										>
											{renderOption ? (
												renderOption(option)
											) : (
												<div className="min-w-0">
													<div className="font-medium">{option.label}</div>
													{option.description && (
														<div className="truncate text-xs text-muted-foreground">
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
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	)
}
