import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createViteConfig } from '@repo/vite-config'

const currentDir = dirname(fileURLToPath(import.meta.url))

export default createViteConfig(currentDir)
