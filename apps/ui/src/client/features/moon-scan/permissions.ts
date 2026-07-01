import { useUserPermissions } from '@/hooks/useUserPermissions'

type PermissionLike = { urn: string }

export interface MoonScanPermissionState {
	canView: boolean
	canSubmit: boolean
	canValidate: boolean
	canAdmin: boolean
	canAccessMoonScan: boolean
	canLeaderboard: boolean
}

export function getMoonScanPermissionState(permissions: PermissionLike[], isAdmin: boolean): MoonScanPermissionState {
	const has = (urn: string): boolean => isAdmin || permissions.some((permission) => permission.urn === urn)
	const canAdmin = has('urn:moons:admin')
	const canSubmit = canAdmin || has('urn:moons:scan:submit')
	const canValidate = canAdmin || has('urn:moons:scan:validate')
	const canView = canAdmin || has('urn:moons:view')

	return {
		canView,
		canSubmit,
		canValidate,
		canAdmin,
		canAccessMoonScan: canView || canSubmit || canValidate || canAdmin,
		canLeaderboard: canSubmit,
	}
}

export function useMoonScanPermissions() {
	const { permissions, isAdmin } = useUserPermissions()
	return getMoonScanPermissionState(permissions, isAdmin)
}
