import { defineCatalog } from '../catalog'
import { hrNotesCatalog } from './hr-notes'

export const hrCatalog = defineCatalog(
	{ hr: { ...hrNotesCatalog.en } },
	{ hr: { ...hrNotesCatalog.de } },
	{ hr: { ...hrNotesCatalog.ko } }
)
