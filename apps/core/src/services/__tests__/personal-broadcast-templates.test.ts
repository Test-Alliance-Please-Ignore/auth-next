import { drizzle } from 'drizzle-orm/pg-proxy'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { schema } from '../../db'
import { PersonalBroadcastTemplatesService } from '../personal-broadcast-templates'

import type { createDb } from '../../db'

const execute = vi.fn(async (_query: string, _params: unknown[], _method: string) => ({
	rows: [['owner']],
}))
const db = drizzle(execute, { schema }) as unknown as ReturnType<typeof createDb>
const service = new PersonalBroadcastTemplatesService(db)
const input = {
	name: 'My preset',
	targetId: 'target',
	templateId: null,
	content: { message: 'Hello' },
}

beforeEach(() => {
	execute.mockClear()
	execute.mockResolvedValue({ rows: [['owner']] })
})

describe('personal template storage SQL', () => {
	it('enforces the cap in the same atomic upsert that appends to existing settings', async () => {
		const saved = await service.create('owner', input)
		expect(saved).toMatchObject(input)
		expect(execute).toHaveBeenCalledTimes(1)
		const [query, params] = execute.mock.calls[0]!
		expect(query).toContain('on conflict ("user_id") do update')
		expect(query).toContain('jsonb_set("user_preferences"."preferences"')
		expect(query).toContain('jsonb_array_length(')
		expect(query).toContain(' || ')
		expect(params).toContain(6)
		expect(params).toContain('owner')
	})
	it('reports a full collection without retrying an unchecked write', async () => {
		execute.mockResolvedValue({ rows: [] })
		expect(await service.create('owner', input)).toBeNull()
		expect(execute).toHaveBeenCalledTimes(1)
	})
	it.each(['update', 'delete'] as const)(
		'parameterizes the owner and template ID for %s and preserves unrelated settings',
		async (operation) => {
			const id = "private' OR true --"
			if (operation === 'update') await service.update('owner', id, input)
			else await service.delete('owner', id)
			const [query, params] = execute.mock.calls[0]!
			expect(query).toContain('"user_preferences"."user_id" = ')
			expect(query).toContain('jsonb_set("user_preferences"."preferences"')
			expect(query).toContain('order by position')
			expect(query).not.toContain(id)
			expect(params).toContain(id)
			expect(params).toContain('owner')
		}
	)
	it('filters reads by the authenticated owner', async () => {
		execute.mockResolvedValue({ rows: [] })
		expect(await service.list('owner')).toEqual([])
		expect(execute.mock.calls[0]![0]).toContain('"userPreferences"."user_id" = ')
		expect(execute.mock.calls[0]![1]).toContain('owner')
	})
})
