import { Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

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

interface SkillToAdd extends AddSkillRequest {
	skillName?: string
}

export function SkillSelector({
	existingSkillIds,
	onAddSkill,
	isSubmitting = false,
}: SkillSelectorProps) {
	const [searchTerm, setSearchTerm] = useState('')
	const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
	const [selectedGroup, setSelectedGroup] = useState<string>('all')
	const [selectedSkill, setSelectedSkill] = useState<AvailableSkill | null>(null)
	const [requiredLevel, setRequiredLevel] = useState(1)
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
	}, [debouncedSearchTerm, searchResults, allSkills])

	// Loading state
	const isLoading = debouncedSearchTerm.length >= 2 ? searchLoading : allSkillsLoading

	// Get unique skill groups
	const skillGroups = useMemo(() => {
		if (!availableSkills) return []
		const groups = new Set(availableSkills.map((s) => s.group))
		return Array.from(groups).sort()
	}, [availableSkills])

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
	}, [availableSkills, existingSkillIds, selectedGroup])

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
			setRequiredLevel(1)
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
					<Label htmlFor="skill-search">Search Skills</Label>
					<div className="relative">
						<Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							id="skill-search"
							placeholder="Search by skill name (min 2 characters)..."
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							className="pl-8"
							disabled={isSubmitting}
						/>
					</div>
					{searchTerm.length > 0 && searchTerm.length < 2 && (
						<p className="text-xs text-muted-foreground">Type at least 2 characters to search</p>
					)}
				</div>

				<div className="space-y-2">
					<Label htmlFor="skill-group">Skill Group</Label>
					<Select
						value={selectedGroup}
						onValueChange={setSelectedGroup}
						inputId="skill-group"
						options={[
							{ value: 'all', label: 'All groups' },
							...skillGroups.map((group) => ({ value: group,
								label: group,
							})),
						]}
						placeholder="All groups"
						disabled={isLoading || isSubmitting}
					/>
				</div>
			</div>

			{/* Skill selection */}
			<Card>
				<CardHeader>
					<CardTitle>Add Skill to Plan</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{/* Loading state */}
					{isLoading && (
						<div className="text-sm text-muted-foreground">
							{searchTerm ? 'Searching skills...' : 'Loading skills...'}
						</div>
					)}

					{/* Skill dropdown */}
					{!isLoading && (
						<div className="space-y-2">
							<Label htmlFor="skill-select">Select Skill</Label>
							<Select
								value={selectedSkill?.skillId || ''}
								onValueChange={(value) => {
									const skill = filteredSkills.find((s) => s.skillId === value)
									setSelectedSkill(skill || null)
								}}
								inputId="skill-select"
								options={filteredSkills.map((skill) => ({ value: skill.skillId,
									label: `${skill.name} (${skill.group})`,
								}))}
								placeholder="Choose a skill to add..."
								emptyText={
									searchTerm ? 'No skills found matching your search' : 'No skills available'
								}
								disabled={isLoading || isSubmitting}
							/>
							{filteredSkills.length > 0 && (
								<p className="text-xs text-muted-foreground">
									Found {filteredSkills.length} skill{filteredSkills.length !== 1 ? 's' : ''}
									{searchTerm && ` matching "${searchTerm}"`}
									{selectedGroup !== 'all' && ` in ${selectedGroup}`}
								</p>
							)}
						</div>
					)}

					{/* Level selectors */}
					{selectedSkill && (
						<>
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label htmlFor="required-level">Required Level</Label>
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
										options={[1, 2, 3, 4, 5].map((level) => ({ value: String(level),
											label: `Level ${level}`,
										}))}
										disabled={isSubmitting}
									/>
									<p className="text-xs text-muted-foreground">Minimum level needed for the plan</p>
								</div>

								<div className="space-y-2">
									<Label htmlFor="recommended-level">Recommended Level</Label>
									<Select
										value={String(recommendedLevel)}
										onValueChange={(value) => setRecommendedLevel(parseInt(value))}
										inputId="recommended-level"
										options={[1, 2, 3, 4, 5]
											.filter((level) => level >= requiredLevel)
											.map((level) => ({ value: String(level),
												label: `Level ${level}`,
											}))}
										disabled={isSubmitting}
									/>
									<p className="text-xs text-muted-foreground">
										Ideal level for full effectiveness
									</p>
								</div>
							</div>

							{/* Add button */}
							<Button onClick={handleAddSkill} disabled={isSubmitting} className="w-full">
								<Plus className="h-4 w-4" />
								Add {selectedSkill.name} to Plan
							</Button>
						</>
					)}
				</CardContent>
			</Card>

			{/* Info text */}
			<p className="text-sm text-muted-foreground">
				Already added skills are automatically hidden from the selection. Required level must be
				less than or equal to recommended level.
				{searchTerm && ' Search results are cached for better performance.'}
			</p>
		</div>
	)
}
