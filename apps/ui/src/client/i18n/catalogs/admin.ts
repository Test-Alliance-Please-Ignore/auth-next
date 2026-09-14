import { defineCatalog } from '../catalog'
import { adminOrganizationsCatalog } from './admin-organizations'
import { adminPermissionsCatalog } from './admin-permissions'
import { adminShellCatalog } from './admin-shell'
import { adminUsersCatalog } from './admin-users'

export const adminCatalog = defineCatalog(
	{
		admin: {
			...adminShellCatalog.en,
			...adminPermissionsCatalog.en,
			...adminUsersCatalog.en,
			...adminOrganizationsCatalog.en,
		},
	},
	{
		admin: {
			...adminShellCatalog.de,
			...adminPermissionsCatalog.de,
			...adminUsersCatalog.de,
			...adminOrganizationsCatalog.de,
		},
	},
	{
		admin: {
			...adminShellCatalog.ko,
			...adminPermissionsCatalog.ko,
			...adminUsersCatalog.ko,
			...adminOrganizationsCatalog.ko,
		},
	}
)
