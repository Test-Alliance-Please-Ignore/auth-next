import { applicant } from './applicant-workflows'
import { broadcast, broadcastManagePermission, broadcastTemplate } from './broadcasts'

import type { BroadcastTemplate, BroadcastWithDetails, UserPermission } from '@/lib/api'

export const composerTemplate: BroadcastTemplate = {
	...broadcastTemplate,
	fieldSchema: [
		{ name: 'doctrine', label: 'Original Doctrine', type: 'system_doctrine', required: true },
		{ name: 'staging', label: 'Original Staging', type: 'system_staging', required: true },
		{
			name: 'fleetCommander',
			label: 'Original Commander',
			type: 'system_fleet_commander',
			required: true,
		},
		{ name: 'srp', label: 'Original SRP', type: 'system_srp', required: true },
		{ name: 'fleetName', label: 'Original Fleet', type: 'system_fleet_name', required: true },
		{
			name: 'select:Role',
			label: 'Original Role',
			type: 'select',
			options: ['Original Option', 'Original Other'],
		},
		{ name: 'notes', label: 'Original Notes', type: 'textarea' },
		{ name: '__fleetTrackingEnabled', label: 'Original Tracking', type: 'system_fleet_tracking' },
		{ name: '__frogsirenEnabled', label: 'Original Frogsiren', type: 'system_frogsiren' },
	],
	messageTemplate:
		'{{<doctrine>}} | {{<staging>}} | {{<fleetCommander>}} | {{<fleetName>}} | {{<select:Role:Original Option|Original Other>}}\n{{notes}}\n{{<srp>}}',
}
export const composerFields: Record<string, string> = {
	doctrine: 'Read MOTD',
	staging: 'Original System',
	fleetCommander: applicant.characters[0]!.characterName,
	fleetName: 'Original fleet — 원문',
	'select:Role': 'Original Other',
	notes: 'Original notes <t:1893456000:F>',
	srp: 'military',
	__srpToken: 'ORIGINAL-TOKEN',
	__doctrineId: '',
	__fleetTrackingCharacterId: applicant.characters[0]!.characterId,
	__fleetTrackingCharacterName: applicant.characters[0]!.characterName,
	__fleetTrackingEnabled: 'true',
	__frogsirenEnabled: 'false',
}
export const composerDraft: BroadcastWithDetails = {
	...broadcast,
	id: 'draft-original',
	status: 'draft',
	template: composerTemplate,
	content: {
		...composerFields,
		__prefixText: 'Original before',
		__defaultText: 'Original after',
		mentionLevel: 'none',
	},
}
export const trackingPermission: UserPermission = {
	...broadcastManagePermission,
	permissionId: 'permission-tracking',
	urn: 'urn:fleet-tracking:create',
}
