import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import type {
	ServiceEligibilityReasonCode,
	ServicesAuditRunDetail,
	ServicesAuditRunStatus,
	ServicesAuditRunSummary,
} from '@/lib/api'

/**
 * SERVICE ACCESS AUDIT — READ-ONLY hooks.
 *
 * There is deliberately no enforce mutation here. Enforcement is not built, and
 * the whole point of shipping the scan alone is to learn the real ineligible
 * count before anyone commits to acting on it.
 */

/**
 * Statuses at which a run is finished and will never change again. Polling MUST
 * stop here — a blocked run that keeps polling forever is exactly the failure
 * this page exists to catch, and nobody notices because the page looks busy
 * rather than broken.
 */
const TERMINAL_STATUSES: readonly ServicesAuditRunStatus[] = [
	'blocked',
	'awaiting_confirmation',
	'completed',
	'completed_with_errors',
	'failed',
	'cancelled',
]

export function isTerminalRunStatus(status: ServicesAuditRunStatus | undefined): boolean {
	return status !== undefined && TERMINAL_STATUSES.includes(status)
}

const POLL_INTERVAL_MS = 5_000

export interface ServicesAuditRowFilters {
	reason?: ServiceEligibilityReasonCode
	eligible?: boolean
	page?: number
	pageSize?: number
}

export const servicesAuditKeys = {
	all: ['admin', 'services-audit'] as const,
	runs: () => [...servicesAuditKeys.all, 'runs'] as const,
	run: (runId: string) => [...servicesAuditKeys.runs(), runId] as const,
	rows: (runId: string, filters?: ServicesAuditRowFilters) =>
		[...servicesAuditKeys.run(runId), 'rows', filters] as const,
}

/**
 * The run list. Polls while ANY run is live so a scan started in another tab (or
 * by another admin) shows up without a manual reload.
 */
export function useServicesAuditRuns() {
	return useQuery({
		queryKey: servicesAuditKeys.runs(),
		queryFn: () => api.getServicesAuditRuns(),
		staleTime: 1000 * 5,
		refetchInterval: (query) => {
			const items: ServicesAuditRunSummary[] | undefined = query.state.data?.items
			if (!items) return false
			return items.some((run) => !isTerminalRunStatus(run.status)) ? POLL_INTERVAL_MS : false
		},
	})
}

/**
 * A single run. Polls every 5s ONLY while the scan is live and self-terminates on
 * any terminal status.
 *
 * Returns `false` when the status is unknown (first load, or an error): an
 * unknown status must never mean "keep polling forever".
 */
export function useServicesAuditRun(runId: string) {
	return useQuery<ServicesAuditRunDetail>({
		queryKey: servicesAuditKeys.run(runId),
		queryFn: () => api.getServicesAuditRun(runId),
		enabled: !!runId,
		staleTime: 1000 * 5,
		refetchInterval: (query) => {
			const status = query.state.data?.status
			if (!status) return false
			return isTerminalRunStatus(status) ? false : POLL_INTERVAL_MS
		},
	})
}

/**
 * Paginated rows for a run. Filtering and pagination happen server-side, in SQL —
 * the rows list can be tens of thousands long and must never be sliced here.
 */
export function useServicesAuditRunRows(runId: string, filters: ServicesAuditRowFilters = {}) {
	return useQuery({
		queryKey: servicesAuditKeys.rows(runId, filters),
		queryFn: () => api.getServicesAuditRunRows(runId, filters),
		enabled: !!runId,
		staleTime: 1000 * 5,
	})
}

export function useStartServicesAuditScan() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: () => api.startServicesAuditScan(),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: servicesAuditKeys.runs(),
				refetchType: 'active',
			})
		},
	})
}

/**
 * Cancels a live SCAN. Safe precisely because the scan is read-only — there is
 * nothing half-done to unwind.
 *
 * NOTE (matches the server's documented limitation): this releases the lock and
 * marks the run cancelled, but does not terminate the workflow instance, whose
 * finalize step may still overwrite the status. Harmless while the scan only
 * reads.
 */
export function useAcknowledgeServicesAuditBasis() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ runId, reason }: { runId: string; reason: string }) =>
			api.acknowledgeServicesAuditBasis(runId, reason),
		onSuccess: (_data, { runId }) => {
			// Both: acking changes the baseline every FUTURE run is judged against, so
			// the list's suspect markers can change too, not just this run.
			void queryClient.invalidateQueries({ queryKey: servicesAuditKeys.runs() })
			void queryClient.invalidateQueries({ queryKey: servicesAuditKeys.run(runId) })
		},
	})
}

export function useCancelServicesAuditScan() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (runId: string) => api.cancelServicesAuditScan(runId),
		onSuccess: (_data, runId) => {
			void queryClient.invalidateQueries({ queryKey: servicesAuditKeys.runs() })
			void queryClient.invalidateQueries({ queryKey: servicesAuditKeys.run(runId) })
		},
	})
}
