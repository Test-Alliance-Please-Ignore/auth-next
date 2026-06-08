export const REFRESH_COOLDOWN_MS = 15 * 60_000
export const REFRESH_COOLDOWN_STORAGE_KEY = 'srp.losses.refresh.cooldown_until'

interface StorageLike {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
	removeItem(key: string): void
}

export function readRefreshCooldownUntilMs(storage: StorageLike | null | undefined): number {
	if (!storage) return 0
	const raw = storage.getItem(REFRESH_COOLDOWN_STORAGE_KEY)
	const parsed = Number(raw)
	return Number.isFinite(parsed) ? parsed : 0
}

export function persistRefreshCooldownUntilMs(
	storage: StorageLike | null | undefined,
	cooldownUntilMs: number,
	nowMs: number = Date.now()
): void {
	if (!storage) return
	if (cooldownUntilMs > nowMs) {
		storage.setItem(REFRESH_COOLDOWN_STORAGE_KEY, String(cooldownUntilMs))
		return
	}
	storage.removeItem(REFRESH_COOLDOWN_STORAGE_KEY)
}
