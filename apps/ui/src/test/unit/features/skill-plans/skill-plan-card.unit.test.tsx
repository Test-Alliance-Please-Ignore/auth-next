import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { SkillPlanCard } from '@/features/skill-plans/components/skill-plan-card'

import type { SkillPlan } from '@/features/skill-plans/types'

const basePlan: SkillPlan = {
	id: 'plan-1',
	name: 'Plan One',
	description: 'Test plan',
	isPublished: true,
	maintainerId: null,
	ownerCharacterId: null,
	createdAt: '2025-01-01T00:00:00Z',
	updatedAt: '2025-01-01T00:00:00Z',
}

describe('SkillPlanCard readiness badges', () => {
	it('renders "Meets Required" label for warning segment', () => {
		const html = renderToStaticMarkup(
			<MemoryRouter>
				<SkillPlanCard
					plan={basePlan}
					characterReadiness={{
						completed: 0,
						meetsRequirements: 2,
						incomplete: 0,
						total: 2,
					}}
				/>
			</MemoryRouter>
		)

		expect(html).toMatch(/Meets Required\s*<span[^>]*>2<\/span>/)
		expect(html).not.toContain('Meets 2')
	})

	it('does not render zero-count badges', () => {
		const html = renderToStaticMarkup(
			<MemoryRouter>
				<SkillPlanCard
					plan={basePlan}
					characterReadiness={{
						completed: 0,
						meetsRequirements: 1,
						incomplete: 0,
						total: 1,
					}}
				/>
			</MemoryRouter>
		)

		expect(html).toMatch(/Meets Required\s*<span[^>]*>1<\/span>/)
		expect(html).not.toContain('Completed')
		expect(html).not.toContain('Incomplete')
	})
})
