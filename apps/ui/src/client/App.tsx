import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/layout'
import LandingPage from './routes/landing'
import AuthCallbackPage from './routes/auth-callback'
import ClaimMainPage from './routes/claim-main'
import DashboardPage from './routes/dashboard'

// Create a client
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 1000 * 60 * 5, // 5 minutes
			retry: 1,
			refetchOnWindowFocus: false,
		},
	},
})

export default function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<Routes>
					{/* Public routes */}
					<Route path="/" element={<LandingPage />} />
					<Route path="/auth/callback" element={<AuthCallbackPage />} />
					<Route path="/claim-main" element={<ClaimMainPage />} />

					{/* Protected routes with layout */}
					<Route element={<Layout />}>
						<Route path="/dashboard" element={<DashboardPage />} />
					</Route>
				</Routes>
			</BrowserRouter>
		</QueryClientProvider>
	)
}
