import {
	AlertTriangle,
	CheckCircle,
	Clock,
	Info,
	Shield,
	Sparkles,
	Star,
	XCircle,
	Zap,
} from 'lucide-react'
import { useState } from 'react'

import { renderDiscordContentValue } from '@/components/discord-content-renderer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { usePageTitle } from '@/hooks/usePageTitle'

// ─── Demo data ────────────────────────────────────────────────────────────────

const BASIC_OPTIONS = [
	{ value: 'alpha', label: 'Alpha Corp' },
	{ value: 'beta', label: 'Beta Industries' },
	{ value: 'gamma', label: 'Gamma Holdings' },
	{ value: 'delta', label: 'Delta Logistics' },
	{ value: 'epsilon', label: 'Epsilon Technologies' },
]

const SEARCHABLE_OPTIONS = [
	{ value: '1', label: 'Caldari State', description: 'Faction' },
	{ value: '2', label: 'Gallente Federation', description: 'Faction' },
	{ value: '3', label: 'Amarr Empire', description: 'Faction' },
	{ value: '4', label: 'Minmatar Republic', description: 'Faction' },
	{ value: '5', label: 'Jita IV-4', description: 'Station' },
	{ value: '6', label: 'Dodixie IX-20', description: 'Station' },
	{ value: '7', label: 'Amarr VIII', description: 'Station' },
	{ value: '8', label: 'Rens VI-8', description: 'Station' },
]

async function asyncSearchDelegate(query: string) {
	await new Promise((r) => setTimeout(r, 200))
	return SEARCHABLE_OPTIONS.filter(
		(o) =>
			o.label.toLowerCase().includes(query.toLowerCase()) ||
			o.description?.toLowerCase().includes(query.toLowerCase())
	)
}

const DISCORD_SAMPLES = [
	{
		label: 'Inline formatting',
		value:
			'**Bold text**, *italic*, __underline__, ~~strikethrough~~, and `inline code` all supported.',
	},
	{
		label: 'Headings',
		value: '# Heading 1\n## Heading 2\n### Heading 3\n-# Small subheading',
	},
	{
		label: 'Lists',
		value:
			'- First item\n- Second item\n- Third item\n\n1. Ordered one\n2. Ordered two\n3. Ordered three',
	},
	{
		label: 'Block quote',
		value: '> Single line quote\n\nSome text after.',
	},
	{
		label: 'Multi-line quote',
		value: '>>> This entire block\nis a multi-line\nblock quote.',
	},
	{
		label: 'Code block',
		value: '```\nconst x = 42\nconsole.log(x)\n```',
	},
	{
		label: 'Discord timestamps',
		value: 'Event starts <t:1700000000:F> — that is <t:1700000000:R> from the epoch.',
	},
	{
		label: 'ISO timestamps',
		value: 'Recorded at 2025-03-07T12:00:00Z during the op.',
	},
	{
		label: 'Mixed content',
		value:
			'# Fleet Doctrine Update\n\n**Effective immediately**, all pilots must refit to the **Cerberus** doctrine.\n\n## Requirements\n- HAC V or higher\n- T2 Heavy Missiles\n- Prop mod: `50MN Microwarpdrive II`\n\n> Check the doctrine channel for fits.\n\nQuestions? Ask in <#fleet-coordination>.',
	},
]

// ─── Layout helpers ───────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
	return (
		<h2 className="text-lg font-semibold text-foreground border-b border-border pb-2 mb-4">
			{children}
		</h2>
	)
}

function SubHeading({ children }: { children: React.ReactNode }) {
	return <h3 className="text-sm font-medium text-muted-foreground mb-2">{children}</h3>
}

function Row({ children }: { children: React.ReactNode }) {
	return <div className="flex flex-wrap items-center gap-3 mb-4">{children}</div>
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DevComponentsPage() {
	usePageTitle('Dev — Component Showcase')

	const [selectValue, setSelectValue] = useState<string>('')
	const [searchableValue, setSearchableValue] = useState<string>('')
	const [asyncValue, setAsyncValue] = useState<string>('')

	return (
		<div className="container mx-auto py-8 space-y-10 max-w-5xl">
			<div>
				<h1 className="text-2xl font-bold text-foreground">Component Showcase</h1>
				<p className="text-muted-foreground text-sm mt-1">
					Visual reference for all custom UI component variants and states.
				</p>
			</div>

			{/* ── Buttons ─────────────────────────────────────────────────── */}
			<Card>
				<CardHeader>
					<CardTitle>Buttons</CardTitle>
				</CardHeader>
				<CardContent className="space-y-6">
					<div>
						<SectionHeading>Variants</SectionHeading>
						<Row>
							<Button variant="primary">Primary</Button>
							<Button variant="ghost">Ghost</Button>
							<Button variant="confirm">Confirm</Button>
							<Button variant="cancel">Cancel</Button>
							<Button variant="destructive">Destructive</Button>
							<Button variant="danger">Danger</Button>
							<Button variant="success">Success</Button>
							<Button variant="secondary">Secondary</Button>
							<Button variant="special">Special</Button>
							<Button variant="link">Link</Button>
						</Row>
					</div>

					<div>
						<SectionHeading>Sizes</SectionHeading>
						<Row>
							<Button variant="primary" size="lg">Large</Button>
							<Button variant="primary" size="default">Default</Button>
							<Button variant="primary" size="sm">Small</Button>
							<Button variant="primary" size="icon">★</Button>
						</Row>
					</div>

					<div>
						<SectionHeading>States</SectionHeading>
						<SubHeading>Loading</SubHeading>
						<Row>
							<Button variant="primary" loading>Primary Loading</Button>
							<Button variant="ghost" loading>Ghost Loading</Button>
							<Button variant="confirm" loading loadingText="Saving…">With Text</Button>
							<Button variant="danger" loading>Danger Loading</Button>
						</Row>
						<SubHeading>Disabled</SubHeading>
						<Row>
							<Button variant="primary" disabled>Primary</Button>
							<Button variant="ghost" disabled>Ghost</Button>
							<Button variant="confirm" disabled>Confirm</Button>
							<Button variant="danger" disabled>Danger</Button>
						</Row>
						<SubHeading>With default icon</SubHeading>
						<Row>
							<Button variant="confirm" showIcon>Confirm</Button>
							<Button variant="cancel" showIcon>Cancel</Button>
							<Button variant="destructive" showIcon>Destructive</Button>
							<Button variant="danger" showIcon>Danger</Button>
							<Button variant="success" showIcon>Success</Button>
						</Row>
					</div>
				</CardContent>
			</Card>

			{/* ── Badges ──────────────────────────────────────────────────── */}
			<Card>
				<CardHeader>
					<CardTitle>Badges</CardTitle>
				</CardHeader>
				<CardContent className="space-y-6">
					<div>
						<SectionHeading>Variants</SectionHeading>
						<Row>
							<Badge variant="default">Default</Badge>
							<Badge variant="secondary">Secondary</Badge>
							<Badge variant="success">Success</Badge>
							<Badge variant="warning">Warning</Badge>
							<Badge variant="destructive">Destructive</Badge>
							<Badge variant="ghost">Ghost</Badge>
							<Badge variant="special">Special</Badge>
						</Row>
					</div>

					<div>
						<SectionHeading>With icons</SectionHeading>
						<SubHeading>Left icon (default)</SubHeading>
						<Row>
							<Badge variant="default" icon={Star}>Default</Badge>
							<Badge variant="success" icon={CheckCircle}>Success</Badge>
							<Badge variant="warning" icon={AlertTriangle}>Warning</Badge>
							<Badge variant="destructive" icon={XCircle}>Destructive</Badge>
							<Badge variant="ghost" icon={Clock}>Ghost</Badge>
							<Badge variant="secondary" icon={Sparkles}>Secondary</Badge>
							<Badge variant="special" icon={Zap}>Special</Badge>
						</Row>
						<SubHeading>Right icon</SubHeading>
						<Row>
							<Badge variant="success" icon={CheckCircle} iconPosition="right">Verified</Badge>
							<Badge variant="warning" icon={AlertTriangle} iconPosition="right">Pending</Badge>
							<Badge variant="default" icon={Info} iconPosition="right">Info</Badge>
							<Badge variant="ghost" icon={Shield} iconPosition="right">Protected</Badge>
						</Row>
						<SubHeading>Icon only</SubHeading>
						<Row>
							<Badge variant="success" icon={CheckCircle} />
							<Badge variant="warning" icon={AlertTriangle} />
							<Badge variant="destructive" icon={XCircle} />
							<Badge variant="ghost" icon={Clock} />
							<Badge variant="default" icon={Star} />
						</Row>
					</div>

					<div>
						<SectionHeading>In context</SectionHeading>
						<SubHeading>Broadcast status</SubHeading>
						<Row>
							<Badge variant="ghost">Draft</Badge>
							<Badge variant="default">Scheduled</Badge>
							<Badge variant="warning">Sending</Badge>
							<Badge variant="success">Sent</Badge>
							<Badge variant="destructive">Failed</Badge>
						</Row>
						<SubHeading>DKP source type</SubHeading>
						<Row>
							<Badge variant="default">fleet</Badge>
							<Badge variant="success">market</Badge>
							<Badge variant="warning">mining</Badge>
							<Badge variant="special">manual</Badge>
							<Badge variant="destructive">adjustment</Badge>
						</Row>
						<SubHeading>Bill status</SubHeading>
						<Row>
							<Badge variant="secondary">Draft</Badge>
							<Badge variant="default">Issued</Badge>
							<Badge variant="success">Paid</Badge>
							<Badge variant="warning">Cancelled</Badge>
							<Badge variant="destructive">Overdue</Badge>
							<Badge variant="ghost">Unbilled</Badge>
						</Row>
						<SubHeading>Application status</SubHeading>
						<Row>
							<Badge variant="warning">Pending</Badge>
							<Badge variant="default">Under Review</Badge>
							<Badge variant="success">Accepted</Badge>
							<Badge variant="destructive">Rejected</Badge>
							<Badge variant="ghost">Withdrawn</Badge>
						</Row>
					</div>
				</CardContent>
			</Card>

			{/* ── Select ──────────────────────────────────────────────────── */}
			<Card>
				<CardHeader>
					<CardTitle>Select</CardTitle>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="grid gap-6 md:grid-cols-3">
						<div>
							<SectionHeading>Basic</SectionHeading>
							<Select
								options={BASIC_OPTIONS}
								value={selectValue}
								onValueChange={(v) => setSelectValue(v)}
								placeholder="Select a corporation…"
							/>
							{selectValue && (
								<p className="text-xs text-muted-foreground mt-2">Selected: {selectValue}</p>
							)}
						</div>

						<div>
							<SectionHeading>Searchable</SectionHeading>
							<Select
								options={SEARCHABLE_OPTIONS}
								value={searchableValue}
								onValueChange={(v) => setSearchableValue(v)}
								placeholder="Search locations…"
								searchable
							/>
							{searchableValue && (
								<p className="text-xs text-muted-foreground mt-2">Selected: {searchableValue}</p>
							)}
						</div>

						<div>
							<SectionHeading>Async search delegate</SectionHeading>
							<Select
								options={[]}
								value={asyncValue}
								onValueChange={(v) => setAsyncValue(v)}
								placeholder="Search factions & stations…"
								searchable
								searchDelegate={asyncSearchDelegate}
								minQueryLength={1}
								queryHintText="Type to search…"
							/>
							{asyncValue && (
								<p className="text-xs text-muted-foreground mt-2">Selected: {asyncValue}</p>
							)}
						</div>
					</div>

					<div>
						<SectionHeading>States</SectionHeading>
						<div className="flex flex-wrap gap-4">
							<div className="w-48">
								<SubHeading>Loading</SubHeading>
								<Select options={BASIC_OPTIONS} placeholder="Loading…" loading />
							</div>
							<div className="w-48">
								<SubHeading>Disabled</SubHeading>
								<Select options={BASIC_OPTIONS} placeholder="Disabled" disabled />
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* ── Discord Markdown ─────────────────────────────────────────── */}
			<Card>
				<CardHeader>
					<CardTitle>Discord Markdown Renderer</CardTitle>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="grid gap-4 md:grid-cols-2">
						{DISCORD_SAMPLES.map((sample, i) => (
							<div key={i} className="rounded-md border border-border bg-muted/10 p-4">
								<p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">
									{sample.label}
								</p>
								<div className="text-sm">
									{renderDiscordContentValue(sample.value, `sample-${i}`)}
								</div>
							</div>
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
