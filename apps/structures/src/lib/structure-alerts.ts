import type { AlertDestinationType, AlertRegistryEntry, AlertTypeDefinition } from './alert-routing'

export const STRUCTURE_ALERT_TYPES = [
	'structure_state_changed',
	'structure_fuel_time_status',
	'structure_fuel_amount_status',
] as const

export type StructureAlertType = (typeof STRUCTURE_ALERT_TYPES)[number]

export interface StructureAlertTypeDefinition extends AlertTypeDefinition<StructureAlertType> {
	type: StructureAlertType
}

export interface StructureAlertStateChangedPayload {
	structureId: string
	structureName: string
	corporationId: string
	corporationName: string
	previousState: string
	newState: string
	changedAt: string
}

export interface StructureAlertFuelTimeStatusPayload {
	structureId: string
	structureName: string
	corporationId: string
	corporationName: string
	remainingHours: number
	threshold: number
	status: 'warning' | 'critical' | 'empty'
}

export interface StructureAlertFuelAmountStatusPayload {
	structureId: string
	structureName: string
	corporationId: string
	corporationName: string
	remainingFuelUnits: number
	threshold: number
	status: 'warning' | 'critical' | 'empty'
}

export type StructureAlertPayloadByType = {
	structure_state_changed: StructureAlertStateChangedPayload
	structure_fuel_time_status: StructureAlertFuelTimeStatusPayload
	structure_fuel_amount_status: StructureAlertFuelAmountStatusPayload
}

const DEFAULT_STRUCTURAL_DESTINATIONS: AlertDestinationType[] = ['discord_channel', 'discord_user', 'group']

export const STRUCTURE_ALERT_TYPE_DEFINITIONS: StructureAlertTypeDefinition[] = [
	{
		type: 'structure_state_changed',
		label: 'Structure State Changed',
		description: 'Sent when a monitored structure changes state.',
		supportedDestinationTypes: DEFAULT_STRUCTURAL_DESTINATIONS,
	},
	{
		type: 'structure_fuel_time_status',
		label: 'Structure Fuel Status (Time)',
		description: 'Sent when a time-based structure crosses a fuel threshold.',
		supportedDestinationTypes: DEFAULT_STRUCTURAL_DESTINATIONS,
	},
	{
		type: 'structure_fuel_amount_status',
		label: 'Structure Fuel Status (Amount)',
		description: 'Sent when an amount-based structure crosses a fuel threshold.',
		supportedDestinationTypes: DEFAULT_STRUCTURAL_DESTINATIONS,
	},
]

const structureStateChangedAlert: AlertRegistryEntry<StructureAlertStateChangedPayload> = {
	definition: STRUCTURE_ALERT_TYPE_DEFINITIONS[0],
	buildMessage: (payload) => ({
		content: '',
		embeds: [
			{
				title: `Structure state changed: ${payload.structureName}`,
				description: `${payload.previousState} -> ${payload.newState}`,
				fields: [
					{ name: 'Corporation', value: payload.corporationName, inline: true },
					{ name: 'Changed At', value: payload.changedAt, inline: true },
				],
			},
		],
	}),
}

const structureFuelTimeStatusAlert: AlertRegistryEntry<StructureAlertFuelTimeStatusPayload> = {
	definition: STRUCTURE_ALERT_TYPE_DEFINITIONS[1],
	buildMessage: (payload) => ({
		content: '',
		embeds: [
			{
				title: `Structure fuel warning: ${payload.structureName}`,
				description: `Remaining time: ${payload.remainingHours}h (${payload.status})`,
			},
		],
	}),
}

const structureFuelAmountStatusAlert: AlertRegistryEntry<StructureAlertFuelAmountStatusPayload> = {
	definition: STRUCTURE_ALERT_TYPE_DEFINITIONS[2],
	buildMessage: (payload) => ({
		content: '',
		embeds: [
			{
				title: `Jump gate fuel warning: ${payload.structureName}`,
				description: `Remaining fuel units: ${payload.remainingFuelUnits} (${payload.status})`,
			},
		],
	}),
}

export const structureAlertRegistry = {
	structure_state_changed: structureStateChangedAlert,
	structure_fuel_time_status: structureFuelTimeStatusAlert,
	structure_fuel_amount_status: structureFuelAmountStatusAlert,
} satisfies {
	[K in StructureAlertType]: AlertRegistryEntry<StructureAlertPayloadByType[K]>
}
