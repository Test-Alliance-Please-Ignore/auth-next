import { describe, expect, it } from 'vitest'

import { createPasswordVerifier, generatePassword, VERIFIER_ITERATIONS } from '../hazmat'

describe('generatePassword', () => {
	it('generates 24-character base62 passwords', () => {
		for (let i = 0; i < 20; i++) {
			const password = generatePassword()
			expect(password).toMatch(/^[A-Za-z0-9]{24}$/)
		}
	})

	it('generates unique passwords', () => {
		const passwords = new Set(Array.from({ length: 100 }, () => generatePassword()))
		expect(passwords.size).toBe(100)
	})
})

describe('createPasswordVerifier', () => {
	it('produces a contract-compliant pbkdf2-sha256 verifier', async () => {
		const verifier = await createPasswordVerifier('correct horse battery staple', 200_000)

		expect(verifier.algorithm).toBe('pbkdf2-sha256')
		expect(verifier.iterations).toBe(200_000)
		// hash: standard base64, decodes to exactly 32 bytes
		expect(atob(verifier.hash).length).toBe(32)
		expect(verifier.hash).toHaveLength(44)
		// salt: standard base64, decodes to at least 16 bytes
		expect(atob(verifier.salt).length).toBeGreaterThanOrEqual(16)
	})

	it('defaults to iterations above the contract floor', async () => {
		const verifier = await createPasswordVerifier('pw')
		expect(verifier.iterations).toBe(VERIFIER_ITERATIONS)
		expect(verifier.iterations).toBeGreaterThanOrEqual(200_000)
	})

	it('uses a fresh salt per verifier', async () => {
		const a = await createPasswordVerifier('same-password', 200_000)
		const b = await createPasswordVerifier('same-password', 200_000)
		expect(a.salt).not.toBe(b.salt)
		expect(a.hash).not.toBe(b.hash)
	})

	it('derives deterministically for a fixed salt', async () => {
		// Re-derive manually with the salt from a generated verifier and compare
		const password = 'determinism-check'
		const verifier = await createPasswordVerifier(password, 200_000)

		const saltBytes = Uint8Array.from(atob(verifier.salt), (c) => c.charCodeAt(0))
		const keyMaterial = await crypto.subtle.importKey(
			'raw',
			new TextEncoder().encode(password),
			'PBKDF2',
			false,
			['deriveBits']
		)
		const bits = await crypto.subtle.deriveBits(
			{ name: 'PBKDF2', salt: saltBytes, iterations: 200_000, hash: 'SHA-256' },
			keyMaterial,
			256
		)
		const rederived = btoa(String.fromCharCode(...new Uint8Array(bits)))

		expect(rederived).toBe(verifier.hash)
	})
})
