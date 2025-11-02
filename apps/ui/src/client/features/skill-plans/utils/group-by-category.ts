import type { SkillPlan, SkillPlanCategory } from '../types'

export interface CategoryGroup {
	category: SkillPlanCategory | null // null for uncategorized
	plans: SkillPlan[]
}

/**
 * Groups skill plans by their categories
 * - Plans with multiple categories appear in each category
 * - Categories are sorted by displayOrder
 * - Plans within categories are sorted alphabetically by name
 * - Plans without categories go into "Uncategorized" section at the end
 */
export function groupPlansByCategory(plans: SkillPlan[]): CategoryGroup[] {
	// Build a map of categoryId -> category info
	const categoryMap = new Map<string, SkillPlanCategory>()
	const categoryPlansMap = new Map<string, SkillPlan[]>()
	const uncategorizedPlans: SkillPlan[] = []

	// Process each plan
	for (const plan of plans) {
		if (!plan.categories || plan.categories.length === 0) {
			// No categories - goes to uncategorized
			uncategorizedPlans.push(plan)
		} else {
			// Add plan to each of its categories
			for (const category of plan.categories) {
				// Store category info
				if (!categoryMap.has(category.id)) {
					categoryMap.set(category.id, category)
					categoryPlansMap.set(category.id, [])
				}

				// Add plan to this category
				categoryPlansMap.get(category.id)!.push(plan)
			}
		}
	}

	// Sort plans alphabetically within each category
	for (const plans of categoryPlansMap.values()) {
		plans.sort((a, b) => a.name.localeCompare(b.name))
	}

	// Sort uncategorized plans alphabetically
	uncategorizedPlans.sort((a, b) => a.name.localeCompare(b.name))

	// Build the result array, sorted by category displayOrder
	const categories = Array.from(categoryMap.values()).sort(
		(a, b) => a.displayOrder - b.displayOrder
	)

	const groups: CategoryGroup[] = categories.map((category) => ({
		category,
		plans: categoryPlansMap.get(category.id) || [],
	}))

	// Add uncategorized section at the end if there are any
	if (uncategorizedPlans.length > 0) {
		groups.push({
			category: null,
			plans: uncategorizedPlans,
		})
	}

	return groups
}
