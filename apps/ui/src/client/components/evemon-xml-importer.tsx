import { Upload, FileText, AlertCircle } from 'lucide-react'
import { useState } from 'react'
import { parseEvemonXml, type ParsedEvemonSkill } from '../lib/evemon-parser'
import { EvemonSkillPreview } from './evemon-skill-preview'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Textarea } from './ui/textarea'

interface EvemonXmlImporterProps {
	onImport: (skills: ParsedEvemonSkill[]) => void
	onCancel: () => void
	isLoading?: boolean
}

export function EvemonXmlImporter({
	onImport,
	onCancel,
	isLoading = false
}: EvemonXmlImporterProps) {
	const [xmlContent, setXmlContent] = useState('')
	const [parseError, setParseError] = useState<string | null>(null)
	const [parsedSkills, setParsedSkills] = useState<ParsedEvemonSkill[] | null>(null)

	const handleParse = () => {
		if (!xmlContent.trim()) {
			setParseError('Please paste EVEMon XML content')
			return
		}

		const result = parseEvemonXml(xmlContent)

		if (result.success && result.skills) {
			setParsedSkills(result.skills)
			setParseError(null)
		} else {
			setParseError(result.error || 'Failed to parse XML')
			setParsedSkills(null)
		}
	}

	const handleConfirmImport = () => {
		if (parsedSkills) {
			onImport(parsedSkills)
		}
	}

	const handleReset = () => {
		setParsedSkills(null)
		setXmlContent('')
		setParseError(null)
	}

	// Show preview if we have parsed skills
	if (parsedSkills) {
		return (
			<EvemonSkillPreview
				skills={parsedSkills}
				onConfirm={handleConfirmImport}
				onCancel={handleReset}
				isLoading={isLoading}
			/>
		)
	}

	// Show input form
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<FileText className="h-5 w-5" />
					Import EVEMon Skill Plan
				</CardTitle>
				<CardDescription>
					Paste your EVEMon XML skill plan below. The highest level for each skill will be imported as required.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<Textarea
						placeholder="Paste EVEMon XML content here..."
						value={xmlContent}
						onChange={(e) => {
							setXmlContent(e.target.value)
							setParseError(null)
						}}
						className="min-h-[300px] font-mono text-sm"
						disabled={isLoading}
					/>
					{parseError && (
						<div className="flex items-start gap-2 p-3 text-sm text-red-600 bg-red-50 rounded-md">
							<AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
							<span>{parseError}</span>
						</div>
					)}
				</div>

				<div className="flex items-center justify-between">
					<Button
						type="button"
						variant="outline"
						onClick={onCancel}
						disabled={isLoading}
					>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={handleParse}
						disabled={!xmlContent.trim() || isLoading}
					>
						<Upload className="h-4 w-4 mr-2" />
						Parse XML
					</Button>
				</div>

				<Card>
					<CardContent className="pt-4">
						<div className="text-sm text-muted-foreground">
							<strong>How to export from EVEMon:</strong>
							<ol className="mt-2 ml-4 space-y-1 list-decimal">
								<li>Open EVEMon and go to your skill plan</li>
								<li>Click File → Export Plan</li>
								<li>Choose "EVEMon Skill Plan (*.xml)"</li>
								<li>Open the saved file in a text editor</li>
								<li>Copy all content and paste it above</li>
							</ol>
						</div>
					</CardContent>
				</Card>
			</CardContent>
		</Card>
	)
}