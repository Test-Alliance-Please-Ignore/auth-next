import { describe, expect, it } from 'vitest'

import {
	resolveSelectInputValue,
	shouldClearSelectQueryOnSelect,
} from '../../client/components/ui/select-behavior'

describe('select behavior invariants', () => {
	it('shows selected label in non-searchable mode', () => {
		expect(
			resolveSelectInputValue({
				searchable: false,
				queryValue: 'ignored',
				selectedOptionLabel: 'Amarr Navy',
				open: false,
				focused: false,
			})
		).toBe('Amarr Navy')
	})

	it('shows selected label in searchable mode when idle', () => {
		expect(
			resolveSelectInputValue({
				searchable: true,
				queryValue: '',
				selectedOptionLabel: 'Amarr Navy',
				open: false,
				focused: false,
			})
		).toBe('Amarr Navy')
	})

	it('clears displayed selected label while focused to allow fresh typing', () => {
		expect(
			resolveSelectInputValue({
				searchable: true,
				queryValue: '',
				selectedOptionLabel: 'Amarr Navy',
				open: false,
				focused: true,
			})
		).toBe('')
	})

	it('uses live query text while popover is open', () => {
		expect(
			resolveSelectInputValue({
				searchable: true,
				queryValue: '',
				selectedOptionLabel: 'Amarr Navy',
				open: true,
				focused: true,
			})
		).toBe('')
	})

	it('uses query text when user is actively typing', () => {
		expect(
			resolveSelectInputValue({
				searchable: true,
				queryValue: 'ama',
				selectedOptionLabel: 'Amarr Navy',
				open: true,
				focused: true,
			})
		).toBe('ama')
	})

	it('clears query on select only when searchable query text exists', () => {
		expect(
			shouldClearSelectQueryOnSelect({
				searchable: true,
				queryValue: 'search term',
			})
		).toBe(true)
		expect(
			shouldClearSelectQueryOnSelect({
				searchable: true,
				queryValue: '',
			})
		).toBe(false)
		expect(
			shouldClearSelectQueryOnSelect({
				searchable: false,
				queryValue: 'search term',
			})
		).toBe(false)
	})
})
