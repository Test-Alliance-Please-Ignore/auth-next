import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as React from 'react'

import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.List>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.List
		ref={ref}
		className={cn(
			'inline-flex h-auto items-center border-b-2 border-border text-muted-foreground',
			className
		)}
		{...props}
	/>
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.Trigger>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, style, ...props }, ref) => {
	const triggerRef = React.useRef<HTMLButtonElement>(null)
	const [isActive, setIsActive] = React.useState(false)

	React.useImperativeHandle(ref, () => triggerRef.current!)

	React.useEffect(() => {
		const element = triggerRef.current
		if (!element) return

		const checkActive = () => {
			setIsActive(element.getAttribute('data-state') === 'active')
		}

		checkActive()

		const observer = new MutationObserver(checkActive)
		observer.observe(element, {
			attributes: true,
			attributeFilter: ['data-state'],
		})

		return () => observer.disconnect()
	}, [])

	return (
		<TabsPrimitive.Trigger
			ref={triggerRef}
			className={cn(
				'relative inline-flex cursor-pointer items-center justify-center whitespace-nowrap px-3 py-1.5 text-sm transition-all duration-200',
				'border-b-[3px] -mb-px border-b-transparent text-muted-foreground/70',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:rounded-sm',
				'disabled:pointer-events-none disabled:opacity-50',
				className
			)}
			style={{
				borderBottomColor: isActive ? 'hsl(var(--primary))' : 'transparent',
				color: isActive ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground) / 0.7)',
				fontWeight: isActive ? 700 : 600,
				...style,
			}}
			{...props}
		/>
	)
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Content
		ref={ref}
		className={cn(
			'mt-6 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
			className
		)}
		{...props}
	/>
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
