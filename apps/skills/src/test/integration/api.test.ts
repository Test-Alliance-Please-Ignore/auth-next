import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getStub } from '@repo/do-utils'

import worker from '../../index'

import type { Skills } from '@repo/skills'
import type { Env } from '../../context'

describe('Skills Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toContain('Skills')
	})

	it('can get skill info via API endpoint', async () => {
		const request = new Request('http://example.com/skill/3300')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		// Note: This will likely return 404 unless skills are loaded in DB
		expect([200, 404]).toContain(response.status)
		const data = await response.json()
		if (response.status === 200) {
			expect(data).toHaveProperty('id')
			expect(data).toHaveProperty('name')
		} else {
			expect(data).toHaveProperty('error')
		}
	})
})

describe('Skills Durable Object', () => {
	it('can create and retrieve a skill plan', async () => {
		const testEnv = env as unknown as Env
		using stub = getStub<Skills>(testEnv.SKILLS, 'test')

		// Create a skill plan
		const plan = await stub.createSkillPlan({
			name: 'Test Plan',
			description: 'A test skill plan',
			isPublished: false,
		})

		expect(plan).toHaveProperty('id')
		expect(plan.name).toBe('Test Plan')
		expect(plan.description).toBe('A test skill plan')
		expect(plan.isPublished).toBe(false)

		// Retrieve the created plan
		const retrievedPlan = await stub.getSkillPlan(plan.id)
		expect(retrievedPlan).not.toBeNull()
		expect(retrievedPlan?.name).toBe('Test Plan')
	})

	it('can add skills to a plan', async () => {
		const testEnv = env as unknown as Env
		using stub = getStub<Skills>(testEnv.SKILLS, 'test')

		// Create a skill plan
		const plan = await stub.createSkillPlan({
			name: 'Skills Test Plan',
			description: 'Testing skill addition',
		})

		// Add a skill to the plan
		const added = await stub.addSkillToPlan({
			planId: plan.id,
			skillId: '3300' as any, // Cast string to EveSkillId
			requiredLevel: 3,
			recommendedLevel: 5,
			notes: 'Core skill for this plan',
		})

		expect(added).toBe(true)
	})

	it('can create and list skill plan categories', async () => {
		const testEnv = env as unknown as Env
		using stub = getStub<Skills>(testEnv.SKILLS, 'test')

		// Create a category
		const category = await stub.createSkillPlanCategory({
			name: 'Combat',
			description: 'Combat-related skills',
			displayOrder: 1,
		})

		expect(category).toHaveProperty('id')
		expect(category.name).toBe('Combat')

		// List categories
		const categories = await stub.listSkillPlanCategories()
		expect(Array.isArray(categories)).toBe(true)
		expect(categories.length).toBeGreaterThan(0)
	})
})
