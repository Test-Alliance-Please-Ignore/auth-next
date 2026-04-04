import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { AlertTriangle, Check, CheckCircle, Loader2, X } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

import type { VariantProps } from 'class-variance-authority'

const buttonVariants = cva(
	'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 transition-all duration-200',
	{
		variants: {
			variant: {
				// --- Enhanced styled variants (border-2 + shadow family) ---
				primary: [
					'bg-primary text-primary-foreground',
					'border-2 border-primary/70',
					'shadow-lg shadow-primary/25',
					'hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/40 hover:border-primary/70',
					'focus-visible:ring-primary',
					'cursor-pointer disabled:cursor-not-allowed',
				],
				ghost: [
					'bg-background text-foreground',
					'border-2 border-border-strong/90',
					'shadow-lg shadow-border-strong/30',
					'hover:bg-accent hover:border-border-strong/95 hover:shadow-xl hover:shadow-border-strong/45',
					'focus-visible:ring-ring',
					'cursor-pointer disabled:cursor-not-allowed',
				],
				confirm: [
					'bg-confirm text-confirm-foreground',
					'border-2 border-confirm/70',
					'shadow-lg shadow-confirm/25',
					'hover:bg-confirm-hover hover:shadow-xl hover:shadow-confirm-hover/40 hover:border-confirm-hover/70',
					'focus-visible:ring-confirm',
					'cursor-pointer disabled:cursor-not-allowed',
				],
				cancel: [
					'bg-cancel text-cancel-foreground',
					'border-2 border-cancel/70',
					'shadow-lg shadow-cancel/25',
					'hover:bg-cancel-hover hover:text-white hover:shadow-xl hover:shadow-cancel-hover/40 hover:border-cancel-hover/70',
					'focus-visible:ring-cancel',
					'cursor-pointer disabled:cursor-not-allowed',
				],
				destructive: [
					'bg-warning text-warning-foreground',
					'border-2 border-warning/70',
					'shadow-lg shadow-warning/25',
					'hover:bg-warning/90 hover:shadow-xl hover:shadow-warning/40 hover:border-warning/70',
					'focus-visible:ring-warning',
					'cursor-pointer disabled:cursor-not-allowed',
				],
				danger: [
					'bg-destructive text-destructive-foreground',
					'border-2 border-destructive/70',
					'shadow-lg shadow-destructive/25',
					'hover:bg-destructive/90 hover:shadow-xl hover:shadow-destructive/40 hover:border-destructive/70',
					'focus-visible:ring-destructive',
					'cursor-pointer disabled:cursor-not-allowed',
				],
				success: [
					'bg-success text-success-foreground',
					'border-2 border-success/50',
					'shadow-lg shadow-success/25',
					'hover:bg-success/90 hover:shadow-xl hover:shadow-success/40 hover:border-success/70',
					'focus-visible:ring-success',
					'cursor-pointer disabled:cursor-not-allowed',
				],
				secondary: [
					'bg-secondary text-secondary-foreground',
					'border-2 border-secondary/70',
					'shadow-lg shadow-secondary/25',
					'hover:bg-secondary-hover hover:text-secondary-foreground hover:shadow-xl hover:shadow-secondary/40 hover:border-secondary/75',
					'focus-visible:ring-secondary',
					'cursor-pointer disabled:cursor-not-allowed',
				],
				special: [
					'bg-purple-500 text-white',
					'border-2 border-purple-500/70',
					'shadow-lg shadow-purple-500/25',
					'hover:bg-purple-500/90 hover:shadow-xl hover:shadow-purple-500/40 hover:border-purple-500/70',
					'focus-visible:ring-purple-500',
					'cursor-pointer disabled:cursor-not-allowed',
				],
				// --- Lightweight variant ---
				link: 'text-primary underline-offset-4 hover:underline focus-visible:ring-ring',
			},
			size: {
				default: 'h-10 px-4 py-2',
				sm: 'h-9 rounded-md px-3',
				lg: 'h-11 rounded-md px-8',
				icon: 'h-10 w-10',
			},
		},
		defaultVariants: {
			variant: 'primary',
			size: 'default',
		},
	}
)

// Variants that show a default icon when showIcon is not explicitly false
const VARIANT_DEFAULT_ICONS: Partial<Record<NonNullable<ButtonVariant>, React.ElementType>> = {
	confirm: Check,
	cancel: X,
	destructive: AlertTriangle,
	danger: AlertTriangle,
	success: CheckCircle,
}

export type ButtonVariant = VariantProps<typeof buttonVariants>['variant']

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean
	loading?: boolean
	loadingText?: string
	/** Controls the default icon for icon-bearing variants (confirm, cancel, destructive, danger, success).
	 *  Defaults to true for those variants, ignored for all others. */
	showIcon?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{
			className,
			variant,
			size,
			asChild = false,
			loading = false,
			loadingText,
			showIcon,
			disabled,
			children,
			...props
		},
		ref
	) => {
		const isDisabled = disabled || loading
		const DefaultIcon = variant ? VARIANT_DEFAULT_ICONS[variant] : undefined
		const effectiveShowIcon = DefaultIcon !== undefined ? (showIcon ?? true) : false

		if (asChild) {
			// Slot accepts and forwards any props; TypeScript's SlotProps doesn't declare `disabled`
			// so we spread it via props to avoid the type error while keeping correct runtime behavior
			const Comp = Slot as React.ElementType
			return (
				<Comp
					ref={ref}
					className={cn(buttonVariants({ variant, size, className }))}
					disabled={isDisabled}
					{...props}
				>
					{children}
				</Comp>
			)
		}

		return (
			<button
				ref={ref}
				className={cn(buttonVariants({ variant, size, className }))}
				disabled={isDisabled}
				{...props}
			>
				{loading ? (
					<>
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						{loadingText ?? 'Processing...'}
					</>
				) : (
					<>
						{effectiveShowIcon && DefaultIcon && <DefaultIcon className="mr-2 h-4 w-4" />}
						{children}
					</>
				)}
			</button>
		)
	}
)
Button.displayName = 'Button'

export { Button, buttonVariants }
