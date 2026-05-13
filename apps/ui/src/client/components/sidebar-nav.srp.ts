export interface SidebarSrpNavChild {
	label: string
	href: string
	badge?: number
}

export interface SidebarSrpNavItem {
	label: 'SRP'
	href: string
	external?: boolean
	children?: SidebarSrpNavChild[]
}

export interface ResolveSrpNavStateInput {
	isSiteAdmin: boolean
	hasSrpReviewerPermission: boolean
	hasSrpPayerPermission: boolean
	hasSrpManagerPermission: boolean
	reviewQueueCount: number
	paymentQueueCount: number
	srpAlertCount: number
}

export interface ResolveSrpNavStateResult {
	canSeeSrpReviewQueue: boolean
	canSeeSrpPaymentQueue: boolean
	canSeeSrpAlerts: boolean
	canSeeSrpConfiguration: boolean
	hasSrpStaffAccess: boolean
	shouldFetchSrpReviewCount: boolean
	shouldFetchSrpPaymentCount: boolean
	shouldFetchSrpAlertCount: boolean
	navItem: SidebarSrpNavItem
}

export function resolveSrpNavState(input: ResolveSrpNavStateInput): ResolveSrpNavStateResult {
	const {
		isSiteAdmin,
		hasSrpReviewerPermission,
		hasSrpPayerPermission,
		hasSrpManagerPermission,
		reviewQueueCount,
		paymentQueueCount,
		srpAlertCount,
	} = input

	const canSeeSrpConfiguration = isSiteAdmin || hasSrpManagerPermission
	const canSeeSrpAlerts = isSiteAdmin || hasSrpManagerPermission
	const canSeeSrpPaymentQueue =
		isSiteAdmin || hasSrpManagerPermission || hasSrpPayerPermission
	const canSeeSrpReviewQueue =
		isSiteAdmin || hasSrpManagerPermission || hasSrpPayerPermission || hasSrpReviewerPermission
	const hasSrpStaffAccess = canSeeSrpReviewQueue

	const shouldFetchSrpReviewCount = canSeeSrpReviewQueue
	const shouldFetchSrpPaymentCount = canSeeSrpPaymentQueue
	const shouldFetchSrpAlertCount = canSeeSrpAlerts

	let navItem: SidebarSrpNavItem
	if (!hasSrpStaffAccess) {
		navItem = {
			label: 'SRP',
			href: '/srp',
		}
	} else {
		navItem = {
			label: 'SRP',
			href: '/srp',
			children: [
				{ label: 'My Requests', href: '/srp' },
				...(canSeeSrpReviewQueue
					? [
							{
								label: 'Review Queue',
								href: '/srp/review',
								badge: reviewQueueCount > 0 ? reviewQueueCount : undefined,
							},
						]
					: []),
				...(canSeeSrpPaymentQueue
					? [
							{
								label: 'Payment Queue',
								href: '/srp/payments',
								badge: paymentQueueCount > 0 ? paymentQueueCount : undefined,
							},
						]
					: []),
				...(canSeeSrpAlerts
					? [
							{
								label: 'Alerts',
								href: '/srp/alerts',
								badge: srpAlertCount > 0 ? srpAlertCount : undefined,
							},
						]
					: []),
				...(canSeeSrpConfiguration ? [{ label: 'Configuration', href: '/srp/policies' }] : []),
			],
		}
	}

	return {
		canSeeSrpReviewQueue,
		canSeeSrpPaymentQueue,
		canSeeSrpAlerts,
		canSeeSrpConfiguration,
		hasSrpStaffAccess,
		shouldFetchSrpReviewCount,
		shouldFetchSrpPaymentCount,
		shouldFetchSrpAlertCount,
		navItem,
	}
}
