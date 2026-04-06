import { describe, expect, it } from 'vitest'

import { validateBroadcastPermissionUrn } from '../broadcast-urn'

describe('validateBroadcastPermissionUrn', () => {
	it('accepts non-broadcast URNs without special validation', () => {
		expect(validateBroadcastPermissionUrn('urn:tax:admin')).toBeNull()
	})

	it('accepts valid broadcast send/manage URNs', () => {
		expect(validateBroadcastPermissionUrn('urn:broadcasts:test-alliance:info-all:send')).toBeNull()
		expect(validateBroadcastPermissionUrn('urn:broadcasts:test-alliance:info-all:manage')).toBeNull()
	})

	it('rejects invalid broadcast namespace/target/action', () => {
		expect(validateBroadcastPermissionUrn('urn:broadcasts:test alliance:info-all:send')).toContain(
			'namespace'
		)
		expect(validateBroadcastPermissionUrn('urn:broadcasts:test-alliance:info all:send')).toContain(
			'target'
		)
		expect(validateBroadcastPermissionUrn('urn:broadcasts:test-alliance:info-all:view')).toContain(
			'action'
		)
	})
})
