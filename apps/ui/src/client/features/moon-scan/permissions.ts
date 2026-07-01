import { useUserPermissions } from '@/hooks/useUserPermissions'

type PermissionLike = { urn: string }

const MOON_ACCESS_LEVELS = {
	submit: 0,
	view: 1,
	validate: 2,
	admin: 3,
} as const

function getMoonAccessLevel(permissions: PermissionLike[], isAdmin: boolean): number {
	if (isAdmin) return MOON_ACCESS_LEVELS.admin

	let level = -1
	for (const permission of permissions) {
		switch (permission.urn) {
			case 'urn:moons:scan:submit':
				level = Math.max(level, MOON_ACCESS_LEVELS.submit)
				break
			case 'urn:moons:view':
				level = Math.max(level, MOON_ACCESS_LEVELS.view)
				break
			case 'urn:moons:scan:validate':
				level = Math.max(level, MOON_ACCESS_LEVELS.validate)
				break
			case 'urn:moons:admin':
				level = Math.max(level, MOON_ACCESS_LEVELS.admin)
				break
		}
	}

	return level
}

export interface MoonScanPermissionState {
	canView: boolean
	canSubmit: boolean
	canValidate: boolean
	canAdmin: boolean
	canAccessMoonScan: boolean
	canLeaderboard: boolean
}

export function getMoonScanPermissionState(permissions: PermissionLike[], isAdmin: boolean): MoonScanPermissionState {
	const accessLevel = getMoonAccessLevel(permissions, isAdmin)
	const canAdmin = accessLevel >= MOON_ACCESS_LEVELS.admin
	const canValidate = accessLevel >= MOON_ACCESS_LEVELS.validate
	const canView = accessLevel >= MOON_ACCESS_LEVELS.view
	const canSubmit = accessLevel >= MOON_ACCESS_LEVELS.submit

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
