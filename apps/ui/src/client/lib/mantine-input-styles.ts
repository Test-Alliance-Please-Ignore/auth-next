export const MANTINE_THEMED_INPUT_CLASS_NAMES = {
	root: 'w-full',
	wrapper:
		'rounded-md ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
	input: 'disabled:cursor-not-allowed disabled:opacity-50',
	section: 'text-muted-foreground',
} as const

export const MANTINE_THEMED_INPUT_STYLES = {
	root: {
		'--input-bd': 'rgb(49, 54, 63)',
		'--input-bd-focus': 'rgb(49, 54, 63)',
	},
	wrapper: {
		height: '2.5rem',
		border: '1px solid rgb(49, 54, 63)',
		borderRadius: '0.375rem',
		background: 'hsl(var(--background))',
		overflow: 'hidden',
	},
	input: {
		height: '2.5rem',
		borderRadius: 0,
		border: 0,
		background: 'transparent',
		color: 'hsl(var(--foreground))',
		paddingInline: '0.75rem',
		fontSize: '0.875rem',
		outline: 'none',
		boxShadow: 'none',
		'&:focus, &:focus-visible': {
			outline: 'none',
			boxShadow: 'none !important',
			borderColor: 'rgb(49, 54, 63)',
		},
	},
	section: {
		color: 'hsl(var(--muted-foreground))',
	},
} as const

export const MANTINE_THEMED_NUMBER_INPUT_CLASS_NAMES = {
	...MANTINE_THEMED_INPUT_CLASS_NAMES,
} as const

export const MANTINE_THEMED_NUMBER_INPUT_STYLES = {
	...MANTINE_THEMED_INPUT_STYLES,
	controls: {
		overflow: 'hidden',
		height: '100%',
		borderLeft: '1px solid rgb(49, 54, 63)',
		borderRadius: 0,
		background: 'hsl(var(--background))',
		boxShadow: 'none',
	},
	control: {
		border: 0,
		background: 'hsl(var(--background))',
		color: 'hsl(var(--muted-foreground))',
		'&:focus, &:focus-visible': {
			outline: 'none',
			boxShadow: 'none !important',
		},
		'&:hover': {
			background: 'hsl(var(--accent))',
			color: 'hsl(var(--accent-foreground))',
		},
	},
} as const
