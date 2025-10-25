import _sodium from 'libsodium-wrappers-sumo';
import * as bigintConversion from 'bigint-conversion';

let _sodiumObject: typeof _sodium | null = null;

/**
 * Get the LibSodium object
 * @returns The LibSodium object
 */
export async function getSodium(): Promise<typeof _sodium> {
	if (!_sodiumObject) {
		await _sodium.ready;
		_sodiumObject = _sodium;
	}
	return _sodiumObject;
}

export async function generateRandomBytes(length: number): Promise<Uint8Array> {
	const sodium = await getSodium();
	return sodium.randombytes_buf(length);
}

export async function generateShardKey(maxShardCount: number): Promise<number> {
	const sodium = await getSodium();
	const randomBytes = await generateRandomBytes(sodium.crypto_generichash_BYTES);
	const hash = await sodium.crypto_generichash(sodium.crypto_generichash_BYTES, randomBytes);
	return Number(bigintConversion.bufToBigint(hash) % BigInt(maxShardCount));
}