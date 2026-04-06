import type { ApplicationStatus } from './api'

/** Application statuses where the application is still being actively processed */
export const ACTIVE_APPLICATION_STATUSES: ApplicationStatus[] = ['pending', 'under_review']
