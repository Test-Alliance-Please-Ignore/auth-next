import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingPage } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/hooks/useAuth'
import { apiClient } from '@/lib/api'
import toast from '@/lib/toast'

export default function PasteViewPage() {
	const { id = '' } = useParams<{ id: string }>()
	const { isAuthenticated } = useAuth()
	const [password, setPassword] = useState('')
	const viewQuery = useQuery({
		queryKey: ['paste', 'view', id, isAuthenticated],
		queryFn: async () => {
			if (isAuthenticated) {
				return apiClient.getPasteForAlliance(id)
			}
			return apiClient.getPasteForPublic(id)
		},
		enabled: !!id,
		retry: false,
		meta: { suppressErrorToast: true },
	})

	const decryptMutation = useMutation({
		mutationFn: () =>
			isAuthenticated
				? apiClient.decryptPasteForAlliance(id, password)
				: apiClient.decryptPasteForPublic(id, password),
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : 'Invalid password or unavailable paste')
		},
	})

	const data = decryptMutation.data ?? viewQuery.data
	const decryptedPublicTitle =
		!isAuthenticated && decryptMutation.data?.content && decryptMutation.data?.paste?.name?.trim()
			? decryptMutation.data.paste.name
			: null
	const pageTitle = isAuthenticated
		? data?.paste?.name?.trim() || 'Paste'
		: decryptedPublicTitle || 'Paste'

	if (viewQuery.isLoading) {
		return <LoadingPage label="Loading paste..." />
	}

	return (
		<Container className="space-y-4 min-h-[calc(100vh-8rem)]">
			<PageHeader title={pageTitle} />
			{viewQuery.isError ? (
				<div className="flex min-h-[calc(100vh-18rem)] items-center justify-center">
					<Card className="w-full max-w-sm">
						<CardHeader className="text-center">
							<CardTitle>{isAuthenticated ? 'Paste Unavailable' : '404 Not Found'}</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							<p className="text-center text-sm text-muted-foreground">
								{isAuthenticated
									? 'This paste could not be loaded.'
									: 'The requested paste was not found.'}
							</p>
						</CardContent>
					</Card>
				</div>
			) : null}
			{data?.requiresPassword ? (
				<div className="flex min-h-[calc(100vh-18rem)] items-center justify-center">
					<Card className="w-full max-w-sm">
					<CardHeader>
						<CardTitle>Password Required</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<Label>Password</Label>
						<div className="flex items-center gap-2">
							<Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
							<Button onClick={() => decryptMutation.mutate()} disabled={decryptMutation.isPending || !password}>
								{decryptMutation.isPending ? 'Accessing...' : 'Access'}
							</Button>
						</div>
					</CardContent>
					</Card>
				</div>
			) : null}
			{!viewQuery.isError && data?.content ? (
				<Card className="mt-4">
					<CardContent className="pt-6">
						<pre className="overflow-x-auto text-sm whitespace-pre-wrap">{data.content}</pre>
					</CardContent>
				</Card>
			) : null}
		</Container>
	)
}
