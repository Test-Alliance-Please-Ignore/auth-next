/**
 * @repo/queue-utils
 *
 * Type-safe utilities for Cloudflare Workers Queues with Zod validation
 *
 * ## Features
 *
 * - **Type-Safe Message Handling**: Full TypeScript type safety with Zod v4 schemas
 * - **Multiple Consumer Patterns**: Both class-based and functional approaches
 * - **Built-in Error Handling**: Automatic retry logic with configurable strategies
 * - **Batch Processing**: Concurrent message processing with configurable limits
 * - **Producer Utilities**: Type-safe message sending with validation
 * - **Lifecycle Hooks**: Hooks for batch start/complete and message success/error
 *
 * ## Quick Start
 *
 * ### Consumer Pattern (Functional)
 *
 * ```typescript
 * import { createQueueConsumer } from '@repo/queue-utils'
 * import { z } from 'zod'
 *
 * const messageSchema = z.object({
 *   characterId: z.string(),
 *   type: z.enum(['update', 'delete'])
 * })
 *
 * export default {
 *   queue: createQueueConsumer(
 *     messageSchema,
 *     async (message, metadata) => {
 *       console.log(`Processing ${message.type} for character ${message.characterId}`)
 *     }
 *   )
 * }
 * ```
 *
 * ### Consumer Pattern (Class-Based)
 *
 * ```typescript
 * import { QueueConsumer } from '@repo/queue-utils'
 * import { z } from 'zod'
 *
 * const messageSchema = z.object({
 *   characterId: z.string(),
 *   type: z.enum(['update', 'delete'])
 * })
 *
 * class CharacterUpdateConsumer extends QueueConsumer {
 *   constructor() {
 *     super({ schema: messageSchema })
 *   }
 *
 *   async handleMessage(message, metadata) {
 *     console.log(`Processing ${message.type} for character ${message.characterId}`)
 *   }
 * }
 *
 * export default {
 *   queue: new CharacterUpdateConsumer().toHandler()
 * }
 * ```
 *
 * ### Producer Pattern
 *
 * ```typescript
 * import { createQueueProducer } from '@repo/queue-utils'
 * import { messageSchema } from './schemas'
 *
 * const producer = createQueueProducer(env.CHARACTER_UPDATE_QUEUE, messageSchema)
 *
 * // Send single message
 * await producer.send({ characterId: 123, type: 'update' })
 *
 * // Send batch
 * await producer.sendBatch([
 *   { characterId: 123, type: 'update' },
 *   { characterId: 456, type: 'delete' }
 * ])
 * ```
 */

// Consumer exports
export { QueueConsumer } from './consumer'
export { createQueueConsumer } from './factory'

// Producer exports
export { QueueProducer, createQueueProducer } from './producer'
export type { Queue } from './producer'

// Error exports
export {
	QueueError,
	MessageValidationError,
	RetryableError,
	FatalError,
	isRetryable,
	isFatal,
	classifyError,
	getRetryDelay as getErrorRetryDelay,
	createRetryableError,
	createFatalError,
	wrapError,
} from './errors'

// Retry strategy exports
export {
	defaultRetryStrategy,
	exponentialBackoff,
	fixedDelay,
	linearBackoff,
	noRetry,
	shouldRetry,
	getRetryDelay,
	calculateMaxRetryTime,
} from './retry'

// Batch utilities exports
export {
	defaultBatchOptions,
	processConcurrently,
	processSequentially,
	processBatch,
	chunk,
} from './batch'

// Type exports
export type {
	Message,
	MessageRetryOptions,
	MessageBatch,
	QueueHandler,
	MessageHandler,
	MessageMetadata,
	ErrorHandler,
	ErrorHandlingDecision,
	RetryStrategy,
	BatchOptions,
	LifecycleHooks,
	BatchProcessingResult,
	QueueConsumerConfig,
	QueueProducerConfig,
	SendMessageOptions,
	SendBatchOptions,
} from './types'
