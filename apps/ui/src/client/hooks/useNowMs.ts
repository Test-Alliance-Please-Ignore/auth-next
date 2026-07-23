import { useSyncExternalStore } from 'react'

type Listener = () => void

let currentNowMs = Date.now()
const listeners = new Set<Listener>()
let tickTimeoutId: number | null = null
let visibilityChangeAttached = false

function emitNowMs(): void {
	currentNowMs = Date.now()
	for (const listener of listeners) {
		listener()
	}
}

function scheduleTick(): void {
	if (typeof window === 'undefined' || listeners.size === 0) {
		return
	}

	if (tickTimeoutId !== null) {
		window.clearTimeout(tickTimeoutId)
		tickTimeoutId = null
	}

	const now = Date.now()
	const isHidden = document.visibilityState === 'hidden'
	const delayMs = isHidden ? 60_000 : Math.max(250, 1000 - (now % 1000))

	tickTimeoutId = window.setTimeout(() => {
		tickTimeoutId = null
		if (listeners.size === 0) {
			return
		}
		emitNowMs()
		scheduleTick()
	}, delayMs)
}

function handleVisibilityChange(): void {
	if (listeners.size === 0) {
		return
	}

	emitNowMs()
	scheduleTick()
}

function startClock(): void {
	if (typeof window === 'undefined' || visibilityChangeAttached) {
		return
	}

	document.addEventListener('visibilitychange', handleVisibilityChange)
	visibilityChangeAttached = true
	scheduleTick()
}

function stopClock(): void {
	if (typeof window !== 'undefined' && tickTimeoutId !== null) {
		window.clearTimeout(tickTimeoutId)
		tickTimeoutId = null
	}

	if (!visibilityChangeAttached || typeof window === 'undefined') {
		return
	}

	document.removeEventListener('visibilitychange', handleVisibilityChange)
	visibilityChangeAttached = false
}

function subscribe(listener: Listener): () => void {
	listeners.add(listener)
	currentNowMs = Date.now()

	if (listeners.size === 1) {
		startClock()
	}

	return () => {
		listeners.delete(listener)

		if (listeners.size === 0) {
			stopClock()
		}
	}
}

function getSnapshot(): number {
	return currentNowMs
}

function getServerSnapshot(): number {
	return currentNowMs
}

export function useNowMs(): number {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
