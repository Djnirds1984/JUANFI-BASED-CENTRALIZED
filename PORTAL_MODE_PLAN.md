# Portal Serving Mode Toggle - Implementation Plan

## Overview
Per-router toggle to choose between MikroTik-hosted portal vs stub-redirect-to-panel portal, with isolated folders so files stay intact.

## Current State
- Catch-all route serves admin panel (public/index.html)
- hotspot/ folder contains MikroTik-hosted portal files
- Portal editor uploads files to MikroTik via SSH

## Desired State
- **MikroTik-hosted mode**: Full portal in `hotspot/` folder, uploaded to MikroTik, served by MikroTik
- **Stub mode**: Minimal stub in `stub/` folder, uploaded to MikroTik, redirects to panel portal
- **Panel routes**: 
  - `/` → serves portal (for stub mode redirect target)
  - `/admin` → admin panel
- **Folder isolation**: Each folder keeps files intact, toggle just switches which folder uploads

---

## Implementation Phases

### Phase 1: Database Schema
**Goal**: Add portal_mode column to routers table

**Tasks**:
1. Add `portal_mode` column to routers table (TEXT, default 'mikrotik', values: 'mikrotik' | 'stub')
2. Update router API to include portal_mode in GET/PUT endpoints
3. Add migration logic for existing routers

**Files**:
- `src/database.ts` - Add column to schema
- `src/routerApi.ts` - Update router CRUD operations

---

### Phase 2: Route Structure
**Goal**: Separate admin and portal routes

**Tasks**:
1. Create explicit `/admin` route that serves admin panel
2. Create explicit `/admin/*` routes for all admin assets (JS, CSS, images)
3. Create root `/` route that serves portal content (for stub mode)
4. Update catch-all to handle 404s appropriately
5. Ensure existing admin functionality works under `/admin` prefix

**Files**:
- `src/server.ts` - Restructure routes
- `public/index.html` - Update asset paths if needed (or keep relative)

**Route Structure**:
```
GET /              → Serve portal (stub mode redirect target)
GET /admin         → Serve admin panel (public/index.html)
GET /admin/*       → Serve admin assets
GET /api/*         → API endpoints (unchanged)
```

---

### Phase 3: Portal Serving Logic
**Goal**: Serve portal content at root route

**Tasks**:
1. Create portal serving logic at root route
2. Determine which router's portal to serve (query param? default router?)
3. Serve appropriate HTML from either hotspot/ or stub/ folder based on portal_mode
4. Handle CHAP parameters passed from stub redirect
5. Implement RADIUS authentication for stub mode portal

**Files**:
- `src/server.ts` - Add root route handler
- `src/portalServe.ts` - New file: portal serving logic
- `src/portalAuth.ts` - New file: portal authentication (RADIUS CHAP)

**Questions to Resolve**:
- How to determine which router's portal to serve at root?
  - Option A: Query param from stub redirect (?router_id=123)
  - Option B: Default router config
  - Option C: Subdomain-based routing (router1.panel.com)
- Does stub mode need full portal UI or just login form?

---

### Phase 4: Stub Folder Setup
**Goal**: Create stub folder with redirect template

**Tasks**:
1. Create `stub/` folder in repo root
2. Create `stub/login.html` with redirect logic
3. Include CHAP parameter passing (mac, ip, chap-id, chap-challenge, link-login-only, link-status)
4. Redirect to panel root with parameters: `http://panel-ip:3000/?mac=...&chap-id=...`
5. Test stub redirect flow

**Files**:
- `stub/login.html` - Stub template with redirect JS

**Stub Template**:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Redirecting...</title>
  <script>
    var params = new URLSearchParams();
    params.set('mac', '$(mac)');
    params.set('ip', '$(ip)');
    params.set('chap-id', '$(chap-id)');
    params.set('chap-challenge', '$(chap-challenge)');
    params.set('link-login-only', '$(link-login-only)');
    params.set('link-status', '$(link-status)');
    params.set('router_id', 'ROUTER_ID_PLACEHOLDER');
    window.location.href = "http://PANEL_URL:3000/?" + params.toString();
  </script>
</head>
<body>
  <p>Redirecting to login portal...</p>
</body>
</html>
```

---

### Phase 5: Admin UI - Portal Mode Toggle
**Goal**: Add toggle to router settings

**Tasks**:
1. Add portal_mode toggle (radio buttons or dropdown) to router edit modal
2. Options: "MikroTik-hosted" | "Stub redirect to panel"
3. Save portal_mode to database via API
4. Show current mode in router list/card

**Files**:
- `public/js/app.js` - Add toggle to router edit UI
- `public/index.html` - Add toggle HTML (if inline)

**UI Location**: Router edit modal or router card settings

---

### Phase 6: Portal Editor - Sub-page Structure
**Goal**: Add stub portal as sub-page within Portal page

**Tasks**:
1. Add tabs or sub-navigation within Portal page: "MikroTik Portal" | "Stub Portal"
2. "MikroTik Portal" tab loads files from hotspot/ folder
3. "Stub Portal" tab loads files from stub/ folder
4. Each tab has its own file list, editor, and upload button
5. Save operations write to respective folder
6. Upload operations upload from respective folder
7. Ensure editing one folder doesn't affect the other

**Files**:
- `public/js/app.js` - Add tab switching logic to portal page
- `src/portalFileApi.ts` - Add folder parameter to file operations

**UI Structure**:
```
Portal (nav item)
  ├─ MikroTik Portal (tab) - edits hotspot/ folder
  └─ Stub Portal (tab) - edits stub/ folder
```

---

### Phase 7: Upload Logic
**Goal**: Upload files based on portal_mode

**Tasks**:
1. Update upload logic to check router's portal_mode
2. Upload from hotspot/ folder if mode is 'mikrotik'
3. Upload from stub/ folder if mode is 'stub'
4. Replace ROUTER_ID_PLACEHOLDER and PANEL_URL in stub before upload
5. Add "Upload Portal" button that respects portal_mode
6. Show which folder is being uploaded in UI

**Files**:
- `src/routerApi.ts` - Update upload endpoint
- `public/js/app.js` - Update upload button logic

---

### Phase 8: Panel Portal Page
**Goal**: Create portal page served at root for stub mode

**Tasks**:
1. Create portal HTML page that **copies the UI and buttons from hotspot/login.html**
   - Same visual design, layout, and branding
   - Same button styles and flow (voucher input, connect button, etc.)
   - Same theme support (Adopisoft, default, etc.)
   - Users should see no difference between MikroTik-hosted and stub mode portals
2. Extract CHAP parameters from query string (passed by stub redirect)
3. Implement voucher login form with CHAP-MD5 authentication
4. Generate CHAP-MD5 password: hexMD5(chap-id + username + chap-challenge)
5. Submit to link-login-only URL (MikroTik login endpoint)
6. Handle success/error responses
7. **NodeMCU coin-slot detection**:
   - Detect NodeMCU device on the network (same subnet as client)
   - Inject coin-slot JS into portal page (same as hotspot/login.html coin flow)
   - Support coin-insert flow: insert coin → call coin-auth → auto-login
   - NodeMCU IP detection via ARP table or configurable per-router
8. Test full authentication flow and coin-insert flow

**Files**:
- `public/portal.html` - Portal page (UI copied from hotspot/login.html)
- `public/js/portal.js` - Portal authentication + coin-slot logic

**Portal Flow**:
1. User lands on panel root with CHAP params from stub redirect
2. Portal page extracts params from URL
3. User enters voucher username (or inserts coin)
4. **Voucher path**: JS generates CHAP-MD5 password → form submits to MikroTik
5. **Coin path**: NodeMCU detected → coin-auth API → auto-login
6. MikroTik validates via RADIUS
7. Redirect to status page on success

**NodeMCU Detection Strategy**:
- Option A: Read MikroTik ARP table to find NodeMCU by MAC prefix or hostname
- Option B: Configurable NodeMCU IP per router (admin sets it)
- Option C: Scan local subnet for coin-slot HTTP endpoint (checkCoin)
- Inject `controllerApiUrl` and `vendorIpAddress` into portal page (same as hotspot/login.html)

---

### Phase 9: Testing
**Goal**: Verify both modes work correctly

**Test Cases**:
1. **MikroTik-hosted mode**:
   - Toggle router to 'mikrotik' mode
   - Edit files in hotspot/ folder
   - Upload to MikroTik
   - Test captive portal login
   - Verify stub/ folder unchanged

2. **Stub mode**:
   - Toggle router to 'stub' mode
   - Edit files in stub/ folder
   - Upload stub to MikroTik
   - Test redirect to panel portal
   - Test voucher authentication
   - Verify hotspot/ folder unchanged

3. **Toggle between modes**:
   - Switch router from mikrotik to stub
   - Verify both folders intact
   - Upload stub, test redirect
   - Switch back to mikrotik
   - Upload hotspot, test direct portal

4. **Multiple routers**:
   - Router A in mikrotik mode
   - Router B in stub mode
   - Verify correct portal served for each
   - Verify folder isolation maintained

---

## Open Questions

1. **Portal routing at root**: How to determine which router's portal to serve?
   - Stub redirect passes router_id as query param
   - Panel serves that router's portal files
   - Need to handle multiple routers with stub mode

2. **Portal page location**: Where to store the portal page for stub mode?
   - Option A: Serve from hotspot/ folder (reuse existing)
   - Option B: Create separate portal/ folder
   - Option C: Generate dynamically based on router config

3. **Admin route prefix**: Should all admin routes use /admin prefix?
   - Current: /api/* for API endpoints
   - New: /admin for admin panel, /admin/* for admin assets
   - API routes stay at /api/* (no change)

4. **Stub template variables**: How to inject router-specific values into stub?
   - Replace placeholders before upload (ROUTER_ID, PANEL_URL)
   - Or pass via query params from MikroTik (limited to CHAP vars)

5. **Backwards compatibility**: How to handle existing routers?
   - Default all existing routers to 'mikrotik' mode
   - No breaking changes to current functionality

---

## Implementation Order

1. **Phase 1** - Database schema (foundation)
2. **Phase 2** - Route structure (critical for stub mode)
3. **Phase 4** - Stub folder setup (can be done in parallel with Phase 2)
4. **Phase 5** - Admin UI toggle (depends on Phase 1)
5. **Phase 3** - Portal serving logic (depends on Phase 2)
6. **Phase 8** - Panel portal page (depends on Phase 3)
7. **Phase 6** - Portal editor isolation (depends on Phase 1)
8. **Phase 7** - Upload logic (depends on Phase 1, 5, 6)
9. **Phase 9** - Testing (after all phases complete)

---

## Estimated Complexity

- **Phase 1-2**: Low complexity, straightforward schema and route changes
- **Phase 3-4**: Medium complexity, portal serving logic and stub template
- **Phase 5-6**: Medium complexity, UI changes and file isolation
- **Phase 7-8**: High complexity, upload logic and authentication flow
- **Phase 9**: Medium complexity, comprehensive testing required

**Total estimated time**: 2-3 days of focused work

---

## Risks and Mitigations

**Risk 1**: Breaking existing admin panel functionality
- **Mitigation**: Test admin panel thoroughly after route changes, keep /api/* routes unchanged

**Risk 2**: CHAP authentication failures in stub mode
- **Mitigation**: Test with real MikroTik, verify all CHAP parameters passed correctly

**Risk 3**: Folder isolation bugs (files getting overwritten)
- **Mitigation**: Explicit folder parameter in all file operations, never modify inactive folder

**Risk 4**: Multi-router portal routing conflicts
- **Mitigation**: Use router_id query param from stub redirect, validate router exists

---

## Success Criteria

- [ ] Admin panel accessible at /admin
- [ ] Portal accessible at / (root)
- [ ] Per-router portal_mode toggle in admin UI
- [ ] hotspot/ and stub/ folders remain isolated
- [ ] MikroTik-hosted mode works (upload hotspot/, test login)
- [ ] Stub mode works (upload stub/, redirect to panel, authenticate)
- [ ] Panel portal UI matches hotspot/login.html (same look, buttons, themes)
- [ ] NodeMCU coin-slot detected in stub mode (coin-insert flow works)
- [ ] Toggle between modes doesn't corrupt files
- [ ] Multiple routers with different modes work correctly
- [ ] No breaking changes to existing functionality
