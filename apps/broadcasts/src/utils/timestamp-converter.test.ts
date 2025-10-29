import { describe, expect, it } from 'vitest'
import { convertUnixTimestamps } from './timestamp-converter'

describe('convertUnixTimestamps', () => {
	describe('10-digit second timestamps', () => {
		it('converts a single 10-digit timestamp', () => {
			const input = 'Event at 1543392060'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('Event at <t:1543392060:f>')
		})

		it('converts multiple 10-digit timestamps', () => {
			const input = 'From 1543392060 to 1543392120'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('From <t:1543392060:f> to <t:1543392120:f>')
		})

		it('converts timestamp at start of message', () => {
			const input = '1543392060 is the event time'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('<t:1543392060:f> is the event time')
		})

		it('converts timestamp at end of message', () => {
			const input = 'Event time: 1543392060'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('Event time: <t:1543392060:f>')
		})
	})

	describe('13-digit millisecond timestamps', () => {
		it('converts a single 13-digit timestamp', () => {
			const input = 'Event at 1543392060000'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('Event at <t:1543392060:f>')
		})

		it('converts multiple 13-digit timestamps', () => {
			const input = 'From 1543392060000 to 1543392120000'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('From <t:1543392060:f> to <t:1543392120:f>')
		})

		it('handles mixed 10 and 13 digit timestamps', () => {
			const input = 'Start 1543392060 end 1543392120000'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('Start <t:1543392060:f> end <t:1543392120:f>')
		})
	})

	describe('already formatted Discord timestamps', () => {
		it('preserves already formatted timestamps', () => {
			const input = 'Event at <t:1543392060:f>'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('Event at <t:1543392060:f>')
		})

		it('preserves timestamps with different format codes', () => {
			const input = 'Relative: <t:1543392060:R> Full: <t:1543392060:F>'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('Relative: <t:1543392060:R> Full: <t:1543392060:F>')
		})

		it('handles mix of formatted and unformatted timestamps', () => {
			const input = 'Already <t:1543392060:f> but not 1543392120'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('Already <t:1543392060:f> but not <t:1543392120:f>')
		})
	})

	describe('edge cases and validation', () => {
		it('does not convert timestamps before year 2000', () => {
			const input = 'Too old: 946684799'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('Too old: 946684799')
		})

		it('does not convert timestamps after year 2100', () => {
			const input = 'Too far: 4102444801'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('Too far: 4102444801')
		})

		it('does not convert numbers that are too short', () => {
			const input = 'Phone: 123456789'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('Phone: 123456789')
		})

		it('does not convert numbers that are too long', () => {
			const input = 'ID: 12345678901234'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('ID: 12345678901234')
		})

		it('does not convert numbers embedded in longer numbers', () => {
			const input = 'Order: X1543392060Y'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('Order: X1543392060Y')
		})

		it('handles empty message', () => {
			const input = ''
			const output = convertUnixTimestamps(input)
			expect(output).toBe('')
		})

		it('handles message with no timestamps', () => {
			const input = 'No timestamps here!'
			const output = convertUnixTimestamps(input)
			expect(output).toBe('No timestamps here!')
		})
	})

	describe('custom format parameter', () => {
		it('uses custom format when specified', () => {
			const input = 'Event at 1543392060'
			const output = convertUnixTimestamps(input, 'R')
			expect(output).toBe('Event at <t:1543392060:R>')
		})

		it('applies custom format to multiple timestamps', () => {
			const input = 'From 1543392060 to 1543392120'
			const output = convertUnixTimestamps(input, 'F')
			expect(output).toBe('From <t:1543392060:F> to <t:1543392120:F>')
		})
	})

	describe('real-world scenarios', () => {
		it('handles typical broadcast message', () => {
			const input =
				'Fleet operation scheduled for 1609459200. Please be online by 1609458600.'
			const output = convertUnixTimestamps(input)
			expect(output).toBe(
				'Fleet operation scheduled for <t:1609459200:f>. Please be online by <t:1609458600:f>.',
			)
		})

		it('handles message with template and timestamp', () => {
			const input = 'Meeting with John Doe at 1609459200 in Conference Room A'
			const output = convertUnixTimestamps(input)
			expect(output).toBe(
				'Meeting with John Doe at <t:1609459200:f> in Conference Room A',
			)
		})

		it('handles multiline messages', () => {
			const input = `Important Event Details:
Date: 1609459200
Location: Station XYZ
Please confirm attendance by 1609372800`
			const output = convertUnixTimestamps(input)
			expect(output).toBe(`Important Event Details:
Date: <t:1609459200:f>
Location: Station XYZ
Please confirm attendance by <t:1609372800:f>`)
		})
	})
})
