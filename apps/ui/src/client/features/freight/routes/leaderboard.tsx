import { Package, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { useFreightLeaderboard } from '@/hooks/useFreightContracts'
import { usePageTitle } from '@/hooks/usePageTitle'

import { formatNumber } from '../utils'

function getRankDisplay(rank: number): React.ReactNode {
    switch (rank) {
        case 1:
            return <span className="text-yellow-400 text-lg font-bold">🥇</span>
        case 2:
            return <span className="text-gray-300 text-lg font-bold">🥈</span>
        case 3:
            return <span className="text-amber-600 text-lg font-bold">🥉</span>
        default:
            return <span className="text-muted-foreground">{rank}</span>
    }
}

export default function FreightLeaderboardPage() {
    usePageTitle('Freight Leaderboard')

    const [period, setPeriod] = useState<'30d' | 'all'>('30d')
    const { data: entries, isLoading } = useFreightLeaderboard(period)

    const byContracts = useMemo(
        () =>
            entries
                ? [...entries]
                    .sort((a, b) => b.contractsCompleted - a.contractsCompleted)
                    .slice(0, 10)
                : [],
        [entries]
    )

    const byVolume = useMemo(
        () =>
            entries
                ? [...entries]
                    .sort((a, b) => Number(b.totalVolume) - Number(a.totalVolume))
                    .slice(0, 10)
                : [],
        [entries]
    )

    const isEmpty = !entries || entries.length === 0

    return (
        <Container size="wide">
            <div className="mb-section md:mb-10 flex items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold gradient-text">Freight Leaderboard</h1>
                    <p className="text-muted-foreground mt-1">
                        Top haulers by completed courier contracts
                    </p>
                </div>
                <div className="flex rounded-md border overflow-hidden shrink-0">
                    <button
                        onClick={() => setPeriod('30d')}
                        className={`px-4 py-1.5 text-sm font-medium transition-colors ${period === '30d' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                    >
                        Last 30 Days
                    </button>
                    <button
                        onClick={() => setPeriod('all')}
                        className={`px-4 py-1.5 text-sm font-medium transition-colors ${period === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                    >
                        All Time
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {[0, 1].map((i) => (
                        <Card key={i}>
                            <CardContent className="p-6">
                                <div className="space-y-4">
                                    {[...Array(5)].map((_, j) => (
                                        <div key={j} className="h-12 animate-pulse rounded-md bg-muted" />
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : isEmpty ? (
                <div className="rounded-lg border border-dashed p-12 text-center">
                    <Trophy className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                    <p className="text-muted-foreground">
                        No completed contracts yet — be the first!
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Trophy className="h-5 w-5 text-yellow-400" />
                                <h2 className="text-lg font-semibold">Most Contracts</h2>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-hidden rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/50">
                                            <TableHead className="w-16 text-center font-semibold">Rank</TableHead>
                                            <TableHead className="font-semibold">Hauler</TableHead>
                                            <TableHead className="text-right font-semibold">Completed</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {byContracts.map((entry, index) => (
                                            <TableRow
                                                key={entry.acceptorId}
                                                className={index < 3 ? 'bg-muted/20' : undefined}
                                            >
                                                <TableCell className="text-center">
                                                    {getRankDisplay(index + 1)}
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    {entry.acceptorName ?? entry.acceptorId}
                                                </TableCell>
                                                <TableCell className="text-right font-mono">
                                                    {entry.contractsCompleted}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Package className="h-5 w-5 text-blue-400" />
                                <h2 className="text-lg font-semibold">Most Volume Moved</h2>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-hidden rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/50">
                                            <TableHead className="w-16 text-center font-semibold">Rank</TableHead>
                                            <TableHead className="font-semibold">Hauler</TableHead>
                                            <TableHead className="text-right font-semibold">Volume (m³)</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {byVolume.map((entry, index) => (
                                            <TableRow
                                                key={entry.acceptorId}
                                                className={index < 3 ? 'bg-muted/20' : undefined}
                                            >
                                                <TableCell className="text-center">
                                                    {getRankDisplay(index + 1)}
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    {entry.acceptorName ?? entry.acceptorId}
                                                </TableCell>
                                                <TableCell className="text-right font-mono">
                                                    {formatNumber(entry.totalVolume)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </Container>
    )
}
