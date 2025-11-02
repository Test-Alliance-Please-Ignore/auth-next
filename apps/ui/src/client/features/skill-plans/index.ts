// Public exports for skill plans feature
export * from './types'
export * from './api'
export * from './hooks'

// Component exports (to be added as we create them)
export { SkillPlanCard } from './components/skill-plan-card'
export { SkillPlanForm } from './components/skill-plan-form'
export { SkillSelector } from './components/skill-selector'
export { ProgressChecker } from './components/progress-checker'
export { CategoryForm } from './components/category-form'

// Route exports (for lazy loading)
export { default as SkillPlansList } from './routes/skill-plans-list'
export { default as SkillPlanDetail } from './routes/skill-plan-detail'
export { default as SkillPlanCreate } from './routes/skill-plan-create'
export { default as SkillPlanEdit } from './routes/skill-plan-edit'
export { default as SkillPlanProgress } from './routes/skill-plan-progress'
export { default as MySkillPlans } from './routes/my-skill-plans'
export { default as CategoriesManagement } from './routes/categories-management'