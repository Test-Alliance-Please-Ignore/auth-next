import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { LoadingSpinner } from '@/components/ui/loading'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'

/**
 * Landing Page - Redirects to login or dashboard
 *
 * If user is already authenticated, redirect to dashboard.
 * Otherwise, redirect to the server-side login page.
 */
export default function LandingPage() {
	usePageTitle('Home')
	const { isAuthenticated, isLoading } = useAuth()
	const navigate = useNavigate()

	useEffect(() => {
		if (!isLoading) {
			if (isAuthenticated) {
				// Redirect authenticated users to dashboard
				navigate('/dashboard')
			} else {
				// Redirect to server-side login page with full page navigation
				window.location.href = '/login'
			}
		}
	}, [isAuthenticated, isLoading, navigate])

	return (
		<div className="min-h-screen flex items-center justify-center">
			<LoadingSpinner label="Redirecting..." />
		</div>
	)
}
