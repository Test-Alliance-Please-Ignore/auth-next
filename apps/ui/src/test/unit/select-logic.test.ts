import { describe, expect, it } from 'vitest'

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
} from '../../client/components/ui/select-logic'

const BASE_OPTIONS = [
	{ value: '30000142', label: 'Jita', description: 'The Forge' },
	{ value: '30002187', label: 'Amarr', description: 'Domain' },
	{ value: '30002510', label: 'Rens', description: 'Heimatar' },
]

describe('select-logic: search flags', () => {
	it('enables delegate flags only when searchable and delegate exists', () => {
		expect(
			resolveSelectSearchFlags({
				searchable: true,
				searchDelegate: () => [],
				trimmedQuery: 'ji',
				minQueryLength: 2,
			})
		).toEqual({
			hasSearchDelegate: true,
			queryMeetsMinimum: true,
			queryTooShort: false,
		})

		expect(
			resolveSelectSearchFlags({
				searchable: false,
				searchDelegate: () => [],
				trimmedQuery: 'ji',
				minQueryLength: 2,
			}).hasSearchDelegate
		).toBe(false)
	})

	it('marks delegate query as too short only when there is non-empty text below minimum', () => {
		expect(
			resolveSelectSearchFlags({
				searchable: true,
				searchDelegate: () => [],
				trimmedQuery: 'j',
				minQueryLength: 2,
			}).queryTooShort
		).toBe(true)

		expect(
			resolveSelectSearchFlags({
				searchable: true,
				searchDelegate: () => [],
				trimmedQuery: '',
				minQueryLength: 2,
			}).queryTooShort
		).toBe(false)
	})
})

describe('select-logic: base options', () => {
	it('returns local options when no delegate mode is active', () => {
		expect(
			resolveBaseOptions({
				hasSearchDelegate: false,
				options: BASE_OPTIONS,
				isCommitted: true,
				trimmedQuery: '',
				queryMeetsMinimum: false,
				delegateOptions: [{ value: 'x', label: 'X', description: '' }],
			})
		).toEqual(BASE_OPTIONS)
	})

	it('suppresses delegate options when committed or query is empty', () => {
		expect(
			resolveBaseOptions({
				hasSearchDelegate: true,
				options: BASE_OPTIONS,
				isCommitted: true,
				trimmedQuery: 'ji',
				queryMeetsMinimum: true,
				delegateOptions: [{ value: 'x', label: 'X', description: '' }],
			})
		).toEqual([])

		expect(
			resolveBaseOptions({
				hasSearchDelegate: true,
				options: BASE_OPTIONS,
				isCommitted: false,
				trimmedQuery: '',
				queryMeetsMinimum: false,
				delegateOptions: [{ value: 'x', label: 'X', description: '' }],
			})
		).toEqual([])
	})

	it('suppresses delegate options below minimum, otherwise returns delegate results', () => {
		expect(
			resolveBaseOptions({
				hasSearchDelegate: true,
				options: BASE_OPTIONS,
				isCommitted: false,
				trimmedQuery: 'j',
				queryMeetsMinimum: false,
				delegateOptions: [{ value: 'x', label: 'X', description: '' }],
			})
		).toEqual([])

		expect(
			resolveBaseOptions({
				hasSearchDelegate: true,
				options: BASE_OPTIONS,
				isCommitted: false,
				trimmedQuery: 'ji',
				queryMeetsMinimum: true,
				delegateOptions: [{ value: 'x', label: 'X', description: '' }],
			})
		).toEqual([{ value: 'x', label: 'X', description: '' }])
	})
})

describe('select-logic: filtering', () => {
	it('does not filter when not searchable or when delegate mode is active', () => {
		expect(
			filterSelectOptions({
				searchable: false,
				hasSearchDelegate: false,
				baseOptions: BASE_OPTIONS,
				trimmedQuery: 'jita',
			})
		).toEqual(BASE_OPTIONS)

		expect(
			filterSelectOptions({
				searchable: true,
				hasSearchDelegate: true,
				baseOptions: BASE_OPTIONS,
				trimmedQuery: 'jita',
			})
		).toEqual(BASE_OPTIONS)
	})

	it('returns all local options when local query is empty', () => {
		expect(
			filterSelectOptions({
				searchable: true,
				hasSearchDelegate: false,
				baseOptions: BASE_OPTIONS,
				trimmedQuery: '',
			})
		).toEqual(BASE_OPTIONS)
	})

	it('matches local options against label, value, and description case-insensitively', () => {
		expect(
			filterSelectOptions({
				searchable: true,
				hasSearchDelegate: false,
				baseOptions: BASE_OPTIONS,
				trimmedQuery: 'jiTA',
			}).map((option) => option.value)
		).toEqual(['30000142'])

		expect(
			filterSelectOptions({
				searchable: true,
				hasSearchDelegate: false,
				baseOptions: BASE_OPTIONS,
				trimmedQuery: '30002187',
			}).map((option) => option.value)
		).toEqual(['30002187'])

		expect(
			filterSelectOptions({
				searchable: true,
				hasSearchDelegate: false,
				baseOptions: BASE_OPTIONS,
				trimmedQuery: 'heimatar',
			}).map((option) => option.value)
		).toEqual(['30002510'])
	})

	it('uses custom local search text delegate when provided', () => {
		expect(
			filterSelectOptions({
				searchable: true,
				hasSearchDelegate: false,
				baseOptions: BASE_OPTIONS,
				trimmedQuery: 'tradehub',
				getOptionSearchText: (option) =>
					option.value === '30000142' ? 'tradehub jita market' : option.label,
			}).map((option) => option.value)
		).toEqual(['30000142'])
	})
})

describe('select-logic: rendered options', () => {
	it('returns filtered options as-is when select-all is not configured', () => {
		expect(
			buildRenderedSelectOptions({
				filteredOptions: BASE_OPTIONS,
			})
		).toEqual(BASE_OPTIONS)
	})

	it('prepends a synthetic select-all option when configured', () => {
		const rendered = buildRenderedSelectOptions({
			filteredOptions: BASE_OPTIONS,
			selectAllOption: { value: '__all__', label: 'All Systems' },
		})

		expect(rendered).toHaveLength(BASE_OPTIONS.length + 1)
		expect(isSelectAllInternalOption(rendered[0]!)).toBe(true)
		expect(rendered[0]).toMatchObject({
			value: '__all__',
			label: 'All Systems',
		})
	})
})

describe('select-logic: known/selected options', () => {
	it('deduplicates known options by value with precedence filtered > delegate > base', () => {
		const known = buildKnownSelectOptions({
			options: [{ value: 'v', label: 'Base' }],
			delegateOptions: [{ value: 'v', label: 'Delegate' }],
			filteredOptions: [{ value: 'v', label: 'Filtered' }],
		})

		expect(known).toEqual([{ value: 'v', label: 'Filtered' }])
	})

	it('resolves selected option by value first, then by label', () => {
		expect(
			resolveSelectedOption({
				knownOptions: BASE_OPTIONS,
				selectedValue: '30002187',
			})
		).toMatchObject({ label: 'Amarr' })

		expect(
			resolveSelectedOption({
				knownOptions: BASE_OPTIONS,
				selectedValue: 'Rens',
			})
		).toMatchObject({ value: '30002510' })
	})

	it('does not resolve by label when label matches are ambiguous', () => {
		expect(
			resolveSelectedOption({
				knownOptions: [
					{ value: 'id-1', label: 'Duplicate' },
					{ value: 'id-2', label: 'Duplicate' },
				],
				selectedValue: 'Duplicate',
			})
		).toBeNull()
	})

	it('returns null for selected option when no value is selected or no match exists', () => {
		expect(
			resolveSelectedOption({
				knownOptions: BASE_OPTIONS,
				selectedValue: '',
			})
		).toBeNull()

		expect(
			resolveSelectedOption({
				knownOptions: BASE_OPTIONS,
				selectedValue: 'nope',
			})
		).toBeNull()
	})

	it('resolves selected label from selected option first, then cached label', () => {
		expect(
			resolveSelectedLabel({
				selectedValue: '30000142',
				selectedOptionLabel: 'Jita',
				cachedSelectedLabel: 'Old Jita',
			})
		).toBe('Jita')

		expect(
			resolveSelectedLabel({
				selectedValue: '30000142',
				selectedOptionLabel: null,
				cachedSelectedLabel: 'Cached Jita',
			})
		).toBe('Cached Jita')
	})

	it('returns null selected label when no selected value exists', () => {
		expect(
			resolveSelectedLabel({
				selectedValue: '',
				selectedOptionLabel: 'Jita',
				cachedSelectedLabel: 'Cached Jita',
			})
		).toBeNull()
	})
})

describe('select-logic: popover/input behavior', () => {
	it('computes option visibility state from min-query block and option count', () => {
		expect(
			resolveCanShowSelectOptions({
				minQueryBlocked: false,
				renderedOptionsLength: 2,
			})
		).toBe(true)

		expect(
			resolveCanShowSelectOptions({
				minQueryBlocked: true,
				renderedOptionsLength: 2,
			})
		).toBe(false)
	})

	it('opens on focus for non-searchable, active-search, or available options', () => {
		expect(
			resolveShouldOpenSelectOnFocus({
				searchable: false,
				isCommitted: true,
				trimmedQuery: '',
				renderedOptionsLength: 0,
			})
		).toBe(true)

		expect(
			resolveShouldOpenSelectOnFocus({
				searchable: true,
				isCommitted: false,
				trimmedQuery: 'ji',
				renderedOptionsLength: 0,
			})
		).toBe(true)

		expect(
			resolveShouldOpenSelectOnFocus({
				searchable: true,
				isCommitted: true,
				trimmedQuery: '',
				renderedOptionsLength: 3,
			})
		).toBe(true)
	})

	it('stays closed on focus for committed searchable inputs with no rendered options', () => {
		expect(
			resolveShouldOpenSelectOnFocus({
				searchable: true,
				isCommitted: true,
				trimmedQuery: '',
				renderedOptionsLength: 0,
			})
		).toBe(false)
	})

	it('uses selected label as placeholder only when searchable and query is empty', () => {
		expect(
			resolveSelectInputPlaceholder({
				searchable: true,
				effectiveQueryValue: '',
				selectedLabel: 'Jita',
				placeholder: 'Search...',
			})
		).toBe('Jita')

		expect(
			resolveSelectInputPlaceholder({
				searchable: true,
				effectiveQueryValue: 'ji',
				selectedLabel: 'Jita',
				placeholder: 'Search...',
			})
		).toBe('Search...')

		expect(
			resolveSelectInputPlaceholder({
				searchable: false,
				effectiveQueryValue: '',
				selectedLabel: 'Jita',
				placeholder: 'Choose...',
			})
		).toBe('Choose...')
	})
})
