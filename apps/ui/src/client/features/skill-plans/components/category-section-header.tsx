interface CategorySectionHeaderProps {
	name: string
}

export function CategorySectionHeader({ name }: CategorySectionHeaderProps) {
	return (
		<div className="mb-4 mt-6 first:mt-0">
			<h3 className="text-2xl font-semibold">{name}</h3>
		</div>
	)
}
