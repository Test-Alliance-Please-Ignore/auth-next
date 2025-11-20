/**
 * Public info section component
 * Displays EVE character public information
 */

import type { ProcessedPublicInfo } from '../../workflows/processors/helpers/public-info'

interface PublicInfoSectionProps {
	data: ProcessedPublicInfo
}

export function PublicInfoSection({ data }: PublicInfoSectionProps) {
	// Debug: Log what we received
	if (typeof window !== 'undefined') {
		console.log('[PublicInfoSection] Received data:', {
			corporationId: data.corporationId,
			corporationName: data.corporationName,
			allianceId: data.allianceId,
			allianceName: data.allianceName,
			hasCorporationName: !!data.corporationName,
			hasAllianceName: !!data.allianceName,
		})
	}

	return (
		<section>
			<h2>Public Information</h2>
			<div className="info-grid">
				<div className="info-item">
					<label>Character Name</label>
					<span>{data.characterName}</span>
				</div>
				<div className="info-item">
					<label>Birthday</label>
					<span>{new Date(data.birthday).toLocaleDateString()}</span>
				</div>
				<div className="info-item">
					<label>Corporation</label>
					<span>{data.corporationName || data.corporationId}</span>
				</div>
				{data.allianceId && (
					<div className="info-item">
						<label>Alliance</label>
						<span>{data.allianceName || data.allianceId}</span>
					</div>
				)}
				{data.factionId && (
					<div className="info-item">
						<label>Faction</label>
						<span>{data.factionName || data.factionId}</span>
					</div>
				)}
				{data.securityStatus !== undefined && (
					<div className="info-item">
						<label>Security Status</label>
						<span>{parseFloat(data.securityStatus).toFixed(2)}</span>
					</div>
				)}
				<div className="info-item">
					<label>Gender</label>
					<span style={{ textTransform: 'capitalize' }}>{data.gender}</span>
				</div>
				<div className="info-item">
					<label>Race</label>
					<span>{data.raceName || data.raceId}</span>
				</div>
				<div className="info-item">
					<label>Bloodline</label>
					<span>{data.bloodlineName || data.bloodlineId}</span>
				</div>
				{data.title && (
					<div className="info-item">
						<label>Title</label>
						<span>{data.title}</span>
					</div>
				)}
				{data.description && (
					<div className="info-item full-width">
						<label>Description</label>
						<div className="description">{data.description}</div>
					</div>
				)}
			</div>
			<div className="metadata">
				<p>
					<em>Data retrieved: {new Date(data.processedAt).toLocaleString()}</em>
				</p>
			</div>
		</section>
	)
}
