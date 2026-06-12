import type { MessageContent } from '@repo/discord'
import type { AlertDestinationType } from '@repo/alert-destinations'

export {
	ALERT_DESTINATION_TYPES,
	ALERT_SCOPE_TYPES,
	type AlertDestinationRecord,
	type AlertDestinationType,
	type AlertScopeType,
} from '@repo/alert-destinations'

export interface AlertTypeDefinition<TType extends string = string> {
	type: TType
	label: string
	description: string
	supportedDestinationTypes: AlertDestinationType[]
}

export interface AlertRegistryEntry<TPayload> {
	definition: AlertTypeDefinition
	buildMessage: (payload: TPayload) => MessageContent
}
