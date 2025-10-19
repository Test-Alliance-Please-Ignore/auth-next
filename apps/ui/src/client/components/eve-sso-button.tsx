/**
 * EVE Online SSO Login Button
 * Uses official EVE Online SSO button image from CCP
 */

interface EveSSoButtonProps {
	onClick: () => void
	loading?: boolean
	className?: string
}

export function EveSSOButton({ onClick, loading = false, className = '' }: EveSSoButtonProps) {
	if (loading) {
		return (
			<button
				disabled
				className={`
					relative overflow-hidden
					bg-black border-2 border-white
					text-white font-bold
					px-8 py-4
					rounded-md
					opacity-50 cursor-not-allowed
					${className}
				`}
			>
				<span className="flex items-center gap-2">
					<svg
						className="animate-spin h-5 w-5"
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
					>
						<circle
							className="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							strokeWidth="4"
						></circle>
						<path
							className="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						></path>
					</svg>
					Loading...
				</span>
			</button>
		)
	}

	return (
		<button
			onClick={onClick}
			className={`
				transition-all duration-200
				hover:opacity-90 hover:scale-105
				glow-hover
				${className}
			`}
			aria-label="Log in with EVE Online"
		>
			<img
				src="https://web.ccpgamescdn.com/eveonlineassets/developers/eve-sso-login-black-large.png"
				alt="LOG IN with EVE Online"
				className="h-auto"
			/>
		</button>
	)
}
