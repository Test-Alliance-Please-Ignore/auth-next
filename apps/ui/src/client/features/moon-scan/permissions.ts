import { useUserPermissions } from '@/hooks/useUserPermissions'

export function useMoonScanPermissions() {
	const { hasPermission, isAdmin } = useUserPermissions()

	return {
		canView: isAdmin || hasPermission('urn:moons:view'),
		canSubmit: isAdmin || hasPermission('urn:moons:scan:submit'),
		canValidate: isAdmin || hasPermission('urn:moons:scan:validate'),
		canAdmin: isAdmin || hasPermission('urn:moons:admin'),
	}
}
