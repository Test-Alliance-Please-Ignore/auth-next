# HR Permissions Matrix

Last updated: 2026-04-10

Scope notes:
- Matrices are corporation-scoped unless marked as global.
- Effective role inheritance is now:
	- `CEO` => effective `hr_admin`
	- `Director` => effective `hr_reviewer`
- `HR Auditor` is global, cross-corporation read access and auditor tooling access.
- `Site Admin` supersedes all access checks.

## Effective Role Mapping

| Permission Level | Effective HR Role (for checks) |
| --- | --- |
| CEO | hr_admin |
| Director | hr_reviewer |
| HR Admin | hr_admin |
| HR Reviewer | hr_reviewer |
| HR Viewer | hr_viewer |
| HR Auditor | hr_viewer-equivalent for role-check endpoints; auditor bypass on Fulcrum endpoints |
| Site Admin | hr_admin (plus admin bypass) |

## Navigation Visibility Matrix

| Nav Item | CEO | Director | HR Admin | HR Reviewer | HR Viewer | HR Auditor | Site Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `HR > My Applications` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `HR > Join Corporations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `HR > Recommendations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `HR > Corporations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `HR > User Search` (`/hr/auditor/users`) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| `Corporations > Members` card action | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Page Accessibility Matrix

| Page | CEO | Director | HR Admin | HR Reviewer | HR Viewer | HR Auditor | Site Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/hr` (HR corporations) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (as viewer) | ✅ |
| `/corporations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/corporations/:corpId/hr/applications` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/corporations/:corpId/hr/applications/:applicationId` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/corporations/:corpId/members` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (read-only action surface) | ✅ |
| `/corporations/:corpId/hr/members/:accountId` | ✅ | ✅ | ✅ | ✅ | ✅ | Redirect to auditor profile unless also corp-access role | ✅ |
| `/corporations/:corpId/hr/roles` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `/corporations/:corpId/settings` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `/hr/auditor/users` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| `/hr/auditor/users/:userId` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| `/hr/auditor/users/:userId/groups` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| `/corporations/:corpId/hr/fulcrum/:reportId` and app report views | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Action Matrix

| Action | CEO | Director | HR Admin | HR Reviewer | HR Viewer | HR Auditor | Site Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| View applications | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Review/change application status | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Send HR-side messages on applications | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| View HR notes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Add HR notes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit/delete HR notes | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Trigger Fulcrum scan (single/all) | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| View Fulcrum reports/status | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Access HR role management page | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Grant `hr_admin` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Grant `hr_reviewer` / `hr_viewer` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Revoke `hr_admin` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Revoke `hr_reviewer` / `hr_viewer` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Open corporation settings | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Use auditor user search/details/groups UX | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

## Members Page Action-Button Matrix (`/corporations/:corpId/members`)

| Action Button | CEO | Director | HR Admin | HR Reviewer | HR Viewer | HR Auditor | Site Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Refresh` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `Export CSV` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `Manage HR Roles` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `Corporation Settings` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Row action: `Grant HR Role` | ✅ | ❌ | ✅ (reviewer/viewer only) | ❌ | ❌ | ❌ | ✅ (reviewer/viewer only) |
| Row action: `Revoke HR Role` | ✅ | ❌ | ✅ (cannot revoke `hr_admin`) | ❌ | ❌ | ❌ | ✅ |
| Row action: `Mark as Emeritus` / `Remove Emeritus` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Row action: `View Profile` (linked account) | ✅ (HR member profile) | ✅ (HR member profile) | ✅ (HR member profile) | ✅ (HR member profile) | ✅ (HR member profile) | ✅ (auditor profile) | ✅ (HR member profile) |

## Auditor Routing Behavior

For an auditor without superseding corporation access (`CEO`/`Director`/HR role/site admin):
- Opening `/corporations/:corpId/hr/members/:accountId` redirects to `/hr/auditor/users/:accountId`.
- Redirect context is passed with router navigation state (not query params).
- Auditor profile breadcrumb/back target uses origin context:
	- from applications flow => back to Applications
	- otherwise => back to User Search

If the user is both auditor and has superseding corporation access for that corporation, they stay on the corp member profile flow.
