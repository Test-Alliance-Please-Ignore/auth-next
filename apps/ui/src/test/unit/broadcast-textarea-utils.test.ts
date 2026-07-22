import { afterEach, describe, expect, it, vi } from 'vitest'

import { autoResizeTextarea } from '@/features/broadcasts/utils'

function makeTextarea({
	height,
	scrollHeight,
}: {
	height: string
	scrollHeight: number
}): { element: HTMLTextAreaElement; heightWrites: string[] } {
	let currentHeight = height
	const heightWrites: string[] = []
	const style = {} as CSSStyleDeclaration
	Object.defineProperty(style, 'height', {
		get: () => currentHeight,
		set: (value: string) => {
			currentHeight = value
			heightWrites.push(value)
		},
	})

	const element = {
		style,
		scrollHeight,
		getBoundingClientRect: () => ({ height: Number.parseFloat(currentHeight) }) as DOMRect,
	} as HTMLTextAreaElement
	return { element, heightWrites }
}

function stubFocusedMobileViewport(element: HTMLTextAreaElement): void {
	vi.stubGlobal('document', { activeElement: element })
	vi.stubGlobal('window', {
		matchMedia: () => ({ matches: true }) as MediaQueryList,
	})
}

function stubFocusedDesktopViewport(element: HTMLTextAreaElement): void {
	vi.stubGlobal('document', { activeElement: element })
	vi.stubGlobal('window', {
		matchMedia: () => ({ matches: false }) as MediaQueryList,
	})
}

describe('autoResizeTextarea', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('preserves desktop shrink behavior while focused', () => {
		const { element, heightWrites } = makeTextarea({ height: '160px', scrollHeight: 64 })
		stubFocusedDesktopViewport(element)

		autoResizeTextarea(element)

		expect(heightWrites).toEqual(['0px', '64px'])
		expect(element.style.height).toBe('64px')
	})

	it('grows a focused mobile textarea without first collapsing it', () => {
		const { element, heightWrites } = makeTextarea({ height: '40px', scrollHeight: 96 })
		stubFocusedMobileViewport(element)

		autoResizeTextarea(element)

		expect(heightWrites).toEqual(['96px'])
		expect(element.style.height).toBe('96px')
	})

	it('does not shrink a focused mobile textarea while the user is editing', () => {
		const { element, heightWrites } = makeTextarea({ height: '160px', scrollHeight: 64 })
		stubFocusedMobileViewport(element)

		autoResizeTextarea(element)

		expect(heightWrites).toEqual([])
		expect(element.style.height).toBe('160px')
	})

	it('shrinks focused mobile textareas when forced after editing finishes', () => {
		const { element, heightWrites } = makeTextarea({ height: '160px', scrollHeight: 64 })
		stubFocusedMobileViewport(element)

		autoResizeTextarea(element, { forceShrink: true })

		expect(heightWrites).toEqual(['0px', '64px'])
		expect(element.style.height).toBe('64px')
	})
})
