import { AlertCircle, FileText, FileUp, Upload } from 'lucide-react'
import { useRef, useState } from 'react'

import { useAppTranslation } from '@/i18n'

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
	const { t } = useAppTranslation()

	const [xmlContent, setXmlContent] = useState('')
	const [parseError, setParseError] = useState<string | null>(null)
	const [parsedSkills, setParsedSkills] = useState<ParsedEvemonSkill[] | null>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)

	const handleParse = () => {
		if (!xmlContent.trim()) {
			setParseError(t('skillPlans.pleasePasteEvemonXmlContentOrUploadAFile'))
			return
		}

		const result = parseEvemonXml(xmlContent)

		if (result.success && result.skills) {
			setParsedSkills(result.skills)
			setParseError(null)
		} else {
			setParseError(result.error || t('skillPlans.failedToParseXml'))
			setParsedSkills(null)
		}
	}

	const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (!file) return

		// Validate file type
		if (!file.name.endsWith('.xml')) {
			setParseError(t('skillPlans.pleaseSelectAnXmlFile'))
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
				setParseError(result.error || t('skillPlans.failedToParseXmlFile'))
				setParsedSkills(null)
			}
		} catch (error) {
			console.error('Error reading file:', error)
			setParseError(t('skillPlans.failedToReadFilePleaseTryAgain'))
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
					{t('skillPlans.importEvemonSkillPlan')}
				</CardTitle>
				<CardDescription>
					{t('skillPlans.uploadAnEvemonXmlFileOrPasteTheContentBelow')}
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
						{t('skillPlans.uploadXmlFile')}
					</Button>
				</div>

				{/* Divider */}
				<div className="relative">
					<div className="absolute inset-0 flex items-center">
						<span className="w-full border-t" />
					</div>
					<div className="relative flex justify-center text-xs uppercase">
						<span className="bg-background px-2 text-muted-foreground">
							{t('skillPlans.orPasteXmlContent')}
						</span>
					</div>
				</div>

				{/* Textarea for pasting */}
				<div className="space-y-2">
					<Textarea
						placeholder={t('skillPlans.pasteEvemonXmlContentHere')}
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
						{t('skillPlans.cancel')}
					</Button>
					<Button type="button" onClick={handleParse} disabled={!xmlContent.trim() || isLoading}>
						<Upload className="h-4 w-4" />
						{t('skillPlans.parseXml')}
					</Button>
				</div>

				<Card>
					<CardContent className="pt-4">
						<div className="text-sm text-muted-foreground">
							<strong>{t('skillPlans.howToExportFromEvemon')}</strong>
							<ol className="mt-2 ml-4 space-y-1 list-decimal">
								<li>{t('skillPlans.openEvemonAndGoToYourSkillPlan')}</li>
								<li>{t('skillPlans.clickFileExportPlan')}</li>
								<li>{t('skillPlans.chooseEvemonSkillPlanXml')}</li>
								<li>
									{t('skillPlans.either')}
									<ul className="ml-4 mt-1 space-y-1 list-disc">
										<li>{t('skillPlans.useTheUploadXmlFileButtonAboveToSelectThe')}</li>
										<li>{t('skillPlans.orOpenTheFileInATextEditorCopyAll')}</li>
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
