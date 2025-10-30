/**
 * My Corporations Feature Routes
 *
 * Lazy-loaded route definitions for the My Corporations feature.
 */

import { lazy } from 'react'
import { Route } from 'react-router-dom'

// Lazy load the route components for code splitting
const MyCorporationsList = lazy(() => import('./routes/my-corporations-list'))
const CorporationMembers = lazy(() => import('./routes/corporation-members'))

/**
 * My Corporations route definitions
 *
 * These routes should be wrapped in a Suspense boundary when imported
 * in the main App component.
 */
export const myCorporationsRoutes = (
	<>
		<Route path="/my-corporations" element={<MyCorporationsList />} />
		<Route path="/my-corporations/:corporationId/members" element={<CorporationMembers />} />
	</>
)