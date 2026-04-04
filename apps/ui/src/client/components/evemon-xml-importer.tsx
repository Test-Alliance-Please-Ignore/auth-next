import { AlertCircle, FileText, FileUp, Upload } from 'lucide-react'
import { useRef, useState } from 'react'

import { parseEvemonXml } from '../lib/evemon-parser'
import { EvemonSkillPreview } from './evemon-skill-preview'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Textarea } from './ui/textarea'

import type { ParsedEvemonSkill } from '../lib/evemon-parser'

interface EvemonXmlImporterProps {
	onImport: (skills: ParsedEvemonSkill[]) => void
	onCancel: () => void
	isLoading?: boolean
}

export function EvemonXmlImporter({
	onImport,
	onCancel,
	isLoading = false,
}: EvemonXmlImporterProps) {
	const [xmlContent, setXmlContent] = useState('')
	const [parseError, setParseError] = useState<string | null>(null)
	const [parsedSkills, setParsedSkills] = useState<ParsedEvemonSkill[] | null>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)

	const handleParse = () => {
		if (!xmlContent.trim()) {
			setParseError('Please paste EVEMon XML content or upload a file')
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

	const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (!file) return

		// Validate file type
		if (!file.name.endsWith('.xml')) {
			setParseError('Please select an XML file')
			return
		}

		try {
			const content = await file.text()
			const result = parseEvemonXml(content)

			if (result.success && result.skills) {
				setParsedSkills(result.skills)
				setParseError(null)
				setXmlContent(content) // Save content for potential debugging
			} else {
				setParseError(result.error || 'Failed to parse XML file')
				setParsedSkills(null)
			}
		} catch (error) {
			console.error('Error reading file:', error)
			setParseError('Failed to read file. Please try again.')
		}

		// Reset file input so the same file can be selected again
		if (fileInputRef.current) {
			fileInputRef.current.value = ''
		}
	}

	const handleUploadButtonClick = () => {
		fileInputRef.current?.click()
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
					Upload an EVEMon XML file or paste the content below. Priority 1-9 skills will be imported
					as required, priority 10 as optional (recommended only).
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Hidden file input */}
				<input
					ref={fileInputRef}
					type="file"
					accept=".xml"
					onChange={handleFileUpload}
					className="hidden"
					disabled={isLoading}
				/>

				{/* File upload button */}
				<div className="flex items-center justify-center p-6 border-2 border-dashed rounded-lg hover:border-primary/50 transition-colors">
					<Button
						type="button"
						variant="ghost"
						onClick={handleUploadButtonClick}
						disabled={isLoading}
						className="gap-2"
					>
						<FileUp className="h-4 w-4" />
						Upload XML File
					</Button>
				</div>

				{/* Divider */}
				<div className="relative">
					<div className="absolute inset-0 flex items-center">
						<span className="w-full border-t" />
					</div>
					<div className="relative flex justify-center text-xs uppercase">
						<span className="bg-background px-2 text-muted-foreground">Or paste XML content</span>
					</div>
				</div>

				{/* Textarea for pasting */}
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
					<Button type="button" variant="ghost" onClick={onCancel} disabled={isLoading}>
						Cancel
					</Button>
					<Button type="button" onClick={handleParse} disabled={!xmlContent.trim() || isLoading}>
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
								<li>
									Either:
									<ul className="ml-4 mt-1 space-y-1 list-disc">
										<li>Use the "Upload XML File" button above to select the saved file</li>
										<li>Or open the file in a text editor, copy all content, and paste it above</li>
									</ul>
								</li>
							</ol>
						</div>
					</CardContent>
				</Card>
			</CardContent>
		</Card>
	)
}
