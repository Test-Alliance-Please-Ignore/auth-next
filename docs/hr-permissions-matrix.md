# HR Permissions Matrix

Last updated: 2026-06-21

Scope notes:
- Corporation-scoped unless explicitly marked global.
- Effective leadership inheritance is implemented in HR role resolution:
	- `CEO` => effective `hr_admin`
	- `Director` => effective `hr_reviewer`
- `HR Auditor` is global and bypasses some corp-scoped read checks.
- `Site Admin` bypasses most access checks.

## Effective Role Mapping

| Permission Level | Effective HR Role (for role checks) |
| --- | --- |
| CEO | hr_admin |
| Director | hr_reviewer |
| HR Admin | hr_admin |
| HR Reviewer | hr_reviewer |
| HR Viewer | hr_viewer |
| HR Auditor | hr_viewer fallback on `/hr/roles/check`; auditor-specific bypass on HR/Fulcrum read flows |
| Site Admin | hr_admin (plus admin bypass) |

## Navigation Visibility Matrix (UI)

| Nav Item | CEO | Director | HR Admin | HR Reviewer | HR Viewer | HR Auditor | Site Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `HR > My Applications` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `HR > Join Corporations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `HR > Recommendations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `HR > Corporations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `HR > User Search` (`/hr/auditor/users`) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

## Page Accessibility Matrix (UI routes)

| Page | CEO | Director | HR Admin | HR Reviewer | HR Viewer | HR Auditor | Site Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/corporations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/corporations/:corpId/applications` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/corporations/:corpId/applications/:applicationId` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/corporations/:corpId/members` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/corporations/:corpId/members/:accountId` | ✅ | ✅ | ✅ | ✅ | ✅ | Redirect to auditor profile unless superseding corp access | ✅ |
| `/corporations/:corpId/hr/roles` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `/corporations/:corpId/settings` (button visibility) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `/hr/auditor/users` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| `/hr/auditor/users/:userId` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| `/hr/auditor/users/:userId/groups` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| `/fulcrum/reports/:reportId` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Support Notes

- If a user can open the HR user profile page, they can see private character data for the target user across corp boundaries when the page logic allows it. This includes SP, wallet, and other private character sections that are tied to the page audience.
- On the character detail surface, "private data" means:
	- location
	- wallet balance
	- assets
	- online/offline status and login metadata
	- skill queue
	- live-versus-last-known sensitive-data state
- Fulcrum report permissions are user-scoped in two places:
	- the open-application allowance applies to all of that user's characters
	- the shared-corp fallback is also evaluated against the target user's full character set, not just the one character being requested
- `applicationId` on Fulcrum request creation is metadata only. It is used for report-link/back-navigation context, not for authorization.
- The open-application and shared-corp allowances do not override CEO restrictions. HR reviewers still cannot request reports for member-corp CEOs. Only auditors and site admins can.
- `HR Viewer` can view the HR profile page, but cannot request Fulcrum reports.

## Fulcrum Authorization Matrix

| Scenario | HR Reviewer | HR Admin | HR Auditor | Site Admin | Notes |
| --- | --- | --- | --- | --- | --- |
| Target user has an active application (`pending` / `under_review`) in a corp where the requester has HR permission | ✅ | ✅ | ✅ | ✅ | The allowance is user-scoped and applies to all of that user's characters. |
| No active application, but the target user has any character in a corp shared with the requester | ✅ | ✅ | ✅ | ✅ | The fallback is also user-scoped; the requested character does not need to be in the shared corp. |
| Target is a member-corp CEO | ❌ | ❌ | ✅ | ✅ | CEO gating supersedes the normal HR allowance path. |
| No active application and no shared corp | ❌ | ❌ | ✅ | ✅ | Auditors and site admins bypass the corp-match requirement; HR staff do not. |

## API Access Matrix (Core routes)

| Endpoint | CEO | Director | HR Admin | HR Reviewer | HR Viewer | HR Auditor | Site Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/hr/applications` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (global) | ✅ |
| `GET /api/hr/applications/:id` | ✅ | ✅ | ✅ | ✅ | ✅* | ✅ (global) | ✅ |
| `PATCH /api/hr/applications/:id` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `POST /api/hr/applications/:id/messages` (HR sender) | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `GET /api/hr/applications/:id/messages` | ✅ | ✅ | ✅ | ✅ | ✅* | ✅ (global) | ✅ |
| `GET /api/hr/applications/:id/messages/count` | ✅ | ✅ | ✅ | ✅ | ✅* | ✅ (global) | ✅ |
| `POST /api/hr/:corpId/roles` grant `hr_admin` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (CEO-only) |
| `POST /api/hr/:corpId/roles` grant `hr_reviewer/hr_viewer` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `DELETE /api/hr/:corpId/roles/:roleId` revoke `hr_admin` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `DELETE /api/hr/:corpId/roles/:roleId` revoke lower HR roles | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `POST /api/hr/notes` / `GET /api/hr/notes` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `PATCH/DELETE /api/hr/notes/:id` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `GET /api/corporations/:corpId/members` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /api/corporations/:corpId/members/refresh` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `PATCH /api/corporations/:corpId/members/:charId/status` (emeritus/active) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

\* `HR Viewer` access depends on application state constraints from HR service logic (viewer-only corp access is restricted to active review states where enforced).

## UI Action Matrix (by surface)

### Corporation Members Page (`/corporations/:corpId/members`)

| Action/Button | CEO | Director | HR Admin | HR Reviewer | HR Viewer | HR Auditor | Site Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Refresh` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `Export CSV` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `Manage HR Roles` button | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `Corporation Settings` button | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Row action: `Grant HR Role` | ✅ (`hr_admin/reviewer/viewer`) | ❌ | ✅ (`hr_reviewer/viewer`) | ❌ | ❌ | ❌ | ✅ (`hr_reviewer/viewer`) |
| Row action: `Revoke HR Role` | ✅ | ❌ | ✅ (cannot revoke `hr_admin`) | ❌ | ❌ | ❌ | ✅ |
| Row action: `Mark as Emeritus` / `Remove Emeritus` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Row action: `View Profile` (linked account) | ✅ (corp profile) | ✅ (corp profile) | ✅ (corp profile) | ✅ (corp profile) | ✅ (corp profile) | ✅ (auditor profile unless superseding corp access) | ✅ (corp profile) |

### Application Review Page (`/corporations/:corpId/applications/:applicationId`)

| Action | CEO | Director | HR Admin | HR Reviewer | HR Viewer | HR Auditor | Site Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| View application details | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Change status (under review / accept / reject) | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Send HR-side message | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Add HR note | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit/Delete HR note | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Fulcrum tab visibility | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |

### User Profile Surfaces

| Surface Action | CEO | Director | HR Admin | HR Reviewer | HR Viewer | HR Auditor | Site Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Corp profile: add HR note (`/corporations/:corpId/members/:accountId`) | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Auditor profile: add HR note (`/hr/auditor/users/:userId`) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Corp profile: scan button visibility | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Auditor profile: scan button visibility | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

## Auditor Routing Behavior

For an auditor without superseding corporation access (`CEO` / `Director` / HR role / site admin):
- Opening `/corporations/:corpId/members/:accountId` redirects to `/hr/auditor/users/:accountId`.
- Origin context is carried in router state (`source`, `returnTo`, `corporationId`) so back/breadcrumb can return to members or applications.

For users who are both auditor and have superseding corp access:
- They remain in the corp profile flow (`/corporations/:corpId/members/:accountId`).
