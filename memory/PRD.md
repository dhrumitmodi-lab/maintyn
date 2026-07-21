# maintyn — Society Facility Management App

## Original Problem Statement
Society Facility Management app for both committee members and residents. Committee/facility managers can add/remove users, flats, raise invoices, and upload expense reports.

## User Choices (2026-02-21)
- Auth: JWT (email/password with roles: admin/committee/resident)
- Payments: No online payments in MVP (mark paid manually). PG integration deferred.
- Modules: All (Users, Flats, Invoices, Expenses, Complaints, Announcements, Visitors)
- File uploads: Yes — Emergent object storage
- Design: Distinctive modern aesthetic (Organic & Earthy — Bone-white, Dark Forest, Terracotta)
- Product name: **maintyn**

## Architecture
- Backend: FastAPI + MongoDB (Motor) + JWT auth + Emergent object storage
- Frontend: React 19 + React Router 7 + shadcn/ui + Tailwind + Phosphor Icons + Sonner toasts
- Fonts: Outfit (headings), Manrope (body), JetBrains Mono
- Colors: #F6F4F1 bg, #1B3127 ink, #C85A3C terracotta CTA, #DDECE5 sage, #13241D forest sidebar

## Personas
1. **Admin** — full access, add/remove any user, manage everything
2. **Committee** — manage flats/invoices/expenses/complaints/notices; cannot delete users
3. **Resident** — sees own invoices/complaints, community notices, can log visitors, raise complaints

## What's Implemented
### 2026-02-21 (Initial MVP)
- JWT auth, all CRUD modules (Users/Flats/Invoices/Expenses/Complaints/Announcements/Visitors), role-based dashboard, landing.

### 2026-02-21 (Iteration 2)
- Password reset via Resend, email notifications on invoice/complaint updates.
- CSV bulk import for flats and residents.

### 2026-02-21 (Iteration 3)
- **Amenity booking module**: staff create amenities (name/hours/slot duration/price/active toggle).
- Residents pick date on calendar → see hourly slot grid with booked/free → book. Conflict-prevented.
- `POST /api/bookings` with server-side overlap detection, hours validation, past-date protection.
- Cancellation flow: owner or staff can cancel. Deleting an amenity auto-cancels future bookings.
- Booking confirmation + cancellation emails via Resend.
- Dashboard extended with bookings_today / bookings_upcoming / amenities_active / my_upcoming_bookings.

### 2026-02-21 (Iteration 4)
- **Monthly community digest email** — auto-sent on the 1st of each month at 09:00 UTC via APScheduler.
- Endpoints: `POST /api/admin/digest/preview` (dry-run), `POST /api/admin/digest/send` (idempotent per YYYY-MM), `GET /api/admin/digest/runs`.
- Digest content: collection %, resolved complaints, upcoming bookings (next 30 days), notices posted in the month.
- Admin UI on the Notices page to preview + send on demand, with history of past sends.

### 2026-02-21 (Iteration 5)
- **Society settings singleton**: `GET/PATCH /api/society` — admin sets society name, city, address, contacts.
- Society name displayed everywhere: sidebar header, top header overline, Society Settings dialog (accessed from sidebar for admin).
- **Member directory** (`/app/directory`) — visible to all authenticated users:
  - Committee cards at top with clickable email/phone (residents know who to contact)
  - Searchable table of all members with role/flat/email/phone
- **Flats page overhauled**:
  - `GET /api/flats/summary` powers 5 StatCards: total, occupied, vacant, owner-occupied, tenant-occupied
  - Block filter pills + occupancy filter pills
  - Flats grouped into per-block sections
- **Complaint UX**: complainer sees a "You'll be notified by email on status changes" banner + a prominent status chip on every card. Email notification on status change already wired.

### 2026-02-21 (Iteration 6)
- **Role-scoped Flats access**: `/app/flats` restricted to admin/committee (Protected route). Sidebar hides `nav-flats` and `nav-users` for residents.
- **My Flat page** (`/app/my-flat`, residents only): flat header, StatCards (Residents / Connections / Bills / Pending), utility grid (Electricity, Piped Gas, Water, Internet, DTH), utility bills table.
- **Utility connections**: per flat, per utility type — store provider name + customer id + optional meter number. CRUD via `POST /api/flats/{id}/utility-connections`, `PATCH/DELETE /api/utility-connections/{id}`.
- **Utility bills**: track electricity / gas / water etc. per flat. `POST /api/utility-bills` (inherits provider+customer from connection if given), `POST /api/utility-bills/{id}/pay`, `DELETE /api/utility-bills/{id}`. Residents auto-scoped to own flat.
- Helper `_can_access_flat` centralises "admin/committee always, resident only own flat".

### 2026-02-21 (Iteration 8)
- **Society branding on invoices**: logo, UPI ID (auto QR generation), custom QR upload, bank details (holder/name/A-no/IFSC).
- Society settings dialog now uses a 3-tab layout: General (logo + address + contacts) / UPI / Bank.
- **Printable invoice view** at `/app/invoices/:id` with society logo, invoice number, bill-to, line items, and a payment section that shows:
  - Pay via UPI: auto-generated QR code (`react-qr-code`) encoding `upi://pay?pa=<vpa>&pn=<name>&am=<amount>&tn=<ref>` — or a custom uploaded QR takes precedence.
  - Bank transfer: account holder / bank / IFSC / account no. with click-to-copy buttons.
  - "Paid on <date>" badge shown instead when invoice.status='paid'.
- **Society logo** shown in the sidebar header when uploaded (falls back to default SVG mark).
- Backend `_get_society()` now merges default None for any missing keys on legacy docs; `PATCH /api/society` accepts partial payloads (name no longer required) but rejects blanking the name.

### 2026-02-21 (Iteration 9)
- **Multi-tenant master DB architecture**: master DB (`maintyn_master`) with `societies`, `master_users`, `user_index` collections. Each society lives in its own MongoDB DB (`maintyn_society_<uuid>`). `_DBProxy` + ContextVar keeps ~200 existing queries unchanged.
- **Master console at `/master`** (super_admin + support): rollup stats, list societies with resident/flat/unpaid counts, create society (auto-sends welcome email to first admin), suspend/reactivate, delete (except Default), impersonate any society's admin.
- **Support-agent management** (super_admin only tab): create additional master users, toggle active, delete.
- **Startup migration**: legacy data preserved by copying into a "Default Society" DB and rebuilding `user_index`. Idempotent.
- **JWT enhanced**: `kind` (master|society) + `society_id` claim; `get_current_user` transparently sets the tenant DB context.
- **Suspended societies block logins** (403).

### 2026-07-21 (Iteration 10 · M-416 feature batch)
- **Staff & Vendor Directory** (`/app/staff`): CRUD for maintenance staff/vendors — name, role_label (e.g. "Plumber"), category (plumbing/electrical/security/cleanliness/parking/amenities/lift/general), phone, email, vendor_org, is_active toggle. Endpoints: `GET/POST /api/staff`, `PATCH/DELETE /api/staff/{id}`. Deleting a staff unassigns any complaints referring to them.
- **Auto-assign complaints on create**: `POST /api/complaints` now finds the first active staff with a matching category and sets `assigned_to` + `assigned_at`. Response includes enriched `assigned_staff` block (name/phone/email/vendor_org).
- **Manual reassignment**: `PATCH /api/complaints/{id}` accepts `assigned_to` (staff id) or empty string to clear. Kanban card exposes a staff picker (`complaint-assign-<id>`) alongside the status select for admin/committee.
- **Resident sees who's on it**: complaint card renders assigned staff panel with click-to-call phone & click-to-email link.
- **Payment receipt email**: marking an invoice paid (`POST /api/invoices/{id}/pay`) now fires a background Resend email to every resident on that flat containing receipt number, amount, description, method, paid date, society name. Only triggers on the paid transition (not on re-marking).
- **Invoice dashboard** (`GET /api/invoices/stats`, admin/committee only): totals for raised/received/pending, collection %, monthly trend (last 6 months raised vs received), and a **defaulter list** — flats whose oldest unpaid invoice is over 90 days old, with residents, unpaid count and months pending. Rendered as StatCards + bar chart + table on `/app/invoices`.
- **Expense dashboard** (`GET /api/expenses/stats`, admin/committee only): 12-month income (paid invoices) vs spent (expenses) series, 3-month projection based on non-zero last-3-month average, category breakdown, totals + net. Rendered on `/app/expenses` as StatCards + bar chart (solid bars for actual, dashed for projected) + category progress bars.
- **Sidebar**: added "Staff & vendors" nav (visible to all roles — residents see the roster read-only via UI role gating).
- **DB indexes**: `staff` collection indexed on `id` (unique) and `category`, provisioned for both Default and new societies.

## Notes
- **Master super-admin**: `master@maintyn.in` / `Master@12345` (seeded at startup)
- **Multi-society setup**: fully done via master console — no need for separate deployments.

## Prioritized Backlog
### P1 (Next iteration)
- Payment gateway (Stripe / Razorpay) for online invoice payments
- WhatsApp receipts (Twilio) — deferred from M-416 (email-only shipped)
- Partial PATCH for `/api/staff/{id}` (exclude_unset)
- Auto-assign tie-breaker (least-loaded / round-robin) when multiple staff share a category

### P2 (Later)
- Polls / voting for AGM decisions
- Refactor `server.py` (~2300 lines) into APIRouter modules (staff.py, invoices.py, complaints.py, expenses.py)
- Defaulter dunning: auto-email defaulter reminder from the dashboard
- Amenity booking rules (max bookings/resident/week, booking window)

## Test Credentials
See `/app/memory/test_credentials.md`

## API Endpoints (all under `/api`)
Auth: `/auth/{login,register,logout,me}`
Users: `/users` (GET, POST, PATCH/{id}, DELETE/{id})
Flats: `/flats` (GET, POST, PATCH/{id}, DELETE/{id})
Invoices: `/invoices`, `/invoices/bulk`, `/invoices/{id}/pay`, `/invoices/stats`, DELETE `/invoices/{id}`
Expenses: `/expenses` (GET, POST, DELETE/{id}), `/expenses/stats`
Files: `/files/upload`, `/files/{id}/download`
Complaints: `/complaints` (GET, POST, PATCH/{id})
Staff: `/staff` (GET, POST), `/staff/{id}` (PATCH, DELETE)
Announcements: `/announcements` (GET, POST, DELETE/{id})
Visitors: `/visitors` (GET, POST), `/visitors/{id}/checkout`
Stats: `/stats`
Master: `/master/{session,societies,users,rollup}`, `/master/societies/{id}/{status,impersonate}`
