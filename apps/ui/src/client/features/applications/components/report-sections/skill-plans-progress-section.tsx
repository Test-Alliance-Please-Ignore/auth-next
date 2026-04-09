/**
 * Skill Plans Progress Section
 *
 * Shows a character's progress against all published skill plans.
 * At-a-glance grid view with expandable detail per plan.
 */

import { useQueries, useQuery } from '@tanstack/react-query'
import {
    AlertCircle,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    XCircle,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { skillPlansApi } from '../../../skill-plans/api'
import { skillPlanKeys } from '../../../skill-plans/hooks'

import type { CharacterProgress, SkillPlan } from '../../../skill-plans/types'

// ============================================================================
// Helpers
// ============================================================================

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']

const SKILL_GRID_COLS = 'grid-cols-[1fr_4rem_4rem_5.5rem_3rem]'

// ============================================================================
// At-a-glance plan card
// ============================================================================

function PlanProgressCard({
    plan,
    progress,
    isLoading,
    error,
    isExpanded,
    onToggle,
}: {
    plan: SkillPlan
    progress?: CharacterProgress
    isLoading: boolean
    error: Error | null
    isExpanded: boolean
    onToggle: () => void
}) {
    const pctRequired = progress?.percentageRequired ?? 0
    const pctRecommended = progress?.percentageRecommended ?? 0

    // Status color
    const statusColor =
        pctRequired >= 100
            ? pctRecommended >= 100
                ? 'border-green-500/50'
                : 'border-yellow-500/50'
            : pctRequired >= 75
                ? 'border-amber-500/50'
                : 'border-muted'

    const categoryNames = plan.categories?.map((c) => c.name).join(', ')

    return (
        <Card
            variant="flat"
            className={cn('transition-colors border-l-4', statusColor)}
        >
            <button
                type="button"
                onClick={onToggle}
                className="w-full text-left"
            >
                <CardContent className="py-3 px-4">
                    {isLoading ? (
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-40" />
                            <Skeleton className="h-2 w-full" />
                            <Skeleton className="h-3 w-24" />
                        </div>
                    ) : error ? (
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium">{plan.name}</p>
                                <p className="text-xs text-destructive">Failed to load progress</p>
                            </div>
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0">
                                    <p className="text-sm font-medium truncate">{plan.name}</p>
                                    {categoryNames && (
                                        <Badge variant="secondary" className="text-xs shrink-0">
                                            {categoryNames}
                                        </Badge>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {pctRequired >= 100 ? (
                                        pctRecommended >= 100 ? (
                                            <Badge variant="default" className="text-xs gap-1">
                                                <CheckCircle2 className="h-3 w-3" />
                                                Fully Trained
                                            </Badge>
                                        ) : (
                                            <Badge variant="secondary" className="text-xs gap-1">
                                                <CheckCircle2 className="h-3 w-3" />
                                                Meets Required
                                            </Badge>
                                        )
                                    ) : pctRequired >= 75 ? (
                                        <Badge variant="secondary" className="text-xs gap-1">
                                            <AlertCircle className="h-3 w-3" />
                                            Almost Ready
                                        </Badge>
                                    ) : (
                                        <Badge variant="destructive" className="text-xs gap-1">
                                            <XCircle className="h-3 w-3" />
                                            Training Needed
                                        </Badge>
                                    )}
                                    {isExpanded ? (
                                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    )}
                                </div>
                            </div>

                            {/* Compact progress bars */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-0.5">
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                        <span>Required</span>
                                        <span>{pctRequired.toFixed(0)}%</span>
                                    </div>
                                    <Progress value={pctRequired} className="h-1.5" />
                                </div>
                                <div className="space-y-0.5">
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                        <span>Recommended</span>
                                        <span>{pctRecommended.toFixed(0)}%</span>
                                    </div>
                                    <Progress value={pctRecommended} className="h-1.5" />
                                </div>
                            </div>

                            <div className="text-xs text-muted-foreground">
                                {progress?.completedRequired ?? 0}/{progress?.totalSkills ?? 0} required
                                {' • '}
                                {progress?.completedRecommended ?? 0}/{progress?.totalSkills ?? 0} recommended
                            </div>
                        </div>
                    )}
                </CardContent>
            </button>

            {/* Expanded detail */}
            {isExpanded && progress && (
                <div className="border-t px-4 py-3 space-y-3">
                    {/* Skill breakdown table */}
                    <div className="rounded border">
                        <div className={cn('grid gap-x-3 px-3 py-1.5 border-b bg-muted/30 text-xs font-medium text-muted-foreground', SKILL_GRID_COLS)}>
                            <span>Skill</span>
                            <span className="text-center">Current</span>
                            <span className="text-center">Required</span>
                            <span className="text-center">Rec.</span>
                            <span className="text-center">Status</span>
                        </div>
                        <div className="max-h-80 overflow-y-auto divide-y divide-border/50">
                            {(progress.skills || []).map((skill) => (
                                <div
                                    key={skill.skillId}
                                    className={cn(
                                        'grid gap-x-3 px-3 py-1.5 text-sm items-center',
                                        SKILL_GRID_COLS,
                                        skill.meetsRecommended
                                            ? 'text-muted-foreground'
                                            : 'text-foreground',
                                    )}
                                >
                                    <span className="truncate">{skill.skillName}</span>
                                    <span className="text-center tabular-nums">
                                        {ROMAN[skill.currentLevel] || '—'}
                                    </span>
                                    <span className="text-center tabular-nums">
                                        {ROMAN[skill.requiredLevel]}
                                    </span>
                                    <span className="text-center tabular-nums">
                                        {ROMAN[skill.recommendedLevel]}
                                    </span>
                                    <span className="text-center">
                                        {skill.meetsRecommended ? (
                                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mx-auto" />
                                        ) : skill.meetsRequired ? (
                                            <AlertCircle className="h-3.5 w-3.5 text-yellow-500 mx-auto" />
                                        ) : (
                                            <XCircle className="h-3.5 w-3.5 text-red-500 mx-auto" />
                                        )}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </Card>
    )
}

// ============================================================================
// Main Component
// ============================================================================

interface SkillPlansProgressSectionProps {
    characterId: string
}

export function SkillPlansProgressSection({ characterId }: SkillPlansProgressSectionProps) {
    const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null)
    const [search, setSearch] = useState('')

    // Fetch all published plans
    const { data: plansResponse, isLoading: plansLoading } = useQuery({
        queryKey: ['skill-plans', 'published-list'],
        queryFn: () => skillPlansApi.getPlans({ published: true }, { limit: 200 }),
        staleTime: 1000 * 60 * 5,
    })

    const plans = plansResponse?.items ?? []

    // Filter plans by search
    const filteredPlans = useMemo(() => {
        if (!search.trim()) return plans
        const lower = search.toLowerCase()
        return plans.filter(
            (p) =>
                p.name.toLowerCase().includes(lower) ||
                p.categories?.some((c) => c.name.toLowerCase().includes(lower)),
        )
    }, [plans, search])

    // Fetch progress for each plan × this character
    const progressQueries = useQueries({
        queries: plans.map((plan) => ({
            queryKey: skillPlanKeys.progress(plan.id, characterId),
            queryFn: () => skillPlansApi.checkCharacterProgress(plan.id, characterId),
            staleTime: 1000 * 60 * 2,
            enabled: !!characterId && plans.length > 0,
        })),
    })

    if (plansLoading) {
        return (
            <div className="space-y-3">
                <Skeleton className="h-6 w-48" />
                {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                ))}
            </div>
        )
    }

    if (plans.length === 0) {
        return (
            <p className="text-sm text-muted-foreground py-4">
                No published skill plans available.
            </p>
        )
    }

    // Summary counts
    const loadedCount = progressQueries.filter((q) => q.data).length
    const fullyTrainedCount = progressQueries.filter(
        (q) => q.data && q.data.percentageRecommended >= 100,
    ).length
    const meetsRequiredCount = progressQueries.filter(
        (q) => q.data && q.data.percentageRequired >= 100 && q.data.percentageRecommended < 100,
    ).length
    const needsTrainingCount = loadedCount - fullyTrainedCount - meetsRequiredCount

    return (
        <div className="space-y-4">
            {/* Summary */}
            <div className="grid gap-4 sm:grid-cols-3">
                <Card variant="flat">
                    <CardContent className="py-3">
                        <p className="text-xs text-muted-foreground">Fully Trained</p>
                        <p className="text-lg font-bold text-green-500">{fullyTrainedCount}</p>
                    </CardContent>
                </Card>
                <Card variant="flat">
                    <CardContent className="py-3">
                        <p className="text-xs text-muted-foreground">Meets Required</p>
                        <p className="text-lg font-bold text-yellow-500">{meetsRequiredCount}</p>
                    </CardContent>
                </Card>
                <Card variant="flat">
                    <CardContent className="py-3">
                        <p className="text-xs text-muted-foreground">Needs Training</p>
                        <p className="text-lg font-bold text-red-500">{needsTrainingCount}</p>
                    </CardContent>
                </Card>
            </div>

            {/* Search + Plan cards */}
            <Input
                placeholder="Search skill plans..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-sm"
            />
            <div className="space-y-2">
                {filteredPlans.length === 0 && search && (
                    <p className="text-sm text-muted-foreground py-2">No plans matching "{search}"</p>
                )}
                {filteredPlans.map((plan) => {
                    const index = plans.indexOf(plan)
                    const query = progressQueries[index]
                    return (
                        <PlanProgressCard
                            key={plan.id}
                            plan={plan}
                            progress={query?.data}
                            isLoading={query?.isPending ?? true}
                            error={query?.error ?? null}
                            isExpanded={expandedPlanId === plan.id}
                            onToggle={() =>
                                setExpandedPlanId(expandedPlanId === plan.id ? null : plan.id)
                            }
                        />
                    )
                })}
            </div>
        </div>
    )
}
