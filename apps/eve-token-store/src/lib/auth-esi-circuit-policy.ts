export function shouldOpenRouteCircuitForResponse(status: number): boolean {
	return status === 429
}
