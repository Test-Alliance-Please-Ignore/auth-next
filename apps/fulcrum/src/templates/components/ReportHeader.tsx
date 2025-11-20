/**
 * Header component for character reports
 * Displays character name and report generation timestamp
 */

interface ReportHeaderProps {
	characterName?: string
	characterId?: string
	generatedAt: string
}

export function ReportHeader({ characterName, characterId, generatedAt }: ReportHeaderProps) {
	return (
		<>
			<h1>EVE Online Character Report</h1>
			<div className="header-info">
				{characterName && characterId && (
					<p>
						<strong>Character:</strong> {characterName} ({characterId})
					</p>
				)}
				<p>
					<strong>Report Generated:</strong> {new Date(generatedAt).toLocaleString()}
				</p>
			</div>
		</>
	)
}
