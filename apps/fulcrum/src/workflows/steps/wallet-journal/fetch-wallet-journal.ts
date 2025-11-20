import { getEsiInstanceForCharacter } from '@repo/esi'

import { storeOrReturn } from '../../utils/storage'

import type { Esi } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

export async function fetchWalletJournalFromEsi(esiStub: Esi, characterId: string) {
	return await esiStub.fetchCharacterWalletJournal(characterId)
}

export async function fetchWalletJournal(
	esiBinding: DurableObjectNamespace,
	bucket: R2Bucket,
	bucketName: string,
	characterId: string,
	workflowInstanceId: string
): Promise<StepResult> {
	try {
		const stub = getEsiInstanceForCharacter(esiBinding, characterId)
		const data = await fetchWalletJournalFromEsi(stub, characterId)
		return await storeOrReturn(bucket, bucketName, workflowInstanceId, 'fetch-wallet-journal', data)
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
