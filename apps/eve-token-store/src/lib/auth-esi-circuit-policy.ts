export interface AuthEsiCircuitPolicyInput {
	status: number
	errorLimitRemain?: number
	errorLimitResetSeconds?: number
}

export function shouldOpenRouteCircuitForResponse(status: number): boolean {
	return status === 429
}

export function shouldOpenGlobalEmergencyCircuit(input: AuthEsiCircuitPolicyInput): boolean {
	if (input.status === 420) {
		return true
	}
	if (input.status !== 429) {
		return false
	}
	return input.errorLimitRemain !== undefined || input.errorLimitResetSeconds !== undefined
}
