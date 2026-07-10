const DEFAULT_R2_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024

export interface R2MultipartTextWriterOptions {
	httpMetadata?: R2HTTPMetadata
	customMetadata?: Record<string, string>
	partSizeBytes?: number
}

export interface R2MultipartTextWriter {
	readonly key: string
	readonly uploadId: string
	write(text: string): Promise<void>
	writeLine(text: string): Promise<void>
	close(): Promise<R2Object>
	abort(): Promise<void>
}

export async function createR2MultipartTextWriter(
	bucket: R2Bucket,
	key: string,
	options: R2MultipartTextWriterOptions = {},
): Promise<R2MultipartTextWriter> {
	const multipart = await bucket.createMultipartUpload(key, {
		httpMetadata: options.httpMetadata,
		customMetadata: options.customMetadata,
	})

	const partSizeBytes = options.partSizeBytes ?? DEFAULT_R2_MULTIPART_PART_SIZE_BYTES
	const encoder = new TextEncoder()
	const chunks: string[] = []
	const uploadedParts: R2UploadedPart[] = []
	let bufferedBytes = 0
	let nextPartNumber = 1
	let finalized = false

	const flush = async (): Promise<void> => {
		if (bufferedBytes === 0) return
		const body = chunks.join('')
		chunks.length = 0
		bufferedBytes = 0
		uploadedParts.push(await multipart.uploadPart(nextPartNumber++, body))
	}

	const append = async (text: string): Promise<void> => {
		if (finalized) {
			throw new Error('Cannot write to a closed R2 multipart text writer')
		}
		if (text.length === 0) return
		chunks.push(text)
		bufferedBytes += encoder.encode(text).byteLength
		if (bufferedBytes >= partSizeBytes) {
			await flush()
		}
	}

	return {
		key: multipart.key,
		uploadId: multipart.uploadId,
		async write(text: string): Promise<void> {
			await append(text)
		},
		async writeLine(text: string): Promise<void> {
			await append(`${text}\n`)
		},
		async close(): Promise<R2Object> {
			if (finalized) {
				throw new Error('Cannot close an R2 multipart text writer more than once')
			}
			await flush()
			try {
				const object = await multipart.complete(uploadedParts)
				finalized = true
				return object
			} catch (error) {
				await multipart.abort().catch(() => {})
				finalized = true
				throw error
			}
		},
		async abort(): Promise<void> {
			if (finalized) return
			finalized = true
			chunks.length = 0
			bufferedBytes = 0
			await multipart.abort()
		},
	}
}
