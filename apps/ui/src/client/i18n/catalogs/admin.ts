import { defineCatalog } from '../catalog'
import { adminPermissionsCatalog } from './admin-permissions'
import { adminShellCatalog } from './admin-shell'
import { adminUsersCatalog } from './admin-users'

export const adminCatalog = defineCatalog(
	{ admin: { ...adminShellCatalog.en, ...adminPermissionsCatalog.en, ...adminUsersCatalog.en } },
	{ admin: { ...adminShellCatalog.de, ...adminPermissionsCatalog.de, ...adminUsersCatalog.de } },
	{ admin: { ...adminShellCatalog.ko, ...adminPermissionsCatalog.ko, ...adminUsersCatalog.ko } }
)
