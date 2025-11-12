/**
 * EFT Preview Component
 *
 * Displays a parsed EFT (EVE Fitting Tool) format fitting
 * Shows ship name, fitting name, and item breakdown
 */

import { Package, Ship } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

import { parseEFTPreview } from '../utils'

interface EftPreviewProps {
	eftString: string
}

export function EftPreview({ eftString }: EftPreviewProps) {
	const parsed = parseEFTPreview(eftString)

	if (!parsed) {
		return (
			<Card className="border-destructive">
				<CardHeader>
					<CardTitle className="text-destructive">Invalid EFT Format</CardTitle>
					<CardDescription>
						Unable to parse the provided EFT string. Please check the format.
					</CardDescription>
				</CardHeader>
			</Card>
		)
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-2">
					<Ship className="h-5 w-5 text-primary" />
					<div>
						<CardTitle>{parsed.fittingName}</CardTitle>
						<CardDescription>{parsed.shipName}</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Fitted Modules */}
				{parsed.modules.length > 0 && (
					<div>
						<h4 className="text-sm font-semibold mb-2">Fitted Modules ({parsed.modules.length})</h4>
						<div className="space-y-1">
							{parsed.modules.map((module, index) => (
								<div key={index} className="text-sm text-muted-foreground pl-4">
									• {module}
								</div>
							))}
						</div>
					</div>
				)}

				{/* Separator if both sections exist */}
				{parsed.modules.length > 0 && parsed.cargo.length > 0 && <Separator />}

				{/* Cargo/Ammo */}
				{parsed.cargo.length > 0 && (
					<div>
						<div className="flex items-center gap-2 mb-2">
							<Package className="h-4 w-4" />
							<h4 className="text-sm font-semibold">Cargo ({parsed.cargo.length} types)</h4>
						</div>
						<div className="space-y-1">
							{parsed.cargo.map((item, index) => (
								<div key={index} className="text-sm text-muted-foreground pl-4">
									• {item.name} x{item.quantity.toLocaleString()}
								</div>
							))}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	)
}
