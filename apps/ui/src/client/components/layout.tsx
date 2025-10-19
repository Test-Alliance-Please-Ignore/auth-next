import { Link, Outlet } from 'react-router-dom'
import { useAuth, useLogout } from '@/hooks/useAuth'
import { Button } from './ui/button'

export default function Layout() {
	const { user, isAuthenticated } = useAuth()
	const logout = useLogout()

	// Find main character
	const mainCharacter = user?.characters.find(
		(c) => c.characterId === user.mainCharacterId
	)

	return (
		<div className="min-h-screen flex flex-col">
			{/* Starfield Background */}
			<Starfield />

			{/* Header */}
			<header className="border-b border-border/30 backdrop-blur-md bg-gradient-to-r from-background/90 via-background/80 to-background/90 sticky top-0 z-50 shadow-[0_4px_20px_rgba(0,0,0,0.3)]">
				<div className="container mx-auto px-4 py-4">
					<nav className="flex items-center justify-between">
						<Link to={isAuthenticated ? "/dashboard" : "/"} className="text-xl md:text-2xl font-bold gradient-text drop-shadow-[0_2px_8px_rgba(255,255,255,0.1)]">
							Test Auth Next Generation
						</Link>

						{isAuthenticated && user ? (
							<div className="flex items-center gap-4">
								{/* User Info */}
								<div className="hidden md:flex items-center gap-3">
									{mainCharacter && (
										<>
											<img
												src={`https://images.evetech.net/characters/${mainCharacter.characterId}/portrait?size=32`}
												alt={mainCharacter.characterName}
												className="w-8 h-8 rounded-full border border-primary/50"
											/>
											<span className="text-sm text-muted-foreground">
												{mainCharacter.characterName}
											</span>
										</>
									)}
								</div>

								{/* Navigation */}
								<Link
									to="/dashboard"
									className="text-sm hover:text-primary transition-colors"
								>
									Dashboard
								</Link>

								{/* Logout */}
								<Button
									variant="outline"
									size="sm"
									onClick={() => logout.mutate()}
									disabled={logout.isPending}
								>
									{logout.isPending ? 'Logging out...' : 'Logout'}
								</Button>
							</div>
						) : (
							<Link to="/">
								<Button variant="outline" size="sm">
									Home
								</Button>
							</Link>
						)}
					</nav>
				</div>
			</header>

			{/* Main content */}
			<main className="flex-1 relative z-10">
				<Outlet />
			</main>

			{/* Footer */}
			<footer className="border-t border-border/50 py-6 relative z-10 backdrop-blur-sm bg-background/80">
				<div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
					<p>Powered by EVE Online SSO • Built on Cloudflare Workers</p>
				</div>
			</footer>
		</div>
	)
}

function Starfield() {
	// Generate random stars
	const stars = Array.from({ length: 50 }, (_, i) => ({
		id: i,
		top: `${Math.random() * 100}%`,
		left: `${Math.random() * 100}%`,
		animationDelay: `${Math.random() * 3}s`,
		opacity: Math.random() * 0.5 + 0.2,
	}))

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
