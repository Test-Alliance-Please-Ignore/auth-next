declare module 'lucide-react/dynamic.mjs' {
	export type IconName = string

	export const dynamicIconImports: Record<string, () => Promise<unknown>>
	export const iconNames: IconName[]
	export const DynamicIcon: any
}
