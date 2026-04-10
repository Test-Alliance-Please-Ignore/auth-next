# HR Permissions Matrix

Last updated: 2026-04-09

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
| `HR > HR Corporations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `HR > User Search` (`/hr/auditor/users`) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| `Manage Corporation` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (unless also corp-access role) | ✅ |

## Page Accessibility Matrix

| Page | CEO | Director | HR Admin | HR Reviewer | HR Viewer | HR Auditor | Site Admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/hr` (HR corporations) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (as viewer) | ✅ |
| `/corporations/:corpId/hr/applications` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/corporations/:corpId/hr/applications/:applicationId` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/my-corporations/:corpId/members` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (unless also corp-access role) | ✅ |
| `/corporations/:corpId/hr/members/:accountId` | ✅ | ✅ | ✅ | ✅ | ✅ | Redirect to auditor profile unless also corp-access role | ✅ |
| `/corporations/:corpId/hr/roles` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
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
| Manage HR roles (grant/revoke) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Use auditor user search/details/groups UX | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

## Auditor Routing Behavior

For an auditor without superseding corporation access (`CEO`/`Director`/HR role/site admin):
- Opening `/corporations/:corpId/hr/members/:accountId` redirects to `/hr/auditor/users/:accountId`.
- Redirect context is passed with router navigation state (not query params).
- Auditor profile breadcrumb/back target uses origin context:
	- from applications flow => back to Applications
	- otherwise => back to User Search

If the user is both auditor and has superseding corporation access for that corporation, they stay on the corp member profile flow.
