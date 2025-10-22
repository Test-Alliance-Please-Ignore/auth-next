import type { z } from 'zod'

/**
 * Cloudflare Queue types
 * These types match the Cloudflare Workers Queue API
 */

export interface Message<Body = unknown> {
	readonly id: string
	readonly timestamp: Date
	readonly body: Body
	ack(): void
	retry(options?: MessageRetryOptions): void
}

export interface MessageRetryOptions {
	delaySeconds?: number
}

export interface MessageBatch<Body = unknown> {
	readonly queue: string
	readonly messages: ReadonlyArray<Message<Body>>
	ackAll(): void
	retryAll(options?: MessageRetryOptions): void
}

/**
 * Queue handler function type
 * This is the signature for the queue() export in a worker
 */
export type QueueHandler<Body = unknown> = (
	batch: MessageBatch<Body>,
	env: unknown,
	ctx: ExecutionContext
) => Promise<void> | void

/**
 * Message handler function type
 * This is the function that processes individual messages
 */
export type MessageHandler<T> = (
	message: T,
	metadata: MessageMetadata
) => Promise<void> | void

/**
 * Message metadata provided to handlers
 */
export interface MessageMetadata {
	/** Original message from the batch */
	readonly originalMessage: Message<unknown>
	/** The batch this message belongs to */
	readonly batch: MessageBatch<unknown>
	/** Attempt number (starts at 1) */
	readonly attempt: number
	/** Environment bindings */
	readonly env: unknown
	/** Execution context */
	readonly ctx: ExecutionContext
}

/**
 * Error handler function type
 */
export type ErrorHandler<T = unknown> = (
	error: Error,
	message: T | undefined,
	metadata: MessageMetadata
) => Promise<ErrorHandlingDecision> | ErrorHandlingDecision

/**
 * Decision made by error handler
 */
export type ErrorHandlingDecision = 'retry' | 'ack' | 'fatal'

/**
 * Retry strategy configuration
 */
export interface RetryStrategy {
	/** Maximum number of retry attempts */
	maxAttempts: number
	/** Delay calculation function */
	getDelay: (attempt: number) => number
	/** Whether to retry this error */
	shouldRetry?: (error: Error) => boolean
}

/**
 * Batch processing options
 */
export interface BatchOptions {
	/** Maximum number of messages to process concurrently */
	concurrency?: number
	/** Whether to stop processing on first error */
	stopOnError?: boolean
}

/**
 * Lifecycle hooks for queue consumers
 */
export interface LifecycleHooks {
	/** Called before batch processing starts */
	onBatchStart?: (batch: MessageBatch<unknown>) => Promise<void> | void
	/** Called after batch processing completes */
	onBatchComplete?: (
		batch: MessageBatch<unknown>,
		results: BatchProcessingResult
	) => Promise<void> | void
	/** Called when a message is processed successfully */
	onMessageSuccess?: (message: unknown, metadata: MessageMetadata) => Promise<void> | void
	/** Called when a message processing fails */
	onMessageError?: (
		error: Error,
		message: unknown | undefined,
		metadata: MessageMetadata
	) => Promise<void> | void
}

/**
 * Results from batch processing
 */
export interface BatchProcessingResult {
	/** Total messages processed */
	total: number
	/** Successfully processed messages */
	successful: number
	/** Failed messages */
	failed: number
	/** Retried messages */
	retried: number
	/** Errors encountered */
	errors: Array<{ error: Error; messageId: string }>
}

/**
 * Configuration for queue consumer
 */
export interface QueueConsumerConfig<T extends z.ZodType> {
	/** Zod schema for message validation */
	schema: T
	/** Retry strategy */
	retryStrategy?: RetryStrategy
	/** Batch processing options */
	batchOptions?: BatchOptions
	/** Custom error handler */
	errorHandler?: ErrorHandler<z.infer<T>>
	/** Lifecycle hooks */
	hooks?: LifecycleHooks
	/** Enable debug logging */
	debug?: boolean
}

/**
 * Configuration for queue producer
 */
export interface QueueProducerConfig<T extends z.ZodType> {
	/** Zod schema for message validation */
	schema: T
	/** Enable debug logging */
	debug?: boolean
}

/**
 * Options for sending a message
 */
export interface SendMessageOptions {
	/** Optional delay in seconds before the message is delivered */
	delaySeconds?: number
	/** Optional content type */
	contentType?: string
}

/**
 * Options for sending a batch of messages
 */
export interface SendBatchOptions {
	/** Optional delay in seconds before messages are delivered */
	delaySeconds?: number
}
