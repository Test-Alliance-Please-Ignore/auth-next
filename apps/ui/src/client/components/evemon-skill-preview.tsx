import { AlertCircle, CheckCircle2 } from 'lucide-react'

import { formatSkillLevel } from '../lib/evemon-parser'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

import type { ParsedEvemonSkill } from '../lib/evemon-parser'

interface EvemonSkillPreviewProps {
	skills: ParsedEvemonSkill[]
	onConfirm: () => void
	onCancel: () => void
	isLoading?: boolean
}

export function EvemonSkillPreview({
	skills,
	onConfirm,
	onCancel,
	isLoading = false,
}: EvemonSkillPreviewProps) {
	const totalSkills = skills.length

	return (
		<div className="space-y-4">
			<Card>
				<CardContent className="flex items-start gap-2 pt-4">
					<CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
					<div className="text-sm">
						Successfully parsed {totalSkills} unique skill{totalSkills !== 1 ? 's' : ''} from EVEMon
						XML. Priority 1-9 skills will be imported as required, priority 10 as optional
						(recommended only).
					</div>
				</CardContent>
			</Card>

			<div className="border rounded-lg overflow-hidden">
				<div className="max-h-[400px] overflow-y-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Skill Name</TableHead>
								<TableHead className="text-center">Required</TableHead>
								<TableHead className="text-center">Recommended</TableHead>
								<TableHead className="text-center">Priority</TableHead>
								<TableHead className="text-right">Skill ID</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{skills.map((skill) => (
								<TableRow key={skill.skillId}>
									<TableCell className="font-medium">{skill.skillName}</TableCell>
									<TableCell className="text-center">
										{skill.requiredLevel > 0 ? (
											<span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-semibold rounded bg-primary/10 text-primary">
												Level {formatSkillLevel(skill.requiredLevel)}
											</span>
										) : (
											<span className="text-muted-foreground">—</span>
										)}
									</TableCell>
									<TableCell className="text-center">
										<span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-semibold rounded bg-blue-50 text-blue-700">
											Level {formatSkillLevel(skill.recommendedLevel)}
										</span>
									</TableCell>
									<TableCell className="text-center text-muted-foreground">
										{skill.priority}
									</TableCell>
									<TableCell className="text-right text-muted-foreground">
										{skill.skillId}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			</div>

			<Card>
				<CardContent className="flex items-start gap-2 pt-4">
					<AlertCircle className="h-4 w-4 text-blue-600 mt-0.5" />
					<div className="text-sm text-muted-foreground">
						After import, you can adjust the required and recommended levels for individual skills
						in the skill plan editor.
					</div>
				</CardContent>
			</Card>

			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" onClick={onCancel} disabled={isLoading}>
					Cancel
				</Button>
				<Button variant="confirm"
					type="button"
					onClick={onConfirm}
					loading={isLoading}
					loadingText="Importing..."
					showIcon={!isLoading}
				>
					{`Import ${totalSkills} Skill${totalSkills !== 1 ? 's' : ''}`}
				</Button>
			</div>
		</div>
	)
}
