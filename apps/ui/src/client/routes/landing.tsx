import { useState, useMemo } from 'react'

import { EveSSOButton } from '@/components/eve-sso-button'
import { apiClient } from '@/lib/api'

export default function LandingPage() {
	const [isLoading, setIsLoading] = useState(false)

	const handleLogin = async () => {
		setIsLoading(true)
		try {
			// Call the auth/login/start endpoint
			const response = await apiClient.post<{ authorizationUrl: string; state: string }>(
				'/auth/login/start'
			)

			// Redirect to EVE SSO
			window.location.href = response.authorizationUrl
		} catch (error) {
			console.error('Failed to start login flow:', error)
			setIsLoading(false)
			// TODO: Show error toast
		}
	}

	return (
		<div className="relative min-h-screen flex items-center justify-center overflow-hidden">
			{/* Starfield Background */}
			<Starfield />

			{/* Solid background with gradient vignette effect - stars only show through center */}
			<div className="absolute inset-0 bg-background z-0 pointer-events-none" />
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,transparent_30%,hsl(220_18%_8%)_100%)] z-0 pointer-events-none" />

			{/* Content */}
			<div className="relative z-10 max-w-4xl mx-auto px-4 text-center">
				{/* Logo/Title with enhanced gradient */}
				<h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold mb-6 gradient-text drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]">
					Test Auth
					<br />
					Next Generation
				</h1>

				{/* Subtitle with subtle glow */}
				<p className="text-xl md:text-2xl text-muted-foreground mb-12 max-w-2xl mx-auto drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
					Advanced authentication and character management platform for EVE Online
				</p>

				{/* Login Button */}
				<div className="flex justify-center">
					<EveSSOButton onClick={handleLogin} loading={isLoading} />
				</div>
			</div>
		</div>
	)
}

function Starfield() {
	// Memoize star generation to prevent drift on re-renders
	const stars = useMemo(
		() =>
			Array.from({ length: 100 }, (_, i) => ({
				id: i,
				top: `${Math.random() * 100}%`,
				left: `${Math.random() * 100}%`,
				animationDelay: `${Math.random() * 3}s`,
				opacity: Math.random() * 0.7 + 0.3,
			})),
		[] // Empty dependency array ensures stars are only generated once
	)

	return (
		<div className="starfield">
			{stars.map((star) => (
				<div
					key={star.id}
					className="star"
					style={{
						top: star.top,
						left: star.left,
						animationDelay: star.animationDelay,
						opacity: star.opacity,
					}}
				/>
			))}
		</div>
	)
}
