export const mumbleKeys = {
	all: ['mumble'] as const,
	account: () => [...mumbleKeys.all, 'account'] as const,
}
