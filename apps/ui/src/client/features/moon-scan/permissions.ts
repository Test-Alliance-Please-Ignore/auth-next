import { useUserPermissions } from '@/hooks/useUserPermissions'

export function useMoonScanPermissions() {
	const { hasPermission, isAdmin } = useUserPermissions()
	const canAdmin = isAdmin || hasPermission('urn:moons:admin')
	const canSubmit = isAdmin || hasPermission('urn:moons:scan:submit') || canAdmin
	const canValidate = isAdmin || hasPermission('urn:moons:scan:validate') || canAdmin
	const canView = isAdmin || hasPermission('urn:moons:view') || canSubmit || canValidate || canAdmin

	return {
		canView,
		canSubmit,
		canValidate,
		canAdmin,
	}
}
