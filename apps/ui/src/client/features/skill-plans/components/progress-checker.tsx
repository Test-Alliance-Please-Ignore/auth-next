import { useState } from 'react'
import { CheckCircle2, XCircle, AlertCircle, Filter } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useCharacterProgress } from '../hooks'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Label } from '../../../components/ui/label'
import { LoadingSpinner } from '../../../components/ui/loading'
import { Progress } from '../../../components/ui/progress'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '../../../components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '../../../components/ui/table'

interface ProgressCheckerProps {
	planId: string
	planName?: string
}

export function ProgressChecker({ planId, planName }: ProgressCheckerProps) {
	const { user } = useAuth()
	const [selectedCharacterId, setSelectedCharacterId] = useState<string>(
		user?.mainCharacterId || ''
	)
	const [skillFilter, setSkillFilter] = useState<'all' | 'needs-training' | 'missing-required'>('all')

	const { data: progress, isLoading } = useCharacterProgress(
		planId,
		selectedCharacterId || undefined
	)

	if (!user) {
		return (
			<Card>
				<CardContent className="py-8 text-center text-muted-foreground">
					Please log in to check character progress.
				</CardContent>
			</Card>
		)
	}

	const selectedCharacter = user.characters.find((c) => c.characterId === selectedCharacterId)

	return (
		<div className="space-y-4">
			{/* Character selector */}
			<div className="space-y-2">
				<Label htmlFor="character">Select Character</Label>
				<Select value={selectedCharacterId} onValueChange={setSelectedCharacterId}>
					<SelectTrigger id="character">
						<SelectValue placeholder="Choose a character..." />
					</SelectTrigger>
					<SelectContent>
						{user.characters.map((char) => (
							<SelectItem key={char.characterId} value={char.characterId}>
								{char.characterName}
								{!char.hasValidToken && (
									<span className="text-muted-foreground ml-2">(Token expired)</span>
								)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* Progress display */}
			{isLoading ? (
				<Card>
					<CardContent className="py-8 flex items-center justify-center">
						<LoadingSpinner />
						<span className="ml-2">Checking character skills...</span>
					</CardContent>
				</Card>
			) : progress ? (
				<>
					{/* Overall progress */}
					<Card>
						<CardHeader>
							<CardTitle>Overall Progress</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<div className="flex justify-between text-sm">
									<span>Required Skills</span>
									<span className="font-medium">
										{progress.completedRequired || 0} / {progress.totalSkills || 0} completed
									</span>
								</div>
								<Progress value={progress.percentageRequired || 0} className="h-2" />
								<p className="text-xs text-muted-foreground">
									{(progress.percentageRequired || 0).toFixed(1)}% of required skills met
								</p>
							</div>

							<div className="space-y-2">
								<div className="flex justify-between text-sm">
									<span>Recommended Skills</span>
									<span className="font-medium">
										{progress.completedRecommended || 0} / {progress.totalSkills || 0} completed
									</span>
								</div>
								<Progress value={progress.percentageRecommended || 0} className="h-2" />
								<p className="text-xs text-muted-foreground">
									{(progress.percentageRecommended || 0).toFixed(1)}% of recommended skills met
								</p>
							</div>

							{/* Status badge */}
							<div className="flex items-center gap-2 pt-2">
								{(progress.percentageRequired || 0) === 100 ? (
									<Badge variant="default" className="flex items-center gap-1">
										<CheckCircle2 className="h-3 w-3" />
										Ready for plan
									</Badge>
								) : (progress.percentageRequired || 0) >= 75 ? (
									<Badge variant="secondary" className="flex items-center gap-1">
										<AlertCircle className="h-3 w-3" />
										Almost ready
									</Badge>
								) : (
									<Badge variant="destructive" className="flex items-center gap-1">
										<XCircle className="h-3 w-3" />
										Training needed
									</Badge>
								)}
							</div>
						</CardContent>
					</Card>

					{/* Skills breakdown */}
					<Card>
						<CardHeader>
							<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
								<CardTitle>Skills Breakdown</CardTitle>
								<div className="inline-flex rounded-lg border divide-x">
									<Button
										variant={skillFilter === 'all' ? 'secondary' : 'ghost'}
										size="sm"
										className="text-xs h-8 rounded-none rounded-l-md border-0"
										onClick={() => setSkillFilter('all')}
									>
										All ({progress.skills?.length || 0})
									</Button>
									<Button
										variant={skillFilter === 'missing-required' ? 'secondary' : 'ghost'}
										size="sm"
										className="text-xs h-8 rounded-none border-0"
										onClick={() => setSkillFilter('missing-required')}
									>
										<XCircle className="h-3 w-3 mr-1" />
										Required ({progress.skills?.filter(s => !s.meetsRequired).length || 0})
									</Button>
									<Button
										variant={skillFilter === 'needs-training' ? 'secondary' : 'ghost'}
										size="sm"
										className="text-xs h-8 rounded-none rounded-r-md border-0"
										onClick={() => setSkillFilter('needs-training')}
									>
										<Filter className="h-3 w-3 mr-1" />
										Training ({progress.skills?.filter(s => !s.meetsRecommended).length || 0})
									</Button>
								</div>
							</div>
						</CardHeader>
						<CardContent>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Skill</TableHead>
										<TableHead className="text-center">Current</TableHead>
										<TableHead className="text-center">Required</TableHead>
										<TableHead className="text-center">Recommended</TableHead>
										<TableHead>Status</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{(() => {
										const allSkills = progress.skills || []
										let filteredSkills = allSkills

										if (skillFilter === 'needs-training') {
											filteredSkills = allSkills.filter(skill => !skill.meetsRecommended)
										} else if (skillFilter === 'missing-required') {
											filteredSkills = allSkills.filter(skill => !skill.meetsRequired)
										}

										if (filteredSkills.length === 0) {
											let message = ''
											if (skillFilter === 'needs-training') {
												message = 'All skills are fully trained to recommended levels! 🎉'
											} else if (skillFilter === 'missing-required') {
												message = 'All required skills are trained! ✅'
											}

											if (message) {
												return (
													<TableRow>
														<TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
															{message}
														</TableCell>
													</TableRow>
												)
											}
										}

										return filteredSkills.map((skill) => (
										<TableRow key={skill.skillId}>
											<TableCell className="font-medium">{skill.skillName || 'Unknown Skill'}</TableCell>
											<TableCell className="text-center">
												{(skill.currentLevel || 0) > 0 ? skill.currentLevel : '-'}
											</TableCell>
											<TableCell className="text-center">{skill.requiredLevel || 0}</TableCell>
											<TableCell className="text-center">{skill.recommendedLevel || 0}</TableCell>
											<TableCell>
												{skill.meetsRecommended ? (
													<div className="flex items-center gap-1 text-green-500">
														<CheckCircle2 className="h-4 w-4" />
														<span className="text-xs">Fully trained</span>
													</div>
												) : skill.meetsRequired ? (
													<div className="flex items-center gap-1 text-yellow-500">
														<AlertCircle className="h-4 w-4" />
														<span className="text-xs">Meets minimum</span>
													</div>
												) : (
													<div className="flex items-center gap-1 text-destructive">
														<XCircle className="h-4 w-4" />
														<span className="text-xs">
															{skill.currentLevel === 0 ? 'Not trained' : 'Needs training'}
														</span>
													</div>
												)}
											</TableCell>
										</TableRow>
										))
									})()}
								</TableBody>
							</Table>

							{(!progress.skills || progress.skills.length === 0) && (
								<div className="text-center py-8 text-muted-foreground">
									This plan has no skills added yet.
								</div>
							)}
						</CardContent>
					</Card>
				</>
			) : selectedCharacter && !selectedCharacter.hasValidToken ? (
				<Card>
					<CardContent className="py-8 text-center">
						<p className="text-muted-foreground mb-2">
							This character's EVE token has expired.
						</p>
						<p className="text-sm text-muted-foreground">
							Please re-authenticate with EVE Online to check skill progress.
						</p>
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground">
						Select a character to check progress.
					</CardContent>
				</Card>
			)}
		</div>
	)
}