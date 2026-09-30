import { DurableObject } from 'cloudflare:workers'

export class MockCore extends DurableObject {
	async getUserCorporations(): Promise<Array<{ corporationId: string; corporationName: string }>> {
		return []
	}

	async getUserAlliances(): Promise<Array<{ allianceId: string; allianceName: string }>> {
		return []
	}

	async getUserCorporationsBatch(
		userIds: string[]
	): Promise<Map<string, Array<{ corporationId: string; corporationName: string }>>> {
		return new Map(userIds.map((userId) => [userId, []]))
	}
}

export class MockEveCharacterData extends DurableObject {
	async getCharacterInfo(): Promise<null> {
		return null
	}
}
