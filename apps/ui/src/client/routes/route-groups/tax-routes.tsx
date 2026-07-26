import { lazy, Suspense } from 'react'
import { Navigate, Route } from 'react-router'

import { LoadingPage } from '@/components/ui/loading'

const TaxAlertsPage = lazy(() => import('../tax-alerts'))
const TaxAuditLogPage = lazy(() => import('../tax-audit-log'))
const TaxBillsPage = lazy(() => import('../tax-bills'))
const TaxLedgerPage = lazy(() => import('../tax-ledger'))
const TaxMemberSummaryPage = lazy(() => import('../tax-member-summary'))
const TaxExclusionsPage = lazy(() => import('../tax-exclusions'))
const TaxReportsPage = lazy(() => import('../tax-reports'))
const TaxRulesPage = lazy(() => import('../tax-rules'))

export const taxRouteElements = (
	<>
		<Route path="/tax" element={<Navigate to="/tax/member-summary" replace />} />
		<Route
			path="/tax/alerts"
			element={
				<Suspense fallback={<LoadingPage />}>
					<TaxAlertsPage />
				</Suspense>
			}
		/>
		<Route
			path="/tax/member-summary"
			element={
				<Suspense fallback={<LoadingPage />}>
					<TaxMemberSummaryPage />
				</Suspense>
			}
		/>
		<Route
			path="/tax/rules"
			element={
				<Suspense fallback={<LoadingPage />}>
					<TaxRulesPage />
				</Suspense>
			}
		/>
		<Route
			path="/tax/audit-log"
			element={
				<Suspense fallback={<LoadingPage />}>
					<TaxAuditLogPage />
				</Suspense>
			}
		/>
		<Route
			path="/tax/bills"
			element={
				<Suspense fallback={<LoadingPage />}>
					<TaxBillsPage />
				</Suspense>
			}
		/>
		<Route
			path="/tax/ledger"
			element={
				<Suspense fallback={<LoadingPage />}>
					<TaxLedgerPage />
				</Suspense>
			}
		/>
		<Route
			path="/tax/exclusions"
			element={
				<Suspense fallback={<LoadingPage />}>
					<TaxExclusionsPage />
				</Suspense>
			}
		/>
		<Route
			path="/tax/reports"
			element={
				<Suspense fallback={<LoadingPage />}>
					<TaxReportsPage />
				</Suspense>
			}
		/>
	</>
)
