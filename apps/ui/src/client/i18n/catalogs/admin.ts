import { defineCatalog } from '../catalog'
import { adminPermissionsCatalog } from './admin-permissions'
import { adminShellCatalog } from './admin-shell'

export const adminCatalog = defineCatalog(
	{ admin: { ...adminShellCatalog.en, ...adminPermissionsCatalog.en } },
	{ admin: { ...adminShellCatalog.de, ...adminPermissionsCatalog.de } },
	{ admin: { ...adminShellCatalog.ko, ...adminPermissionsCatalog.ko } }
)
