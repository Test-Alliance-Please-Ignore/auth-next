import { getIdClassification } from '@repo/eve-types'

export function isNpcCharacterContact(contact: {
	contact_id: string | number
	contact_type?: string | null
}): boolean {
	return (
		contact.contact_type === 'character' &&
		getIdClassification(contact.contact_id).type === 'npc_character'
	)
}
