import { describe, expect, it, vi } from 'vitest'

import { createR2MultipartTextWriter } from './r2-export'

function makeBucketMock() {
	const uploadedBodies: string[] = []
	const abort = vi.fn(async () => {})
	const uploadPart = vi.fn(async (partNumber: number, value: string | ArrayBuffer | ArrayBufferView | Blob | ReadableStream) => {
		const body = typeof value === 'string' ? value : await new Response(value).text()
		uploadedBodies[partNumber - 1] = body
		return { partNumber, etag: `etag-${partNumber}` }
	})
	const complete = vi.fn(async (uploadedParts: Array<{ partNumber: number; etag: string }>) => ({
		key: 'exports/test.csv',
		version: '1',
		size: uploadedBodies.join('').length,
		etag: 'etag',
		httpEtag: '"etag"',
		checksums: {},
		uploaded: new Date('2026-07-01T00:00:00.000Z'),
		httpMetadata: { contentType: 'text/csv; charset=utf-8' },
		customMetadata: { fileName: 'test.csv' },
		storageClass: 'Standard',
		writeHttpMetadata: vi.fn(),
		uploadedParts,
	} as any))

	return {
		uploadedBodies,
		abort,
		createMultipartUpload: vi.fn(async (key: string, options?: { httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> }) => ({
			key,
			uploadId: 'upload-1',
			uploadPart,
			abort,
			complete,
			options,
		})),
		uploadPart,
		complete,
	}
}

describe('createR2MultipartTextWriter', () => {
	it('uploads chunked text as multipart parts', async () => {
		const bucket = makeBucketMock()

		const writer = await createR2MultipartTextWriter(bucket as any, 'exports/test.csv', {
			httpMetadata: { contentType: 'text/csv; charset=utf-8' },
			customMetadata: { fileName: 'test.csv' },
			partSizeBytes: 4,
		})

		await writer.writeLine('abc')
		await writer.writeLine('de')
		const result = await writer.close()

		expect(bucket.createMultipartUpload).toHaveBeenCalledWith(
			'exports/test.csv',
			expect.objectContaining({
				httpMetadata: { contentType: 'text/csv; charset=utf-8' },
				customMetadata: { fileName: 'test.csv' },
			})
		)
		expect(bucket.uploadPart).toHaveBeenCalledTimes(2)
		expect(bucket.complete).toHaveBeenCalledTimes(1)
		expect(result.key).toBe('exports/test.csv')
		expect(bucket.uploadedBodies).toEqual(['abc\n', 'de\n'])
	})

	it('aborts the multipart upload if completion fails', async () => {
		const bucket = makeBucketMock()
		bucket.complete.mockRejectedValueOnce(new Error('complete failed'))

		const writer = await createR2MultipartTextWriter(bucket as any, 'exports/test.csv', {
			httpMetadata: { contentType: 'text/csv; charset=utf-8' },
			customMetadata: { fileName: 'test.csv' },
			partSizeBytes: 4,
		})

		await writer.writeLine('abc')
		await expect(writer.close()).rejects.toThrow('complete failed')
		expect(bucket.abort).toHaveBeenCalledTimes(1)
	})
})
