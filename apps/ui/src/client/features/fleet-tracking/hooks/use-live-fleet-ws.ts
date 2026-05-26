/**
 * Live fleet WebSocket subscription stub.
 *
 * The FleetMonitor DO exposes a WebSocket at /fleet-monitor/:fleetId/ws on the
 * fleets worker, but that worker doesn't share the core worker's auth model.
 * Until the WebSocket gets its own auth wrapper, the UI uses polling (see
 * useSessionLiveSnapshot in ../hooks.ts) for live updates.
 *
 * This file is kept so the import surface is stable when we add the real WS
 * subscription later.
 */
export function useLiveFleetWebSocket(_sessionId: string | undefined): {
	connected: boolean
} {
	return { connected: false }
}
