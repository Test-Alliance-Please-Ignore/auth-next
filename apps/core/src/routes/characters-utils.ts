export function shouldTreatSensitiveDataAsLive(hasValidToken: boolean | null | undefined): boolean {
	return hasValidToken !== false
}
