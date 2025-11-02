Overview

Build a comprehensive HR management system for EVE Online corporations with three core features:

Application System - Non-members apply to corporations, HR reviews/accepts

Recommendation System - Community members vouch for applicants

Notes System - HR admins add private notes to user profiles

Tech Stack:

Backend: Cloudflare Workers + Hono + Drizzle ORM + Neon PostgreSQL

Frontend: React + Vite + TanStack Query + Tailwind CSS + Radix UI

Design: EVE Online Caldari-themed component library (existing)

Database Schema

New Tables to Create:

1. applications

Stores corporation membership applications

Fields: id, corporationId, userId, characterId, characterName, applicationText, status, reviewedBy, reviewedAt, reviewNotes, createdAt, updatedAt

Status values: pending, under_review, accepted, rejected, withdrawn

Indexes: corporationId, userId, characterId, status, (corporationId + status composite)

2. application_recommendations

User recommendations for applications

Fields: id, applicationId, userId, characterId, characterName, recommendationText, sentiment, isPublic, createdAt, updatedAt

Sentiment values: positive, neutral, negative

Unique constraint: (applicationId, userId) - one recommendation per user per application

3. application_activity_log

Audit trail for all application actions

Fields: id, applicationId, userId, characterId, action, previousValue, newValue, metadata (JSONB), timestamp

Tracks: submissions, status changes, reviews, recommendations added, withdrawals

4. hr_notes

Private notes on users (HR/admin only)

Fields: id, subjectUserId, subjectCharacterId, authorId, authorCharacterId, authorCharacterName, noteText, noteType, priority, metadata (JSONB), createdAt, updatedAt

Note types: general, warning, positive, incident, background_check

Priority: low, normal, high, critical

5. hr_roles

HR role assignments per corporation

Fields: id, corporationId, userId, characterId, characterName, role, grantedBy, grantedAt, expiresAt, isActive, createdAt, updatedAt

Roles: hr_admin, hr_reviewer, hr_viewer

Unique constraint: (corporationId, userId)

Integration Points:

Foreign keys to existing users table

References to existing userCharacters table

Uses existing managedCorporations table

All tables in same PostgreSQL database as core worker

Authorization Model

Role Hierarchy:

Site Admin (is_admin = true in users table)

Full access to all HR features

Can manage HR roles for any corporation

Can view/edit/delete any application or note

Corporation HR Admin (hr_roles.role = 'hr_admin')

Accept/reject applications for their corp

Grant/revoke HR roles (reviewer, viewer) for their corp

View all applications and recommendations for their corp

View HR notes for applicants to their corp

Corporation HR Reviewer (hr_roles.role = 'hr_reviewer')

Change application status to under_review

Add review notes (advisory only)

Cannot accept/reject applications

Cannot view HR notes

Corporation HR Viewer (hr_roles.role = 'hr_viewer')

Read-only access to applications for their corp

Cannot change status or add review notes

Cannot view HR notes

Authenticated User

Submit applications

Add recommendations (except own applications)

View own applications

Withdraw own applications

Security Rules:

HR notes STRICTLY site-admin only

Validate character ownership before all actions

Validate corp membership via EVE Corporation Data DO before granting HR roles

Rate limiting: 5 applications/hour per user

All sensitive actions logged to activity log

API Endpoints

Applications

POST /applications

Submit new application

Auth: Authenticated user

Body: { corporationId, characterId, applicationText }

Validates: Character ownership, no pending application, corp is active

GET /applications

List applications (filtered by role)

Auth: Authenticated user

Query: corporationId, status, limit, offset

Returns: Paginated list with recommendation/note counts

GET /applications/:applicationId

Get application details with recommendations

Auth: Owner, HR role for corp, or site admin

Returns: Full application, recommendations, activity log (HR only)

PATCH /applications/:applicationId

Update status or review

Auth: Applicant (withdraw only), HR admin (accept/reject), Site admin (all)

Body: { status?, reviewNotes? }

Validates: Status transitions, role permissions

DELETE /applications/:applicationId

Permanently delete application

Auth: Site admin only

Recommendations

POST /applications/:applicationId/recommendations

Add recommendation

Auth: Authenticated user (cannot recommend own application)

Body: { characterId, recommendationText, sentiment, isPublic? }

Validates: One per user, application is pending/under_review

PATCH /applications/:applicationId/recommendations/:recommendationId

Update recommendation

Auth: Recommendation author or site admin

DELETE /applications/:applicationId/recommendations/:recommendationId

Delete recommendation

Auth: Recommendation author or site admin

HR Notes

POST /hr-notes

Create note about a user

Auth: Site admin only

Body: { subjectUserId, subjectCharacterId?, noteText, noteType, priority?, metadata? }

GET /hr-notes

List HR notes

Auth: Site admin only

Query: subjectUserId, noteType, priority, limit, offset

GET /hr-notes/user/:userId

Get all notes for specific user

Auth: Site admin only

Returns: Notes + application history summary

GET /hr-notes/:noteId

Get specific note

Auth: Site admin only

PATCH /hr-notes/:noteId

Update note

Auth: Site admin only

DELETE /hr-notes/:noteId

Delete note

Auth: Site admin only

HR Roles

POST /hr-roles

Grant HR role

Auth: Site admin or hr_admin for corporation

Body: { corporationId, userId, characterId, role, expiresAt? }

Validates: Character in corporation via EVE Corporation Data DO

GET /hr-roles

List HR roles

Auth: Site admin or HR role for corporation

Query: corporationId, userId, isActive

PATCH /hr-roles/:roleId

Update role level or deactivate

Auth: Site admin or hr_admin for corporation

DELETE /hr-roles/:roleId

Revoke role

Auth: Site admin or hr_admin for corporation

Frontend Components

Existing Components to Reuse:

Card system (default, elevated, interactive, flat variants)

Button variants (ConfirmButton, DestructiveButton, CancelButton)

Table system (full data table with sorting)

Dialog/Modal system

Badge components

Form components (Input, Label, Select, Switch)

MemberAvatar, Loading, Progress

New Components to Build:

Application Components:

ApplicationCard - Compact display for list view

ApplicationDetail - Full application view with tabs

ApplicationForm - Submission form with validation

ApplicationStatusBadge - Status indicator with colors

ApplicationTimeline - Status change history

ApplicationsTable - Data table with filters

ApplicationActionPanel - Accept/reject controls

Recommendation Components:

RecommendationCard - Single recommendation display

RecommendationList - All recommendations for application

AddRecommendationDialog - Modal form for adding

Notes Components:

HRNoteCard - Single note display

HRNotesList - Timeline view of notes

AddNoteDialog - Modal form for adding notes

UserNotesSummary - Compact notes overview

Generic Components:

Textarea - Multi-line input with character counter

DateRangePicker - Date range selection

EmptyState - No data / no permissions states

Pagination - List navigation

StatusTimeline - Generic timeline component

Pages/Routes:

Public/Applicant:

/corporations - Corporation listing

/corporations/:corporationId - Corp detail (public)

/applications/my-applications - User's applications

/applications/:applicationId - Application detail

Corporation HR (Protected):

/corporations/:corporationId/hr - HR dashboard

/corporations/:corporationId/hr/applications - Applications list

/corporations/:corporationId/hr/applications/:applicationId - Review page

/corporations/:corporationId/hr/notes - Notes dashboard

Admin:

/admin/users/:userId - Enhanced user detail with HR notes tab

/hr/notes - Global HR notes page

Implementation Phases

Phase 1: Backend Foundation (Week 1-2)

Tasks:

Create database schema and generate migrations

Implement ApplicationService

submitApplication()

updateApplicationStatus()

listApplications()

validateStatusTransition()

Implement HrRoleService

grantRole() with corp membership validation

revokeRole()

getUserRoles()

Build API endpoints for applications (POST, GET, PATCH, DELETE)

Implement authorization middleware (requireHrRole, canAccessApplication)

Add rate limiting

Write integration tests

Deliverables:

Working backend API for application management

All endpoints tested

Authorization enforced

Success Criteria:

✅ Can submit applications via API

✅ Can list/view applications with proper filtering

✅ Can accept/reject applications (HR only)

✅ All actions logged to activity log

✅ Tests passing

Phase 2: Basic Application UI (Week 2-3)

Tasks:

Create application form page

Character selector dropdown

Application text area with validation

Character counter

Submit with confirmation

Build applications list page (HR view)

ApplicationsTable component

Status filtering

Corporation filtering

Pagination

Create application detail page

Tabbed interface (Details, History)

Status badge

Withdraw button (applicant)

Build accept/reject dialogs

Confirmation with reason (reject)

Success/error feedback

Integrate with backend API using TanStack Query

useApplications hook

useSubmitApplication mutation

useAcceptApplication mutation

useRejectApplication mutation

Add routing and navigation

Deliverables:

End-to-end application flow working

Applicants can submit and track

HR can review and decide

Success Criteria:

✅ Form submission works with validation

✅ Applications list displays correctly with filters

✅ HR can accept/reject applications

✅ Status updates in real-time (optimistic)

✅ Mobile responsive

Phase 3: Recommendation System (Week 3-4)

Tasks:

Backend implementation

Add recommendation endpoints (POST, PATCH, DELETE)

Implement RecommendationService

Add validation (one per user, status checks)

Create AddRecommendationDialog

Sentiment selector (positive/neutral/negative)

Textarea with validation

Character selector

Build RecommendationCard component

Display recommender info

Show sentiment badge

Timestamp

Create RecommendationList component

List all recommendations

Sort by date

Empty state

Integrate into ApplicationDetail page

Recommendations tab

Add recommendation button (if allowed)

Recommendation count badge

Add recommendation count to ApplicationCard

Implement useRecommendations and useAddRecommendation hooks

Deliverables:

Members can recommend applicants

Recommendations visible to HR

Recommendation count shows on applications

Success Criteria:

✅ Can add recommendation from application detail

✅ Recommendations display correctly

✅ Cannot recommend own application (validation)

✅ One recommendation per user enforced

✅ HR sees all recommendations

Phase 4: Notes System (Week 4-5)

Tasks:

Backend implementation

Add hr_notes table and endpoints

Implement HrNotesService

Strict admin-only authorization

Create HRNoteCard component

Note content display

Author info

Timestamp

Type badge

Priority indicator

Build AddNoteDialog

Rich textarea

Note type selector

Priority selector

Tag system (optional)

Create HRNotesList component

Timeline view

Filter by type/author/date

Pagination

Add notes section to UserDetailPage (admin only)

New "HR Notes" tab

Add note button

Note history

Build global HR notes page (/hr/notes)

Search users

Filter notes

Recent activity

Implement useHRNotes and useAddHRNote hooks

Add permission checks throughout UI

Deliverables:

HR admins can add private notes

Notes only visible to admins

Notes integrated into user profiles

Success Criteria:

✅ Can add notes to user profiles

✅ Notes visible only to site admins

✅ Notes display in timeline format

✅ Can filter and search notes

✅ Notes never leak to non-admin users

Phase 5: HR Role Management (Week 5-6)

Tasks:

Complete backend HR role endpoints

Implement corp membership validation

Integration with EVE Corporation Data DO

Validate character in corp before granting role

Build HR role management UI

Role assignment dialog

Role list/table

Role revoke confirmation

Create HR dashboard

Key metrics (pending apps, acceptance rate)

Recent activity

Quick actions

Add role checks across all HR features

Implement useHRRoles hooks

Add role badges to user profiles

Deliverables:

Site admins can manage HR roles

HR admins can grant reviewer/viewer roles

Role-based access enforced everywhere

Success Criteria:

✅ Can assign HR roles to corp members

✅ Roles validated against corp membership

✅ Role hierarchy enforced (admin > reviewer > viewer)

✅ Dashboard shows relevant metrics

✅ All features respect role permissions

Phase 6: Polish & Enhancement (Week 6-7)

Tasks:

Advanced filtering and search

Date range picker

Full-text search

Multiple filter combinations

Improved pagination

Cursor-based pagination

Infinite scroll option

Application status timeline/history

Visual timeline component

Show all status changes

Show actors and timestamps

Export functionality

CSV export for applications

PDF reports (optional)

Empty states for all views

No applications

No permissions

No results

Error boundaries

Graceful error handling

Error reporting

Loading skeletons

Skeleton screens for lists

Loading states for actions

Mobile responsive refinements

Test all breakpoints

Touch-friendly targets

Bottom sheets for mobile dialogs

Accessibility audit

Keyboard navigation

Screen reader testing

ARIA labels

Color contrast

Performance optimization

Code splitting

Image lazy loading

Bundle size analysis

Comprehensive testing

Component tests

Integration tests

E2E tests for critical flows

Documentation

API docs

User guide

Admin guide
Deliverables:

Production-ready HR system

Polished UX with attention to detail

Accessible and performant

Success Criteria:

✅ All features tested and working

✅ Mobile responsive across all views

✅ WCAG AA accessibility compliance

✅ <2s page load, <500ms API response

✅ Zero critical bugs

✅ Documentation complete

Technical Requirements

Backend:

TypeScript throughout

Drizzle ORM with typed schemas

Migration-based database changes (NEVER use db:push)

Comprehensive error handling

Rate limiting (5 applications/hour per user)

Activity logging for audit trail

Integration tests with Vitest

Frontend:

React with TypeScript

TanStack Query for server state

React Router for routing

Tailwind CSS with existing design system

Radix UI for accessible components

Mobile-first responsive design

Component tests with Vitest + Testing Library

Database:

Neon PostgreSQL (serverless)

Shared database with core worker

Indexed for common query patterns

Foreign key constraints for data integrity

JSONB for extensible metadata

Performance:

Server-side pagination (25-50 items)

Query caching (TanStack Query)

Optimistic updates for mutations

Code splitting for routes

Image lazy loading

Security:

NEVER expose HR notes to non-admins

Validate character ownership before actions

Validate corp membership via DO

Rate limiting to prevent spam

Audit log all sensitive actions

CSRF protection

Input sanitization

Success Criteria

Functional Requirements:

✅ Non-members can submit applications to corporations

✅ HR members can review and accept/reject applications

✅ Community members can add recommendations to applications

✅ HR admins can add private notes to user profiles

✅ All actions properly authorized and logged

✅ Status transitions validated (state machine)

Non-Functional Requirements:

✅ Mobile-responsive across all breakpoints

✅ WCAG AA accessibility compliance

✅ Performance: <2s page load, <500ms API response

✅ Zero data leakage (notes strictly admin-only)

✅ Graceful error handling with user-friendly messages

✅ Comprehensive test coverage (>80%)

Future Enhancements (Post-V1)

Real-Time Features:

WebSocket updates for live application status

Live notifications for HR members

Presence indicators (who's reviewing)

Advanced Features:

Application templates (custom questions per corp)

Bulk actions (accept/reject multiple)

Application assignment (assign to specific HR member)

Interview scheduling integration

Application scoring/rating system

Integrations:

Discord bot notifications

Email notifications

EVE Mail integration

Calendar integration for interviews

Analytics:

Acceptance rate trends

Time-to-process metrics

Applicant funnel analysis

HR member performance stats

AI/ML Features:

AI-powered applicant scoring

Duplicate detection

Recommendation suggestions

Auto-categorization of notes

Key Design Decisions

Why No Durable Objects?

Applications don't need strong consistency across concurrent writers

No real-time coordination required

No WebSocket functionality needed

PostgreSQL handles concurrency well with transactions

Simpler architecture, easier to maintain

Why Shared Database?

Foreign key constraints to users table

Efficient joins for enriching data

Transactional consistency across user and application data

Simpler deployment (no separate DB to manage)

Why TanStack Query?

Already used in existing codebase

Excellent caching and state management

Optimistic updates for better UX

Automatic background refetching

Built-in loading/error states

Why Polling Instead of WebSockets (V1)?

Simpler implementation for MVP

Lower infrastructure complexity

Sufficient for HR use case (not ultra-real-time critical)

Can add WebSockets later if needed

Risks & Mitigations

Risk: HR notes accidentally exposed to non-admins

Mitigation: Strict auth checks at API and UI level, comprehensive tests, code review focus

Risk: Application spam/abuse

Mitigation: Rate limiting (5/hour), validation, monitoring, admin tools

Risk: Performance issues with large application lists

Mitigation: Pagination, indexes, query optimization, caching

Risk: Complex role hierarchy confusion

Mitigation: Clear UI indicators, helpful error messages, documentation

Risk: Mobile UX degradation

Mitigation: Mobile-first design, responsive testing, touch targets

Timeline

Total Estimated Time: 6-7 weeks

Week 1-2: Backend Foundation

Week 2-3: Basic Application UI

Week 3-4: Recommendation System

Week 4-5: Notes System

Week 5-6: HR Role Management

Week 6-7: Polish & Enhancement

Milestones:

End of Week 2: Applications can be submitted and reviewed

End of Week 4: Recommendations system live

End of Week 5: Notes system complete

End of Week 7: Production ready

Resources

Development Team:

1 Backend Developer (Cloudflare Workers, PostgreSQL)

1 Frontend Developer (React, TypeScript)

1 Designer (UI/UX review, component design)

1 QA Engineer (Testing, accessibility audit)

Infrastructure:

Neon PostgreSQL database (existing)

Cloudflare Workers deployment (existing)

Staging environment for testing

Production environment

Documentation:

API documentation (OpenAPI spec)

User guide for applicants

Admin guide for HR members

Developer documentation

This plan provides a comprehensive roadmap for building the HR worker system. Each phase delivers tangible functionality and builds on previous work. The phased approach allows for iterative development, testing, and feedback incorporation.
