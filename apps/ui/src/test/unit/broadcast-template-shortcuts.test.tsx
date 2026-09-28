// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as srpTokens from '@/features/broadcasts/srp-token-generator'
import { doctrineKeys, stagingSystemKeys } from '@/features/doctrines/query-keys'
import { broadcastKeys } from '@/hooks/useBroadcasts'
import { I18nProvider, setAppLocale } from '@/i18n'
import { api } from '@/lib/api'
import BroadcastsPage from '@/routes/broadcasts'
import NewBroadcastPage from '@/routes/broadcasts-new'

import { applicant } from '../fixtures/applicant-workflows'
import { composerDraft, composerTemplate, trackingPermission } from '../fixtures/broadcast-composer'
import { broadcast, broadcastTarget, broadcastTemplate } from '../fixtures/broadcasts'
import { personalBroadcastTemplate } from '../fixtures/personal-broadcast-templates'

import type { Root } from 'react-dom/client'
import type { PersonalBroadcastTemplate } from '@repo/broadcasts'
import type { SelectOption, SelectProps } from '@/components/ui/select'
import type { BroadcastTarget, BroadcastTemplate } from '@/lib/api'

// Exercise the real composer, fields, queries and mutations; keep dropdown interaction native.
vi.mock('@/components/ui/select', () => ({
	Select: ({ inputId, options, value, onValueChange, disabled }: SelectProps<SelectOption>) => (
		<select
			id={inputId}
			value={value}
			disabled={disabled}
			onChange={(event) => onValueChange?.(event.target.value, null)}
		>
			<option value="" />
			{options.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	),
}))

const otherTarget: BroadcastTarget = { ...broadcastTarget, id: 'target-two', name: 'Second target' }
const firstTemplate: BroadcastTemplate = {
	...broadcastTemplate,
	id: 'first',
	name: 'First template',
}
const requestedTemplate: BroadcastTemplate = {
	...composerTemplate,
	id: 'requested',
	name: 'Requested template',
	targetIds: [broadcastTarget.id, otherTarget.id],
	displayOrder: 1,
}
const url = (templateId = requestedTemplate.id, targetId = broadcastTarget.id) =>
	`/broadcasts/new?${new URLSearchParams({ templateId, targetId })}`
const scopedKey = broadcastKeys.templatesFiltered(broadcastTarget.type, broadcastTarget.id)
const listKey = broadcastKeys.broadcastsPage(undefined, undefined, true, 25, 0, undefined)
const personal = { ...personalBroadcastTemplate, templateId: requestedTemplate.id }
const personalKey = broadcastKeys.personalTemplatesForUser(applicant.id)
const personalUrl = `/broadcasts/new?personalTemplateId=${personal.id}`
let savedTemplates: PersonalBroadcastTemplate[]
let client: QueryClient
let container: HTMLDivElement
let root: Root
let router: ReturnType<typeof createMemoryRouter>

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

async function flush(callback: () => unknown = () => {}) {
	await act(async () => {
		await callback()
		await new Promise((resolve) => setTimeout(resolve, 10))
	})
}

async function mount(path = url()) {
	router = createMemoryRouter(
		[
			{ path: '/broadcasts', element: <BroadcastsPage /> },
			{ path: '/broadcasts/new', element: <NewBroadcastPage /> },
		],
		{ initialEntries: [path] }
	)
	await flush(() => {
		root.render(
			<StrictMode>
				<QueryClientProvider client={client}>
					<I18nProvider>
						<RouterProvider router={router} />
					</I18nProvider>
				</QueryClientProvider>
			</StrictMode>
		)
	})
}

function input(id: string) {
	const element = document.getElementById(id)
	expect(element, `Missing form control ${id}`).not.toBeNull()
	return element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
}

async function fill(id: string, value: string) {
	await flush(() => {
		const element = input(id)
		const prototype =
			element instanceof HTMLTextAreaElement
				? HTMLTextAreaElement.prototype
				: element instanceof HTMLSelectElement
					? HTMLSelectElement.prototype
					: HTMLInputElement.prototype
		Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
		element.dispatchEvent(
			new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
		)
	})
}

function button(label: string) {
	const element = [...document.querySelectorAll('button')].find(
		(candidate) =>
			candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label
	)
	expect(element, `Missing button ${label}`).toBeDefined()
	return element!
}

function sendButton() {
	return button(`Send ${personal.name} to ${broadcastTarget.name} now`)
}

function expectNoMutations() {
	for (const method of [
		'createBroadcast',
		'updateBroadcast',
		'sendBroadcast',
		'updateBroadcastTemplate',
		'createBroadcastTemplate',
		'createPersonalBroadcastTemplate',
		'updatePersonalBroadcastTemplate',
		'deletePersonalBroadcastTemplate',
	] as const) {
		expect(api[method]).not.toHaveBeenCalled()
	}
}

beforeEach(() => {
	vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
	// Any unexpected network access is a test failure; delivery is always mocked.
	vi.stubGlobal(
		'fetch',
		vi.fn(() => {
			throw new Error('Unexpected network request')
		})
	)
	client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
	client.setQueryData(['auth', 'session'], {
		authenticated: true,
		user: applicant,
		permissions: [trackingPermission],
	})
	client.setQueryData(broadcastKeys.targets(), [broadcastTarget, otherTarget])
	client.setQueryData(broadcastKeys.templatesFiltered(), [firstTemplate, requestedTemplate])
	client.setQueryData(scopedKey, [firstTemplate, requestedTemplate])
	client.setQueryData(broadcastKeys.templatesFiltered(otherTarget.type, otherTarget.id), [
		requestedTemplate,
	])
	client.setQueryData(doctrineKeys.list(), [])
	client.setQueryData(stagingSystemKeys.all, [])
	client.setQueryData(listKey, { rows: [], rowCount: 0 })
	savedTemplates = [personal]
	client.setQueryData(personalKey, savedTemplates)
	vi.spyOn(api, 'getPersonalBroadcastTemplates').mockImplementation(async () => [...savedTemplates])
	vi.spyOn(api, 'createPersonalBroadcastTemplate').mockImplementation(async (data) => {
		const saved = { ...data, id: 'personal-created' }
		savedTemplates = [...savedTemplates, saved]
		return saved
	})
	vi.spyOn(api, 'updatePersonalBroadcastTemplate').mockImplementation(async (id, data) => {
		const saved = { ...data, id }
		savedTemplates = savedTemplates.map((item) => (item.id === id ? saved : item))
		return saved
	})
	vi.spyOn(api, 'deletePersonalBroadcastTemplate').mockImplementation(async (id) => {
		savedTemplates = savedTemplates.filter((item) => item.id !== id)
		return { success: true }
	})
	vi.spyOn(api, 'getBroadcastTargets').mockResolvedValue([broadcastTarget, otherTarget])
	vi.spyOn(api, 'getBroadcastTemplates').mockResolvedValue([firstTemplate, requestedTemplate])
	vi.spyOn(api, 'getBroadcasts').mockResolvedValue({ rows: [], rowCount: 0 })
	vi.spyOn(api, 'createBroadcast').mockResolvedValue({
		...broadcast,
		id: 'new-draft',
		status: 'draft',
	})
	vi.spyOn(api, 'updateBroadcast').mockResolvedValue(composerDraft)
	vi.spyOn(api, 'sendBroadcast').mockResolvedValue({
		success: true,
		broadcast,
		delivery: {
			status: 'sent',
			discordMessageId: null,
			errorMessage: null,
		},
	})
	vi.spyOn(api, 'createBroadcastTemplate').mockResolvedValue(requestedTemplate)
	vi.spyOn(api, 'updateBroadcastTemplate').mockResolvedValue(requestedTemplate)
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
})

afterEach(async () => {
	await act(async () => root.unmount())
	router?.dispose()
	container.remove()
	client.clear()
	await setAppLocale('en', { persistLocal: false })
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('broadcast template shortcuts', () => {
	it('renders links without history and both row actions open the same new composer without mutations', async () => {
		await mount('/broadcasts')
		expect(container.textContent).toContain('My Templates')
		expect(container.textContent).toContain('No Broadcasts Yet')
		const links = [...container.querySelectorAll<HTMLAnchorElement>('a')].filter(
			(link) => link.getAttribute('href') === personalUrl
		)
		expect(links).toHaveLength(2)
		expect(links[0]!.textContent).toBe(personal.name)
		expect(links[1]!.textContent).toBe('')
		expect(links[1]!.getAttribute('title')).toBe('Use template')
		await flush(() => links[0]!.click())
		expect(input('target').value).toBe(broadcastTarget.id)
		expect(input('template').value).toBe(requestedTemplate.id)
		expectNoMutations()
	})

	it('waits for asynchronous target, scoped template and staging data before applying the requested defaults once', async () => {
		const targets = deferred<BroadcastTarget[]>()
		const templates = deferred<BroadcastTemplate[]>()
		const staging = deferred<Awaited<ReturnType<typeof api.getStagingSystems>>>()
		client.removeQueries({ queryKey: broadcastKeys.targets() })
		client.removeQueries({ queryKey: scopedKey })
		client.removeQueries({ queryKey: stagingSystemKeys.all })
		vi.mocked(api.getBroadcastTargets).mockReturnValue(targets.promise)
		vi.mocked(api.getBroadcastTemplates).mockReturnValue(templates.promise)
		vi.spyOn(api, 'getStagingSystems').mockReturnValue(staging.promise)
		await mount()
		expect(container.textContent).toContain('Loading the selected template and target')
		expect(container.textContent).not.toContain('This template link is incomplete')
		expect(button('Send Broadcast').disabled).toBe(true)
		await flush(() => targets.resolve([broadcastTarget]))
		await flush(() => templates.resolve([firstTemplate, requestedTemplate]))
		expect(input('template').value).toBe('custom')
		await flush(() =>
			staging.resolve([
				{
					id: 'stage',
					solarSystemId: '30000142',
					solarSystemName: 'Jita',
					sortOrder: 0,
				},
			])
		)
		expect(input('template').value).toBe(requestedTemplate.id)
		expect(input('staging').value).toBe('Jita')
		expect(input('fleetCommander').value).toBe(applicant.mainCharacterId)
		expect(container.textContent).toContain('Blanket')
		expectNoMutations()
	})

	it('keeps entered fields, prefix/suffix and SRP token through refetches and locale changes', async () => {
		const generateToken = vi.spyOn(srpTokens, 'generateSrpTokenAtFormLoad')
		await mount()
		expect(generateToken).toHaveBeenCalledTimes(1)
		const token = generateToken.mock.results[0]!.value
		await fill('notes', 'Keep my notes')
		await fill('template-prefix-text', 'My prefix')
		await fill('template-default-text', 'My suffix')
		await flush(() => client.refetchQueries({ queryKey: broadcastKeys.templates() }))
		await flush(() => client.refetchQueries({ queryKey: broadcastKeys.targets() }))
		await flush(() =>
			client.setQueryData(stagingSystemKeys.all, [
				{ id: 'new-staging', solarSystemId: '30000142', solarSystemName: 'Jita', sortOrder: 0 },
			])
		)
		await flush(() => setAppLocale('de', { persistLocal: false }))
		expect(input('notes').value).toBe('Keep my notes')
		expect(input('template-prefix-text').value).toBe('My prefix')
		expect(input('template-default-text').value).toBe('My suffix')
		await flush(() => setAppLocale('en', { persistLocal: false }))
		expect(container.textContent).toContain(token)
		expect(generateToken).toHaveBeenCalledTimes(1)
		expect(input('staging-custom').value).toBe('')
		expect(input('template').value).toBe(requestedTemplate.id)
		expectNoMutations()
	})

	it('retries the templates panel independently of the broadcast history', async () => {
		client.setQueryData(listKey, { rows: [broadcast], rowCount: 1 })
		client.removeQueries({ queryKey: broadcastKeys.templates() })
		vi.mocked(api.getBroadcastTemplates).mockRejectedValueOnce(new Error('Offline'))
		await mount('/broadcasts')
		await flush()
		expect(container.textContent).toContain('Unable to load available templates and targets.')
		expect(container.textContent).toContain('Recent Broadcasts')
		expect(container.querySelector(`a[href="/broadcasts/${broadcast.id}"]`)).not.toBeNull()
		await flush(() => button('Try again').click())
		await flush()
		expect(container.querySelector('a[title="Use template"]')).not.toBeNull()
		expect(container.textContent).not.toContain('Unable to load available templates and targets.')
		expectNoMutations()
	})

	it('starts fresh for another shortcut and reinitializes on refresh', async () => {
		await mount()
		await fill('notes', 'Old notes')
		await flush(() => router.navigate(url(requestedTemplate.id, otherTarget.id)))
		expect(input('target').value).toBe(otherTarget.id)
		expect(input('notes').value).toBe('')
		await flush(() => router.navigate(url(firstTemplate.id)))
		expect(input('template').value).toBe(firstTemplate.id)
		await act(async () => root.unmount())
		root = createRoot(container)
		router.dispose()
		await mount(url(firstTemplate.id))
		expect(input('target').value).toBe(broadcastTarget.id)
		expect(input('template').value).toBe(firstTemplate.id)
		expectNoMutations()
	})

	it.each([
		'/broadcasts/new?templateId=requested',
		'/broadcasts/new?targetId=target-original',
		'/broadcasts/new?templateId=&targetId=target-original',
		url('deleted'),
		url('requested', 'unauthorized'),
		url('first', otherTarget.id),
	])(
		'explains invalid selection %s without substituting a template, and offers recovery',
		async (path) => {
			await mount(path)
			expect(container.textContent).toContain('This template link is incomplete')
			expect(button('Send Broadcast').disabled).toBe(true)
			expect(button('Save as Draft').disabled).toBe(true)
			expectNoMutations()
			const recovery = container.querySelector<HTMLAnchorElement>('a[href="/broadcasts/new"]')!
			await flush(() => recovery.click())
			expect(input('target').value).toBe('')
			await fill('target', broadcastTarget.id)
			expect(input('template').value).toBe(firstTemplate.id)
		}
	)

	it('rejects a mismatched target type and a subsequently removed selection without fallback', async () => {
		client.setQueryData(scopedKey, [{ ...requestedTemplate, targetType: 'other' }])
		await mount()
		expect(container.textContent).toContain('This template link is incomplete')
		await flush(() => client.setQueryData(scopedKey, [firstTemplate, requestedTemplate]))
		expect(input('template').value).toBe(requestedTemplate.id)
		await fill('notes', 'Preserve me')
		await flush(() => client.setQueryData(scopedKey, [firstTemplate]))
		expect(container.textContent).toContain('This template link is incomplete')
		expect(button('Send Broadcast').disabled).toBe(true)
		await flush(() => client.setQueryData(scopedKey, [firstTemplate, requestedTemplate]))
		expect(input('notes').value).toBe('Preserve me')
		expectNoMutations()
	})

	it('allows manual template changes after initialization without reapplying the shortcut', async () => {
		await mount()
		await fill('template', firstTemplate.id)
		await fill('staging', 'User staging')
		await flush(() => client.refetchQueries({ queryKey: broadcastKeys.templates() }))
		expect(input('template').value).toBe(firstTemplate.id)
		expect(input('staging').value).toBe('User staging')
		await fill('template', 'custom')
		await fill('message', 'Custom message')
		expect(button('Send Broadcast').disabled).toBe(false)
		expectNoMutations()
	})

	it('gives an asynchronously loaded draft precedence over shortcut parameters', async () => {
		const draft = deferred<typeof composerDraft>()
		vi.spyOn(api, 'getBroadcast').mockReturnValue(draft.promise)
		await mount(`${url()}&draftId=${composerDraft.id}`)
		expect(container.textContent).toContain('Loading draft')
		expect(container.textContent).not.toContain('Loading the selected template')
		client.setQueryData(scopedKey, [firstTemplate, composerTemplate, requestedTemplate])
		await flush(() => draft.resolve(composerDraft))
		expect(input('template').value).toBe(composerTemplate.id)
		expect(input('notes').value).toBe(composerDraft.content.notes)
		expect(input('template-prefix-text').value).toBe('Original before')
		expect(container.textContent).toContain('ORIGINAL-TOKEN')
		await fill('notes', 'Edited draft')
		await flush(() => router.navigate(`${url('deleted')}&draftId=${composerDraft.id}`))
		expect(input('notes').value).toBe('Edited draft')
		expectNoMutations()
	})

	it('shows a retryable query failure separately from an invalid link', async () => {
		client.removeQueries({ queryKey: scopedKey })
		vi.mocked(api.getBroadcastTemplates).mockRejectedValueOnce(new Error('Offline'))
		await mount()
		await flush()
		expect(container.textContent).toContain('Unable to check this template link')
		expect(button('Send Broadcast').disabled).toBe(true)
		await flush(() => button('Try again').click())
		await flush()
		expect(input('template').value).toBe(requestedTemplate.id)
		expectNoMutations()
	})

	it.each(['Save as Draft', 'Send Broadcast'])(
		'creates a new broadcast only after explicit %s',
		async (action) => {
			await mount()
			await fill('fleetName', 'New fleet')
			await fill('staging-custom', 'Jita')
			expectNoMutations()
			await flush(() => {
				if (action === 'Send Broadcast')
					container
						.querySelector('form')!
						.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
				else button(action).click()
			})
			expect(api.createBroadcast).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({
					templateId: requestedTemplate.id,
					content: expect.objectContaining({ fleetName: 'New fleet', staging: 'Jita' }),
				})
			)
			expect(api.updateBroadcast).not.toHaveBeenCalled()
			expect(api.updateBroadcastTemplate).not.toHaveBeenCalled()
			expect(api.createBroadcastTemplate).not.toHaveBeenCalled()
			if (action === 'Send Broadcast')
				expect(api.sendBroadcast).toHaveBeenCalledExactlyOnceWith('new-draft')
			else expect(api.sendBroadcast).not.toHaveBeenCalled()
		}
	)
})

describe('personal broadcast templates', () => {
	it('sends saved template fields directly as a new broadcast without changing either template', async () => {
		const saved = {
			...personal,
			content: {
				...personal.content,
				__srpToken: 'OLD-TOKEN',
				__fleetSessionId: 'OLD-SESSION',
				__baseMessage: 'Old delivery',
			},
		}
		client.setQueryData(personalKey, [saved])
		await mount('/broadcasts')
		expectNoMutations()
		await flush(() => sendButton().click())
		await flush()
		expect(api.createBroadcast).toHaveBeenCalledExactlyOnceWith({
			targetId: broadcastTarget.id,
			templateId: requestedTemplate.id,
			title: `Broadcast to ${broadcastTarget.name}`,
			content: personal.content,
		})
		expect(api.sendBroadcast).toHaveBeenCalledExactlyOnceWith('new-draft')
		expect(api.updatePersonalBroadcastTemplate).not.toHaveBeenCalled()
		expect(api.updateBroadcastTemplate).not.toHaveBeenCalled()
		expect(api.updateBroadcast).not.toHaveBeenCalled()
		expect(saved.content.__srpToken).toBe('OLD-TOKEN')
		expect(router.state.location.pathname).toBe('/broadcasts')
		expect(container.querySelector('form')).toBeNull()
		expect(container.querySelector('[role="status"]')?.textContent).toContain(
			'Broadcast sent successfully!'
		)
		expect(container.querySelector('a[href="/broadcasts/new-draft"]')).not.toBeNull()
		expect(api.getBroadcasts).toHaveBeenCalled()
	})

	it('sends custom messages without template fields or delivery metadata', async () => {
		client.setQueryData(personalKey, [
			{
				...personal,
				templateId: null,
				content: {
					message: 'Custom text {{literal}}',
					mentionLevel: 'everyone',
					__srpToken: 'OLD',
					__fleetTrackingEnabled: 'true',
				},
			},
		])
		await mount('/broadcasts')
		await flush(() => sendButton().click())
		expect(api.createBroadcast).toHaveBeenCalledExactlyOnceWith({
			targetId: broadcastTarget.id,
			templateId: undefined,
			title: `Broadcast to ${broadcastTarget.name}`,
			content: { message: 'Custom text {{literal}}', mentionLevel: 'everyone' },
		})
		expect(api.sendBroadcast).toHaveBeenCalledExactlyOnceWith('new-draft')
	})

	it('blocks duplicate clicks throughout draft creation and delivery', async () => {
		const created = deferred<Awaited<ReturnType<typeof api.createBroadcast>>>()
		const sent = deferred<Awaited<ReturnType<typeof api.sendBroadcast>>>()
		vi.mocked(api.createBroadcast).mockReturnValue(created.promise)
		vi.mocked(api.sendBroadcast).mockReturnValue(sent.promise)
		await mount('/broadcasts')
		const send = sendButton()
		await flush(() => {
			send.click()
			send.click()
		})
		expect(api.createBroadcast).toHaveBeenCalledTimes(1)
		expect(api.sendBroadcast).not.toHaveBeenCalled()
		expect(send.disabled).toBe(true)
		expect(send.getAttribute('aria-busy')).toBe('true')
		await flush(() => created.resolve({ ...broadcast, id: 'new-draft', status: 'draft' }))
		await flush(() => send.click())
		expect(api.createBroadcast).toHaveBeenCalledTimes(1)
		expect(api.sendBroadcast).toHaveBeenCalledExactlyOnceWith('new-draft')
		expect(send.disabled).toBe(true)
		await flush(() =>
			sent.resolve({
				success: true,
				broadcast,
				delivery: { status: 'sent', discordMessageId: 'message', errorMessage: null },
			})
		)
		expect(sendButton().disabled).toBe(false)
	})

	it.each([false, true])(
		'keeps incomplete saved content in the composer flow (custom: %s)',
		async (custom) => {
			client.setQueryData(personalKey, [
				{
					...personal,
					templateId: custom ? null : personal.templateId,
					content: custom ? { message: '   ' } : { ...personal.content, fleetName: '   ' },
				},
			])
			await mount('/broadcasts')
			await flush(() => sendButton().click())
			expect(container.querySelector('[role="alert"]')?.textContent).toContain(
				'Use template to complete them before sending.'
			)
			expect(container.querySelector(`a[href="${personalUrl}"]`)).not.toBeNull()
			expectNoMutations()
		}
	)

	it('reports revoked permissions without attempting delivery', async () => {
		vi.mocked(api.createBroadcast).mockRejectedValueOnce(new Error('Permission denied'))
		await mount('/broadcasts')
		await flush(() => sendButton().click())
		expect(container.querySelector('[role="alert"]')?.textContent).toContain('Permission denied')
		expect(api.createBroadcast).toHaveBeenCalledTimes(1)
		expect(api.sendBroadcast).not.toHaveBeenCalled()
		expect(sendButton().disabled).toBe(false)
	})

	it.each(['rejected', 'delivery-failed', 'tracking-failed'] as const)(
		'reports %s and links to the new broadcast without automatic retries',
		async (outcome) => {
			if (outcome === 'rejected')
				vi.mocked(api.sendBroadcast).mockRejectedValueOnce(new Error('Connection lost'))
			else
				vi.mocked(api.sendBroadcast).mockResolvedValueOnce({
					success: outcome === 'tracking-failed',
					broadcast,
					delivery: {
						status: outcome === 'tracking-failed' ? 'sent' : 'failed',
						discordMessageId: null,
						errorMessage: outcome === 'delivery-failed' ? 'Discord rejected delivery' : null,
					},
					trackingError: outcome === 'tracking-failed' ? 'Not fleet boss' : undefined,
				})
			await mount('/broadcasts')
			await flush(() => sendButton().click())
			await flush()
			const expected =
				outcome === 'rejected'
					? 'Connection lost'
					: outcome === 'delivery-failed'
						? 'Discord rejected delivery'
						: 'Broadcast sent, but fleet tracking failed: Not fleet boss'
			expect(container.querySelector('[role="alert"]')?.textContent).toContain(expected)
			expect(container.querySelector('a[href="/broadcasts/new-draft"]')).not.toBeNull()
			expect(container.textContent).not.toContain('Broadcast sent successfully!')
			expect(api.createBroadcast).toHaveBeenCalledTimes(1)
			expect(api.sendBroadcast).toHaveBeenCalledTimes(1)
			expect(sendButton().disabled).toBe(false)
		}
	)

	it.each([
		[
			'en',
			`Send ${personal.name} to ${broadcastTarget.name} now`,
			`Edit personal template ${personal.name}`,
			'Use template',
		],
		[
			'de',
			`${personal.name} jetzt an ${broadcastTarget.name} senden`,
			`Persönliche Vorlage ${personal.name} bearbeiten`,
			'Vorlage verwenden',
		],
		[
			'ko',
			`${personal.name}을(를) ${broadcastTarget.name}에 지금 보내기`,
			`개인 템플릿 ${personal.name} 편집`,
			'템플릿 사용',
		],
		[
			'es-MX',
			`Enviar ${personal.name} a ${broadcastTarget.name} ahora`,
			`Editar plantilla personal ${personal.name}`,
			'Usar plantilla',
		],
	] as const)(
		'uses only icons with localized accessible labels for row actions in %s',
		async (locale, sendName, editName, useTitle) => {
			await setAppLocale(locale, { persistLocal: false })
			await mount('/broadcasts')
			const send = button(sendName)
			expect(send.getAttribute('title')).toBe(sendName)
			const edit = [...container.querySelectorAll('a')].find(
				(link) => link.getAttribute('aria-label') === editName
			)!
			expect(edit.getAttribute('title')).toBe(editName)
			expect(edit.getAttribute('href')).toBe(`${personalUrl}&editTemplate=true`)
			const use = [...container.querySelectorAll('a')].find(
				(link) => link.getAttribute('title') === useTitle
			)!
			const actions = use.closest('td')!.querySelectorAll('a, button')
			expect(actions).toHaveLength(4)
			for (const action of actions) {
				expect(action.textContent).toBe('')
				expect(action.getAttribute('aria-label')).toBeTruthy()
				expect(action.getAttribute('title')).toBeTruthy()
				expect(action.querySelector('svg')).not.toBeNull()
			}
			expectNoMutations()
		}
	)

	it.each([false, true])(
		'edits the saved template through the pencil action (custom: %s)',
		async (custom) => {
			if (custom) {
				savedTemplates = [
					{
						...personal,
						templateId: null,
						content: { message: 'Saved message', mentionLevel: 'none' },
					},
				]
				client.setQueryData(personalKey, savedTemplates)
			}
			await mount('/broadcasts')
			const edit = container.querySelector<HTMLAnchorElement>(
				`a[href="${personalUrl}&editTemplate=true"]`
			)!
			await flush(() => edit.click())
			expect(container.querySelector('h1')?.textContent).toBe('Edit personal template')
			expect(container.textContent).not.toContain('Send Broadcast')
			expect(container.textContent).not.toContain('Save as Draft')
			expect(container.textContent).not.toContain('Save personal template')
			await fill(custom ? 'message' : 'notes', 'Edited saved text')
			await fill('target', otherTarget.id)
			await flush(() => client.refetchQueries({ queryKey: personalKey }))
			expect(input(custom ? 'message' : 'notes').value).toBe('Edited saved text')
			await flush(() =>
				container
					.querySelector('form')!
					.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
			)
			expectNoMutations()
			await flush(() => button('Update personal template').click())
			expect(input('personal-template-name').value).toBe(personal.name)
			await fill('personal-template-name', 'Edited personal template')
			await flush(() => button('Save').click())
			await flush()
			expect(api.updatePersonalBroadcastTemplate).toHaveBeenCalledExactlyOnceWith(
				personal.id,
				expect.objectContaining({
					name: 'Edited personal template',
					targetId: otherTarget.id,
					templateId: custom ? null : requestedTemplate.id,
					content: expect.objectContaining({ [custom ? 'message' : 'notes']: 'Edited saved text' }),
				})
			)
			expect(api.createPersonalBroadcastTemplate).not.toHaveBeenCalled()
			expect(api.createBroadcast).not.toHaveBeenCalled()
			expect(api.sendBroadcast).not.toHaveBeenCalled()
			expect(api.updateBroadcastTemplate).not.toHaveBeenCalled()
			expect(router.state.location.pathname).toBe('/broadcasts')
			expect(container.textContent).toContain('Edited personal template')
		}
	)

	it('starts a fresh compose form when leaving personal edit mode for use mode', async () => {
		await mount(`${personalUrl}&editTemplate=true`)
		await fill('notes', 'Unsaved template edit')
		await flush(() => router.navigate(personalUrl))
		expect(input('notes').value).toBe(personal.content.notes)
		expect(button('Send Broadcast').disabled).toBe(false)
		expectNoMutations()
	})

	it('shows only personal presets and keeps unavailable ones removable', async () => {
		client.setQueryData(personalKey, [
			personal,
			{ ...personal, id: 'missing-target', name: 'Unavailable target preset', targetId: 'private' },
			{
				...personal,
				id: 'missing-template',
				name: 'Deleted template preset',
				templateId: 'deleted',
			},
		])
		await mount('/broadcasts')
		expect(
			container.querySelectorAll('a[href^="/broadcasts/new?personalTemplateId="]')
		).toHaveLength(3)
		expect(container.querySelector('a[href*="templateId=first"]')).toBeNull()
		expect(container.textContent).toContain('Unavailable target preset')
		expect(container.textContent).toContain('Template or target unavailable')
		expect(container.querySelectorAll('button[aria-label^="Send "]')).toHaveLength(1)
		expect(
			container.querySelector(
				'button[aria-label="Delete personal template Unavailable target preset"]'
			)
		).not.toBeNull()
		expectNoMutations()
	})

	it('loads a private shortcut asynchronously, restoring saved controls with a fresh SRP token', async () => {
		const saved = deferred<PersonalBroadcastTemplate[]>()
		const generateToken = vi.spyOn(srpTokens, 'generateSrpTokenAtFormLoad')
		client.removeQueries({ queryKey: personalKey })
		vi.mocked(api.getPersonalBroadcastTemplates).mockReturnValue(saved.promise)
		await mount(personalUrl)
		expect(container.textContent).toContain('Loading personal template')
		expect(container.querySelector('form')).toBeNull()
		await flush(() =>
			saved.resolve([{ ...personal, content: { ...personal.content, __srpToken: 'STALE-TOKEN' } }])
		)
		await flush()
		expect(input('template').value).toBe(requestedTemplate.id)
		expect(input('target').value).toBe(personal.targetId)
		expect(input('notes').value).toBe('Saved personal notes')
		expect(input('template-prefix-text').value).toBe('Saved before')
		expect(input('template-default-text').value).toBe('Saved after')
		expect(input('mentions').value).toBe('none')
		expect(container.textContent).toContain('Military')
		expect(container.textContent).not.toContain('STALE-TOKEN')
		expect(generateToken).toHaveBeenCalledTimes(1)
		await fill('notes', 'Edited notes')
		await flush(() => client.refetchQueries({ queryKey: personalKey }))
		await flush(() => client.refetchQueries({ queryKey: broadcastKeys.templates() }))
		expect(input('notes').value).toBe('Edited notes')
		expect(generateToken).toHaveBeenCalledTimes(1)
		expectNoMutations()
	})

	it('opens another personal shortcut and restores a custom-message preset', async () => {
		const custom = {
			...personal,
			id: 'custom-personal',
			name: 'Custom preset',
			templateId: null,
			targetId: otherTarget.id,
			content: { message: 'Saved custom message', mentionLevel: 'none' },
		}
		client.setQueryData(personalKey, [personal, custom])
		await mount(personalUrl)
		await fill('notes', 'Old notes')
		await flush(() => router.navigate('/broadcasts/new?personalTemplateId=custom-personal'))
		expect(input('template').value).toBe('custom')
		expect(input('target').value).toBe(otherTarget.id)
		expect(input('message').value).toBe('Saved custom message')
		expect(button('Send Broadcast').disabled).toBe(false)
		expectNoMutations()
	})

	it('preserves draft precedence over personal shortcuts', async () => {
		client.setQueryData(broadcastKeys.broadcast(composerDraft.id), composerDraft)
		client.setQueryData(scopedKey, [composerTemplate, requestedTemplate])
		await mount(`${personalUrl}&editTemplate=true&draftId=${composerDraft.id}`)
		expect(input('notes').value).toBe(composerDraft.content.notes)
		expect(container.textContent).toContain('ORIGINAL-TOKEN')
		expectNoMutations()
	})

	it('never displays another user’s cached presets after an account change', async () => {
		await mount('/broadcasts')
		expect(container.textContent).toContain(personal.name)
		vi.mocked(api.getPersonalBroadcastTemplates).mockResolvedValue([])
		await flush(() =>
			client.setQueryData(['auth', 'session'], {
				authenticated: true,
				user: { ...applicant, id: 'another-user' },
			})
		)
		await flush()
		expect(container.textContent).not.toContain(personal.name)
		expect(container.textContent).toContain('No personal templates yet')
	})

	it('rejects missing and inaccessible personal shortcut IDs without substituting globals', async () => {
		await mount('/broadcasts/new?personalTemplateId=another-users-template')
		expect(container.textContent).toContain('This personal template is unavailable')
		expect(container.querySelector('form')).toBeNull()
		expectNoMutations()
	})

	it('saves composer fields only after explicit confirmation without sending or modifying the global template', async () => {
		await mount()
		await fill('notes', 'Reusable notes')
		await fill('template-prefix-text', 'Personal prefix')
		await flush(() => button('Save personal template').click())
		expectNoMutations()
		await fill('personal-template-name', '  My own preset  ')
		await flush(() => button('Save').click())
		await flush()
		expect(api.createPersonalBroadcastTemplate).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				name: 'My own preset',
				templateId: requestedTemplate.id,
				targetId: broadcastTarget.id,
				content: expect.objectContaining({
					notes: 'Reusable notes',
					__prefixText: 'Personal prefix',
				}),
			})
		)
		expect(
			vi.mocked(api.createPersonalBroadcastTemplate).mock.calls[0]![0].content.__srpToken
		).toBeUndefined()
		expect(api.createBroadcast).not.toHaveBeenCalled()
		expect(api.sendBroadcast).not.toHaveBeenCalled()
		expect(api.updateBroadcastTemplate).not.toHaveBeenCalled()
		expect(router.state.location.pathname).toBe('/broadcasts')
		expect(container.textContent).toContain('My Templates')
		expect(container.textContent).toContain('My own preset')
	})

	it('enforces six in the UI while allowing an existing preset to be updated', async () => {
		savedTemplates = Array.from({ length: 6 }, (_, index) => ({
			...personal,
			id: index === 0 ? personal.id : `personal-${index}`,
		}))
		client.setQueryData(personalKey, savedTemplates)
		await mount(personalUrl)
		expect(button('Save personal template').disabled).toBe(true)
		expect(button('Update personal template').disabled).toBe(false)
		await fill('notes', 'Updated values')
		await flush(() => button('Update personal template').click())
		await fill('personal-template-name', 'Renamed preset')
		await flush(() => button('Save').click())
		await flush()
		expect(api.updatePersonalBroadcastTemplate).toHaveBeenCalledWith(
			personal.id,
			expect.objectContaining({
				name: 'Renamed preset',
				content: expect.objectContaining({ notes: 'Updated values' }),
			})
		)
		expect(api.createPersonalBroadcastTemplate).not.toHaveBeenCalled()
		expect(api.updateBroadcastTemplate).not.toHaveBeenCalled()
		expect(api.sendBroadcast).not.toHaveBeenCalled()
		expect(savedTemplates).toHaveLength(6)
		expect(router.state.location.pathname).toBe('/broadcasts')
		expect(container.textContent).toContain('Renamed preset')
	})

	it.each([
		['Save personal template', 'createPersonalBroadcastTemplate'],
		['Update personal template', 'updatePersonalBroadcastTemplate'],
	] as const)('keeps the composer and dialog available when %s fails', async (action, method) => {
		vi.mocked(api[method]).mockRejectedValueOnce(new Error('Save failed'))
		await mount(personalUrl)
		await fill('notes', 'Keep my changes')
		await flush(() => button(action).click())
		await fill('personal-template-name', 'Keep my name')
		await flush(() => button('Save').click())
		await flush()
		expect(router.state.location.pathname).toBe('/broadcasts/new')
		expect(input('notes').value).toBe('Keep my changes')
		expect(input('personal-template-name').value).toBe('Keep my name')
		expect(document.body.textContent).toContain('Could not save your personal template.')
		expect(button('Save').disabled).toBe(false)
		expect(api.createBroadcast).not.toHaveBeenCalled()
		expect(api.sendBroadcast).not.toHaveBeenCalled()
	})

	it('requires confirmation to delete a personal template and frees a slot', async () => {
		await mount('/broadcasts')
		await flush(() =>
			container
				.querySelector<HTMLButtonElement>(
					`button[aria-label="Delete personal template ${personal.name}"]`
				)!
				.click()
		)
		expect(api.deletePersonalBroadcastTemplate).not.toHaveBeenCalled()
		await flush(() => button('Delete').click())
		await flush()
		expect(api.deletePersonalBroadcastTemplate).toHaveBeenCalledExactlyOnceWith(personal.id)
		expect(container.textContent).toContain('No personal templates yet')
		expect(api.sendBroadcast).not.toHaveBeenCalled()
	})

	it.each([
		['en', 'Save personal template', 'Name', 'Save', 'Only you can see this template.'],
		[
			'de',
			'Persönliche Vorlage speichern',
			'Name',
			'Speichern',
			'Nur du kannst diese Vorlage sehen.',
		],
		['ko', '개인 템플릿 저장', '이름', '저장', '이 템플릿은 본인에게만 표시됩니다.'],
		[
			'es-MX',
			'Guardar plantilla personal',
			'Nombre',
			'Guardar',
			'Solo tú puedes ver esta plantilla.',
		],
	] as const)(
		'localizes personal template creation in %s',
		async (locale, action, name, save, description) => {
			await setAppLocale(locale, { persistLocal: false })
			await mount()
			await flush(() => button(action).click())
			expect(document.body.textContent).toContain(description)
			expect(document.querySelector('label[for="personal-template-name"]')!.textContent).toBe(name)
			expect(button(save).disabled).toBe(true)
			expect(document.body.textContent).not.toContain('broadcasts.personal.')
			expectNoMutations()
		}
	)
})
