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
	srpEnabled: boolean
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
		srpEnabled,
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

	const shouldFetchSrpReviewCount = srpEnabled && canSeeSrpReviewQueue
	const shouldFetchSrpPaymentCount = srpEnabled && canSeeSrpPaymentQueue
	const shouldFetchSrpAlertCount = srpEnabled && canSeeSrpAlerts

	let navItem: SidebarSrpNavItem
	if (!srpEnabled) {
		navItem = {
			label: 'SRP',
			href: 'https://reimbursement.pleaseignore.com/',
			external: true,
		}
	} else if (!hasSrpStaffAccess) {
		navItem = {
			label: 'SRP',
			href: '/srp/my-requests',
		}
	} else {
		navItem = {
			label: 'SRP',
			href: '/srp/my-requests',
			children: [
				{ label: 'My Requests', href: '/srp/my-requests' },
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
