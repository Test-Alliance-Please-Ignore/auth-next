export const freightKeys = {
	all: ['freight'] as const,
	routes: () => [...freightKeys.all, 'routes'] as const,
}
