/**
 * @repo/{{ name }}
 *
 * Shared utilities and helpers for the {{ pascalCase name }} package.
 */

/**
 * Example function - replace with your actual implementation
 * @param value - Input value to process
 * @returns Processed result
 */
export function example(value: string): string {
	return `Example: ${value}`
}

/**
 * Example validation function that throws errors for invalid input
 * @param email - Email address to validate
 * @returns The validated email address
 * @throws {Error} If email format is invalid
 */
export function validateEmail(email: string): string {
	if (!email || email.trim() === '') {
		throw new Error('Email is required')
	}

	const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
	if (!emailPattern.test(email)) {
		throw new Error('Invalid email format')
	}

	return email.toLowerCase()
}

/**
 * Example async function that simulates fetching data
 * @param id - Resource ID to fetch
 * @returns Promise resolving to the fetched data
 * @throws {Error} If ID is invalid
 */
export async function fetchData(id: string): Promise<{ id: string; data: string }> {
	if (!id || id.trim() === '') {
		throw new Error('ID is required')
	}

	// Simulate async operation
	await new Promise((resolve) => setTimeout(resolve, 10))

	return {
		id,
		data: `Data for ${id}`,
	}
}

/**
 * Example async function that processes values
 * @param value - Value to process
 * @param shouldFail - Whether to simulate an error
 * @returns Promise resolving to processed value
 * @throws {Error} If processing fails
 */
export async function processAsync(value: string, shouldFail = false): Promise<string> {
	// Simulate async processing
	await new Promise((resolve) => setTimeout(resolve, 5))

	if (shouldFail) {
		throw new Error('Processing failed')
	}

	return `Processed: ${value}`
}
