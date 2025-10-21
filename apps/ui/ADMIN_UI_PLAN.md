# Admin UI Implementation Plan

**Status**: In Progress
**Last Updated**: 2025-01-20
**Target**: Build admin interface for groups system management

---

## Progress Overview

- [x] **Phase 1**: API Client Extension
- [x] **Phase 2**: Core UI Components (5/5 complete) ✅
- [x] **Phase 3**: Feature Components (8/8 complete) ✅
- [x] **Phase 4**: React Query Hooks (3/3 complete) ✅
- [x] **Phase 5**: Admin Pages (4/4 complete) ✅
- [x] **Phase 6**: Navigation & Routes (2/2 complete) ✅

**Overall Progress**: 100% complete ✅

---

## Phase 1: API Client Extension ✅

**File**: `src/client/lib/api.ts`

### Completed
- [x] Add `patch()` method to ApiClient
- [x] Add TypeScript types for all groups entities
- [x] Add category methods (get, create, update, delete)
- [x] Add group methods (get, list with filters, update, delete)
- [x] Add member methods (get, remove)
- [x] Add admin methods (add, remove)

### API Methods Added
```typescript
// Categories
getCategories(): Promise<Category[]>
getCategory(id): Promise<CategoryWithGroups>
createCategory(data): Promise<Category>
updateCategory(id, data): Promise<Category>
deleteCategory(id): Promise<void>

// Groups
getGroups(filters?): Promise<GroupWithDetails[]>
getGroup(id): Promise<GroupWithDetails>
updateGroup(id, data): Promise<Group>
deleteGroup(id): Promise<void>

// Members
getGroupMembers(groupId): Promise<GroupMember[]>
removeGroupMember(groupId, userId): Promise<void>

// Admins
addGroupAdmin(groupId, userId): Promise<void>
removeGroupAdmin(groupId, userId): Promise<void>
```

---

## Phase 2: Core UI Components ✅

**Location**: `src/client/components/ui/`

### Status
- [x] `table.tsx` - Data table components (Table, TableHeader, TableBody, TableRow, TableCell, etc.)
- [x] `dialog.tsx` - Modal dialog component
- [x] `select.tsx` - Dropdown select component
- [x] `badge.tsx` - Status badge component
- [x] `label.tsx` - Form label component

### Table Component ✅
**File**: `src/client/components/ui/table.tsx`
- Exports: Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption
- Styling: Follows existing dark theme with hover effects and borders
- Usage: For displaying categories, groups, and members in tabular format

### Dialog Component ✅
**File**: `src/client/components/ui/dialog.tsx`
- Uses `@radix-ui/react-dialog`
- Exports: Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogPortal, DialogOverlay, DialogClose
- Styling: Backdrop blur with black/80 overlay, centered modal, dark background with border
- Features: Close button with X icon, smooth animations, responsive sizing
- Usage: Category create/edit forms, confirmation dialogs

### Select Component ✅
**File**: `src/client/components/ui/select.tsx`
- Uses `@radix-ui/react-select`
- Exports: Select, SelectTrigger, SelectContent, SelectItem, SelectValue, SelectGroup, SelectLabel, SelectSeparator, SelectScrollUpButton, SelectScrollDownButton
- Styling: Matches existing input styling with rounded borders and focus rings
- Features: Chevron icon, check indicator for selected items, scroll buttons
- Usage: Visibility dropdowns, category dropdowns, permission selects

### Badge Component ✅
**File**: `src/client/components/ui/badge.tsx`
- Uses CVA for variants
- Variants: default (primary), secondary, destructive, outline
- Styling: Small rounded pill shape, monochrome with subtle color hints
- Features: Hover states, focus ring, border variants
- Usage: Visibility status, join mode indicators

### Label Component ✅
**File**: `src/client/components/ui/label.tsx`
- Uses `@radix-ui/react-label`
- Styling: text-sm, font-medium, handles disabled state opacity
- Features: Peer-disabled cursor and opacity support
- Usage: Form field labels

---

## Phase 3: Feature Components ✅

**Location**: `src/client/components/`

### Status
- [x] `admin-nav.tsx` - Admin sidebar navigation
- [x] `visibility-badge.tsx` - Visibility status indicator
- [x] `join-mode-badge.tsx` - Join mode indicator
- [x] `category-list.tsx` - Categories table with actions
- [x] `category-form.tsx` - Category create/edit form
- [x] `group-list.tsx` - Groups table with filtering
- [x] `group-card.tsx` - Group summary card
- [x] `member-list.tsx` - Group members table

### Admin Nav ✅
**File**: `src/client/components/admin-nav.tsx`
- Sidebar navigation with gradient header
- Links to Categories and Groups sections
- Active state highlighting with border and background
- Icons from lucide-react (FolderKanban, Users)
- Responsive hover states

### Visibility Badge ✅
**File**: `src/client/components/visibility-badge.tsx`
- Badge component for visibility status
- public: default variant (primary color)
- hidden: secondary variant
- system: destructive variant (red)
- Maps enum to appropriate styling

### Join Mode Badge ✅
**File**: `src/client/components/join-mode-badge.tsx`
- Badge component for join mode status
- open: default variant
- approval: secondary variant
- invitation_only: outline variant
- Clear labels for each mode

### Category List ✅
**File**: `src/client/components/category-list.tsx`
- Table with columns: Name, Description, Visibility, Group Creation, Actions
- Edit and delete icon buttons
- Loading skeleton state
- Empty state with helpful message
- Truncated descriptions with max width
- Destructive styling for delete button

### Category Form ✅
**File**: `src/client/components/category-form.tsx`
- Form for creating/editing categories
- Fields: Name (required), Description (textarea), Visibility (Select), Allow Group Creation (Select)
- Client-side validation with error messages
- Submit/cancel buttons with loading states
- Disabled state during submission
- Works for both create and update operations

### Group List ✅
**File**: `src/client/components/group-list.tsx`
- Table with columns: Group Name, Category, Visibility, Join Mode, Members, Actions
- System visibility groups highlighted with warning indicator
- View details button linking to group detail page
- Loading skeleton state
- Empty state message
- Destructive background tint for system groups

### Group Card ✅
**File**: `src/client/components/group-card.tsx`
- Card displaying group summary with glow effect
- Shows: name (gradient text), description, category, visibility, join mode
- Member count and owner ID display
- System visibility warning banner with detailed explanation
- Icons for member count and owner
- Responsive badge placement

### Member List ✅
**File**: `src/client/components/member-list.tsx`
- Table with columns: User, Role, Joined Date, Actions
- Role badges: Owner, Admin, Member (with different variants)
- Make Admin / Remove Admin toggle button
- Remove member button (disabled for owner)
- Formatted join dates using date-fns
- Loading skeleton and empty states
- Conditional action buttons based on role

---

## Phase 4: React Query Hooks ✅

**Location**: `src/client/hooks/`

### Status
- [x] `useCategories.ts` - Category queries and mutations
- [x] `useGroups.ts` - Group queries and mutations
- [x] `useGroupMembers.ts` - Member queries and mutations

### useCategories Hook ✅
**File**: `src/client/hooks/useCategories.ts`
- Query keys with namespaced structure for efficient invalidation
- `useCategories()` - Fetch all categories
- `useCategory(id)` - Fetch single category with groups
- `useCreateCategory()` - Create mutation with optimistic updates
- `useUpdateCategory()` - Update mutation with cache updates
- `useDeleteCategory()` - Delete mutation with cache cleanup
- Automatic query invalidation on mutations
- Optimistic UI updates for better UX

### useGroups Hook ✅
**File**: `src/client/hooks/useGroups.ts`
- Query keys with filter-aware caching
- `useGroups(filters?)` - Fetch groups with optional filters (categoryId, visibility, joinMode, search)
- `useGroup(id)` - Fetch single group with full details
- `useUpdateGroup()` - Update mutation with multi-cache updates
- `useDeleteGroup()` - Delete mutation with cleanup across all filter variants
- Handles multiple cached queries with different filters
- Invalidates all list queries on mutations to ensure consistency

### useGroupMembers Hook ✅
**File**: `src/client/hooks/useGroupMembers.ts`
- Query keys for per-group member lists
- `useGroupMembers(groupId)` - Fetch members of a group
- `useRemoveMember()` - Remove member mutation with optimistic removal
- `useToggleAdmin()` - Toggle admin status (calls addGroupAdmin or removeGroupAdmin)
- Invalidates group detail queries (member count and admin list may change)
- Optimistic updates for immediate UI feedback

---

## Phase 5: Admin Pages ✅

**Location**: `src/client/routes/admin/`

### Status
- [x] `layout.tsx` - Admin layout wrapper with navigation
- [x] `categories.tsx` - Category management page
- [x] `groups.tsx` - Groups overview page
- [x] `group-detail.tsx` - Group detail and member management

### Admin Layout ✅
**File**: `src/client/routes/admin/layout.tsx`
- Admin-only route protection with loading state
- Checks `user.is_admin`, redirects to /dashboard if not admin
- Sidebar navigation using AdminNav component
- Dynamic breadcrumb trail generated from URL path
- Outlet for nested child routes
- Starfield background with same styling as main layout
- Header with "Admin Panel" title and breadcrumbs
- Footer with admin-specific message

### Categories Page ✅
**File**: `src/client/routes/admin/categories.tsx`
- Page title: "Category Management" with description
- "Create Category" button with Plus icon
- CategoryList component with categories data
- Success/error message banners (inline, auto-dismiss)
- Create dialog with CategoryForm
- Edit dialog with pre-filled CategoryForm
- Delete confirmation dialog with category name
- All dialogs use React Query mutations with loading states
- Optimistic UI updates via query invalidation

### Groups Page ✅
**File**: `src/client/routes/admin/groups.tsx`
- Page title: "Groups Overview" with description
- Comprehensive filter section with 4 filters:
  - Category dropdown (populated from useCategories)
  - Visibility dropdown (public/hidden/system)
  - Join mode dropdown (open/approval/invitation_only)
  - Search input with search button and Enter key support
- "Clear Filters" button (shown when filters active)
- GroupList component with filtered results
- Group count display in card title
- Filter state updates useGroups query automatically
- System visibility groups highlighted in GroupList component

### Group Detail Page ✅
**File**: `src/client/routes/admin/group-detail.tsx`
- Dynamic route parameter (groupId from URL)
- Back button to /admin/groups
- Loading state with skeleton
- Not found state with error message
- GroupCard component (includes system visibility warning)
- Stats section with 2 cards:
  - Member count (calculated from members array)
  - Admin count (calculated from adminUserIds set)
- MemberList component with full interactivity
- Remove member confirmation dialog with user context
- Toggle admin confirmation dialog (different messages for add/remove)
- Success/error message banners (inline, auto-dismiss)
- All mutations use React Query hooks with loading states

---

## Phase 6: Navigation & Routes ✅

**Location**: `src/client/`

### Status
- [x] Update `App.tsx` with admin routes
- [x] Update `components/layout.tsx` with admin nav link

### App.tsx Updates ✅
**File**: `src/client/App.tsx`
- Added Navigate import from react-router-dom
- Imported all admin components (AdminLayout, CategoriesPage, GroupsPage, GroupDetailPage)
- Added admin route section with nested routes:
  - `/admin` → AdminLayout (wrapper)
  - `/admin` (index) → Navigate to /admin/categories
  - `/admin/categories` → CategoriesPage
  - `/admin/groups` → GroupsPage
  - `/admin/groups/:groupId` → GroupDetailPage

### Layout Updates ✅
**File**: `src/client/components/layout.tsx`
- Added useLocation import to detect current route
- Added Shield icon from lucide-react
- Added isOnAdminRoute check (pathname.startsWith('/admin'))
- Admin link only shown when user.is_admin is true
- Shield icon displayed next to "Admin" text
- Conditional styling:
  - Active (on admin route): text-primary font-medium
  - Inactive: hover:text-primary
- Placed between Dashboard and Logout links

---

## Implementation Notes

### Styling Patterns to Follow

**Colors** (from globals.css):
- Background: `#141414` (deep black)
- Foreground: `#f2f2f2` (soft white)
- Primary: `#d9d9d9` (light gray)
- Secondary: `#404040` (medium gray)
- Muted: `#2e2e2e`
- Accent: `#383838`
- Destructive: Red for warnings/deletes

**Effects**:
- Starfield animation background
- Glow effects on cards/tables (box-shadow with accent color)
- Gradient text for headers
- Backdrop blur on modals
- Hover states with muted background

**Component Patterns**:
- Use existing Button component for all actions
- Use Card components for containers
- Maintain consistent spacing (p-4, p-6, gap-4)
- Use lucide-react for icons
- Follow existing loading skeleton patterns

### Data Flow Pattern

**Query Example**:
```typescript
const { data: categories, isLoading } = useCategories()
```

**Mutation Example**:
```typescript
const createCategory = useCreateCategory()

const handleSubmit = async (data) => {
  try {
    await createCategory.mutateAsync(data)
    // Success: dialog closes, query invalidates, toast shows
  } catch (error) {
    // Error: show error message
  }
}
```

### Form Validation

- Required fields marked with asterisk
- Client-side validation before submission
- Server error handling with error messages
- Disabled submit button during mutation
- Clear form on successful creation

### Permission Checks

**Frontend**:
- Admin layout checks `user.is_admin`
- Hide admin nav link for non-admins
- Redirect to `/dashboard` if not admin

**Backend** (handled by groups worker):
- All admin endpoints validate admin status
- API returns 403 for unauthorized requests
- Frontend shows appropriate error

---

## Dependencies Required

All dependencies already installed in existing UI app:
- ✅ React 19
- ✅ React Router 7
- ✅ TanStack Query
- ✅ Radix UI primitives
- ✅ Tailwind CSS
- ✅ CVA
- ✅ lucide-react
- ✅ date-fns

**New Radix Components Needed**:
- `@radix-ui/react-dialog` (for modals)
- `@radix-ui/react-select` (for dropdowns)
- `@radix-ui/react-label` (for form labels)

Install command:
```bash
cd apps/ui
pnpm add @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-label
```

---

## Testing Checklist

### Category Management
- [ ] List categories (empty state, with data)
- [ ] Create category (all fields)
- [ ] Edit category (update each field)
- [ ] Delete category (with confirmation)
- [ ] Form validation (required fields)
- [ ] Error handling (network errors, validation errors)

### Groups Overview
- [ ] List all groups
- [ ] Filter by category
- [ ] Filter by visibility
- [ ] Filter by join mode
- [ ] Search by name
- [ ] System visibility highlighting
- [ ] Navigate to group detail

### Group Detail
- [ ] Display group information
- [ ] List members
- [ ] Remove member (with confirmation)
- [ ] Make user admin
- [ ] Remove admin status
- [ ] Cannot remove owner
- [ ] System visibility warning shown

### Navigation
- [ ] Admin link visible for admins only
- [ ] Admin link hidden for regular users
- [ ] Non-admins redirected from admin pages
- [ ] Active route highlighting
- [ ] Breadcrumb navigation

---

## Future Enhancements

*Not in scope for initial implementation*

- [ ] Bulk operations (delete multiple categories/groups)
- [ ] Export data (CSV/JSON)
- [ ] Advanced search with multiple criteria
- [ ] Group activity log/audit trail
- [ ] User lookup by character name (requires core worker integration)
- [ ] Direct member addition by user search
- [ ] Email notifications for admin actions
- [ ] Permission templates for categories
- [ ] Group templates for quick creation
- [ ] Analytics dashboard (member growth, activity)
- [ ] WebSocket real-time updates for member changes

---

## Known Issues / TODOs

1. **Character Lookup**: Direct user invitation requires core worker integration for character name → user ID lookup
2. **User Display**: Currently showing user IDs instead of character names (needs user service integration)
3. **Backend Routes**: Need to create actual HTTP routes in groups worker (currently only Durable Object RPC methods exist)
4. **Authentication**: Need to integrate with existing session middleware
5. **Error Messages**: Need to improve error messages from API
6. **Loading States**: Need consistent loading spinners/skeletons
7. **Toast Notifications**: Need to add toast library for success/error messages

---

## Questions / Decisions Needed

- [ ] Should we add pagination for large lists?
- [ ] Toast notification library preference? (react-hot-toast, sonner, etc.)
- [ ] Should category/group names be unique globally or per-parent?
- [ ] Confirmation dialog library or custom component?
- [ ] Should we show deleted items in a separate view?
- [ ] Maximum character limit for descriptions?

---

## File Changes Summary

### New Files Created
1. `src/client/lib/api.ts` - ✅ Extended (not new, but modified)
2. `src/client/components/ui/table.tsx` - ✅ Created
3. `src/client/components/ui/dialog.tsx` - ✅ Created
4. `src/client/components/ui/select.tsx` - ✅ Created
5. `src/client/components/ui/badge.tsx` - ✅ Created
6. `src/client/components/ui/label.tsx` - ✅ Created
7. `src/client/components/admin-nav.tsx` - ✅ Created
8. `src/client/components/visibility-badge.tsx` - ✅ Created
9. `src/client/components/join-mode-badge.tsx` - ✅ Created
10. `src/client/components/category-list.tsx` - ✅ Created
11. `src/client/components/category-form.tsx` - ✅ Created
12. `src/client/components/group-list.tsx` - ✅ Created
13. `src/client/components/group-card.tsx` - ✅ Created
14. `src/client/components/member-list.tsx` - ✅ Created
15. `src/client/hooks/useCategories.ts` - ✅ Created
16. `src/client/hooks/useGroups.ts` - ✅ Created
17. `src/client/hooks/useGroupMembers.ts` - ✅ Created
18. `src/client/routes/admin/layout.tsx` - ✅ Created
19. `src/client/routes/admin/categories.tsx` - ✅ Created
20. `src/client/routes/admin/groups.tsx` - ✅ Created
21. `src/client/routes/admin/group-detail.tsx` - ✅ Created

### Modified Files
1. `src/client/App.tsx` - ✅ Modified (added admin routes)
2. `src/client/components/layout.tsx` - ✅ Modified (added admin link)

**Total**: 21 new files + 2 modified files = 23 file changes ✅
