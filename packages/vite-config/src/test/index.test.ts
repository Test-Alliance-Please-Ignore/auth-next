import { describe, expect, it } from 'vitest'

import { extractWorkerNamesFromConfig } from '../index'

import type { WranglerConfig } from '../index'

describe('vite-config', () => {
	describe('extractWorkerNamesFromConfig', () => {
		it('should return empty set for empty config', () => {
			const config: WranglerConfig = {}
			const result = extractWorkerNamesFromConfig(config)
			expect(result.size).toBe(0)
		})

		it('should extract worker names from durable_objects bindings', () => {
			const config: WranglerConfig = {
				name: 'test-worker',
				durable_objects: {
					bindings: [
						{ script_name: 'worker-a' },
						{ script_name: 'worker-b' },
					],
				},
			}
			const result = extractWorkerNamesFromConfig(config)
			expect(result.size).toBe(2)
			expect(result.has('worker-a')).toBe(true)
			expect(result.has('worker-b')).toBe(true)
		})

		it('should extract worker names from services', () => {
			const config: WranglerConfig = {
				name: 'test-worker',
				services: [{ service: 'service-a' }, { service: 'service-b' }],
			}
			const result = extractWorkerNamesFromConfig(config)
			expect(result.size).toBe(2)
			expect(result.has('service-a')).toBe(true)
			expect(result.has('service-b')).toBe(true)
		})

		it('should combine workers from both durable_objects and services', () => {
			const config: WranglerConfig = {
				name: 'test-worker',
				durable_objects: {
					bindings: [{ script_name: 'worker-a' }],
				},
				services: [{ service: 'service-a' }],
			}
			const result = extractWorkerNamesFromConfig(config)
			expect(result.size).toBe(2)
			expect(result.has('worker-a')).toBe(true)
			expect(result.has('service-a')).toBe(true)
		})

		it('should deduplicate worker names', () => {
			const config: WranglerConfig = {
				name: 'test-worker',
				durable_objects: {
					bindings: [{ script_name: 'shared-worker' }],
				},
				services: [{ service: 'shared-worker' }],
			}
			const result = extractWorkerNamesFromConfig(config)
			expect(result.size).toBe(1)
			expect(result.has('shared-worker')).toBe(true)
		})

		it('should skip bindings without script_name', () => {
			const config: WranglerConfig = {
				name: 'test-worker',
				durable_objects: {
					bindings: [{ script_name: 'worker-a' }, {}],
				},
			}
			const result = extractWorkerNamesFromConfig(config)
			expect(result.size).toBe(1)
			expect(result.has('worker-a')).toBe(true)
		})

		it('should skip services without service property', () => {
			const config: WranglerConfig = {
				name: 'test-worker',
				services: [{ service: 'service-a' }, {}],
			}
			const result = extractWorkerNamesFromConfig(config)
			expect(result.size).toBe(1)
			expect(result.has('service-a')).toBe(true)
		})
	})
})
