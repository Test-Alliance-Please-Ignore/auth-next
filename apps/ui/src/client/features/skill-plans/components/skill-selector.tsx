import { Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useAppTranslation } from '@/i18n'

import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Select } from '../../../components/ui/select'
import { useAvailableSkills, useSearchSkills } from '../hooks'

import type { AddSkillRequest, AvailableSkill } from '../types'

interface SkillSelectorProps {
	existingSkillIds: string[]
	onAddSkill: (skill: AddSkillRequest) => Promise<void>
	isSubmitting?: boolean
}

export function SkillSelector({
	existingSkillIds,
	onAddSkill,
	isSubmitting = false,
}: SkillSelectorProps) {
	const { t } = useAppTranslation()

	const [searchTerm, setSearchTerm] = useState('')
	const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
	const [selectedGroup, setSelectedGroup] = useState<string>('all')
	const [selectedSkill, setSelectedSkill] = useState<AvailableSkill | null>(null)
	const [requiredLevel, setRequiredLevel] = useState(0)
	const [recommendedLevel, setRecommendedLevel] = useState(5)

	// Use search API when search term is provided, otherwise get all skills
	const { data: allSkills, isLoading: allSkillsLoading } = useAvailableSkills()
	const { data: searchResults, isLoading: searchLoading } = useSearchSkills(
		debouncedSearchTerm,
		debouncedSearchTerm.length >= 2
	)

	// Debounce search term
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearchTerm(searchTerm)
		}, 300) // 300ms debounce

		return () => clearTimeout(timer)
	}, [searchTerm])

	// Determine which skills to use
	const availableSkills = useMemo(() => {
		// If we have a search term and search results, use those
		if (debouncedSearchTerm.length >= 2 && searchResults) {
			return searchResults
		}
		// Otherwise use all skills
		return allSkills || []
	}, [debouncedSearchTerm, searchResults, allSkills, t])

	// Loading state
	const isLoading = debouncedSearchTerm.length >= 2 ? searchLoading : allSkillsLoading

	// Get unique skill groups
	const skillGroups = useMemo(() => {
		if (!availableSkills) return []
		const groups = new Set(availableSkills.map((s) => s.group))
		return Array.from(groups).sort()
	}, [availableSkills, t])

	// Filter skills based on group and existing skills
	const filteredSkills = useMemo(() => {
		if (!availableSkills) return []

		return availableSkills.filter((skill) => {
			// Exclude already added skills
			if (existingSkillIds.includes(skill.skillId)) return false

			// Apply group filter
			if (selectedGroup !== 'all' && skill.group !== selectedGroup) {
				return false
			}

			return true
		})
	}, [availableSkills, existingSkillIds, selectedGroup, t])

	const handleAddSkill = async () => {
		if (!selectedSkill) return

		try {
			await onAddSkill({
				skillId: selectedSkill.skillId,
				requiredLevel,
				recommendedLevel,
			})

			// Reset form
			setSelectedSkill(null)
			setRequiredLevel(0)
			setRecommendedLevel(5)
		} catch (error) {
			console.error('Failed to add skill:', error)
		}
	}

	// Reset selected skill when filtered skills change
	useEffect(() => {
		if (selectedSkill && !filteredSkills.find((s) => s.skillId === selectedSkill.skillId)) {
			setSelectedSkill(null)
		}
	}, [filteredSkills, selectedSkill])

	return (
		<div className="space-y-4">
			{/* Search and filters */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div className="space-y-2">
					<Label htmlFor="skill-search">{t('skillPlans.searchSkills')}</Label>
					<div className="relative">
						<Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							id="skill-search"
							placeholder={t('skillPlans.searchBySkillNameMin2Characters')}
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							className="pl-8"
							disabled={isSubmitting}
						/>
					</div>
					{searchTerm.length > 0 && searchTerm.length < 2 && (
						<p className="text-xs text-muted-foreground">
							{t('skillPlans.typeAtLeast2CharactersToSearch')}
						</p>
					)}
				</div>

				<div className="space-y-2">
					<Label htmlFor="skill-group">{t('skillPlans.skillGroup')}</Label>
					<Select
						value={selectedGroup}
						onValueChange={setSelectedGroup}
						inputId="skill-group"
						options={[
							{ value: 'all', label: t('skillPlans.allGroups') },
							...skillGroups.map((group) => ({ value: group, label: group })),
						]}
						placeholder={t('skillPlans.allGroups')}
						disabled={isLoading || isSubmitting}
					/>
				</div>
			</div>

			{/* Skill selection */}
			<Card>
				<CardHeader>
					<CardTitle>{t('skillPlans.addSkillToPlan')}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{/* Loading state */}
					{isLoading && (
						<div className="text-sm text-muted-foreground">
							{searchTerm ? t('skillPlans.searchingSkills') : t('skillPlans.loadingSkills')}
						</div>
					)}

					{/* Skill dropdown */}
					{!isLoading && (
						<div className="space-y-2">
							<Label htmlFor="skill-select">{t('skillPlans.selectSkill')}</Label>
							<Select
								value={selectedSkill?.skillId || ''}
								onValueChange={(value) => {
									const skill = filteredSkills.find((s) => s.skillId === value)
									setSelectedSkill(skill || null)
								}}
								inputId="skill-select"
								options={filteredSkills.map((skill) => ({
									value: skill.skillId,
									label: `${skill.name} (${skill.group})`,
								}))}
								placeholder={t('skillPlans.chooseASkillToAdd')}
								emptyText={
									searchTerm ? t('skillPlans.noSkillsMatch') : t('skillPlans.noSkillsAvailable')
								}
								disabled={isLoading || isSubmitting}
							/>
							{filteredSkills.length > 0 && (
								<p className="text-xs text-muted-foreground">
									{t('skillPlans.found')}
									{t('skillPlans.skill2Count', { count: filteredSkills.length })}
									{searchTerm && t('skillPlans.matchingQuery', { value1: searchTerm })}
									{selectedGroup !== 'all' && t('skillPlans.inGroup', { value1: selectedGroup })}
								</p>
							)}
						</div>
					)}

					{/* Level selectors */}
					{selectedSkill && (
						<>
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label htmlFor="required-level">{t('skillPlans.requiredLevel')}</Label>
									<Select
										value={String(requiredLevel)}
										onValueChange={(value) => {
											const level = parseInt(value)
											setRequiredLevel(level)
											// Ensure recommended is at least required
											if (recommendedLevel < level) {
												setRecommendedLevel(level)
											}
										}}
										inputId="required-level"
										options={[0, 1, 2, 3, 4, 5].map((level) => ({
											value: String(level),
											label:
												level === 0
													? t('skillPlans.optional')
													: t('skillPlans.level', { value1: level }),
										}))}
										disabled={isSubmitting}
									/>
									<p className="text-xs text-muted-foreground">
										{t('skillPlans.minimumLevelNeededForThePlan')}
									</p>
								</div>

								<div className="space-y-2">
									<Label htmlFor="recommended-level">{t('skillPlans.recommendedLevel')}</Label>
									<Select
										value={String(recommendedLevel)}
										onValueChange={(value) => setRecommendedLevel(parseInt(value))}
										inputId="recommended-level"
										options={[1, 2, 3, 4, 5]
											.filter((level) => level >= requiredLevel)
											.map((level) => ({
												value: String(level),
												label: t('skillPlans.level', { value1: level }),
											}))}
										disabled={isSubmitting}
									/>
									<p className="text-xs text-muted-foreground">
										{t('skillPlans.idealLevelForFullEffectiveness')}
									</p>
								</div>
							</div>

							{/* Add button */}
							<Button onClick={handleAddSkill} disabled={isSubmitting} className="w-full">
								<Plus className="h-4 w-4" />
								{t('skillPlans.add2')}
								{selectedSkill.name}
								{t('skillPlans.toPlan')}
							</Button>
						</>
					)}
				</CardContent>
			</Card>

			{/* Info text */}
			<p className="text-sm text-muted-foreground">
				{t('skillPlans.alreadyAddedSkillsAreAutomaticallyHiddenFromTheSelectionRequired')}
				{searchTerm && t('skillPlans.searchCacheHint')}
			</p>
		</div>
	)
}
