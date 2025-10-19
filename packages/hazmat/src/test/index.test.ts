import { describe, expect, it } from 'vitest'

import { example, fetchData, processAsync, validateEmail } from '../index'

describe('Hazmat', () => {
	describe('example', () => {
		it('should format input with prefix', () => {
			const result = example('hello')
			expect(result).toBe('Example: hello')
		})

		it('should handle empty string', () => {
			const result = example('')
			expect(result).toBe('Example: ')
		})
	})

	describe('validateEmail', () => {
		it('should validate and normalize correct email', () => {
			const result = validateEmail('Test@Example.COM')
			expect(result).toBe('test@example.com')
		})

		it('should throw error for empty email', () => {
			expect(() => validateEmail('')).toThrow('Email is required')
		})

		it('should throw error for whitespace-only email', () => {
			expect(() => validateEmail('   ')).toThrow('Email is required')
		})

		it('should throw error for invalid email format', () => {
			expect(() => validateEmail('notanemail')).toThrow('Invalid email format')
		})

		it('should throw error for email without domain', () => {
			expect(() => validateEmail('user@')).toThrow('Invalid email format')
		})

		it('should throw error for email without @', () => {
			expect(() => validateEmail('user.example.com')).toThrow('Invalid email format')
		})
	})

	describe('fetchData', () => {
		it('should fetch data successfully', async () => {
			const result = await fetchData('user-123')
			expect(result).toEqual({
				id: 'user-123',
				data: 'Data for user-123',
			})
		})

		it('should throw error for empty ID', async () => {
			await expect(fetchData('')).rejects.toThrow('ID is required')
		})

		it('should throw error for whitespace-only ID', async () => {
			await expect(fetchData('   ')).rejects.toThrow('ID is required')
		})

		it('should handle multiple concurrent fetches', async () => {
			const results = await Promise.all([
				fetchData('id-1'),
				fetchData('id-2'),
				fetchData('id-3'),
			])

			expect(results).toHaveLength(3)
			expect(results[0].id).toBe('id-1')
			expect(results[1].id).toBe('id-2')
			expect(results[2].id).toBe('id-3')
		})
	})

	describe('processAsync', () => {
		it('should process value successfully', async () => {
			const result = await processAsync('test')
			expect(result).toBe('Processed: test')
		})

		it('should throw error when shouldFail is true', async () => {
			await expect(processAsync('test', true)).rejects.toThrow('Processing failed')
		})

		it('should handle empty string', async () => {
			const result = await processAsync('')
			expect(result).toBe('Processed: ')
		})

		it('should process multiple values in sequence', async () => {
			const value1 = await processAsync('first')
			const value2 = await processAsync('second')
			const value3 = await processAsync('third')

			expect(value1).toBe('Processed: first')
			expect(value2).toBe('Processed: second')
			expect(value3).toBe('Processed: third')
		})

		it('should handle mixed success and failure cases', async () => {
			const results = await Promise.allSettled([
				processAsync('success'),
				processAsync('fail', true),
				processAsync('another-success'),
			])

			expect(results[0].status).toBe('fulfilled')
			expect(results[1].status).toBe('rejected')
			expect(results[2].status).toBe('fulfilled')

			if (results[0].status === 'fulfilled') {
				expect(results[0].value).toBe('Processed: success')
			}
			if (results[2].status === 'fulfilled') {
				expect(results[2].value).toBe('Processed: another-success')
			}
		})
	})
})
