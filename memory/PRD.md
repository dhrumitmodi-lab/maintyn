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

## Prioritized Backlog
### P1 (Next iteration)
- Payment gateway (Stripe / Razorpay) — collect maintenance & amenity fees online
- Monthly community digest email (auto on 1st of each month)

### P2 (Later)
- Polls / voting for AGM decisions
- Multi-society tenancy (SaaS mode)
- Analytics: collection trends, expense breakdowns
- Amenity booking rules (max bookings/resident/week, booking window)

## Test Credentials
See `/app/memory/test_credentials.md`

## API Endpoints (all under `/api`)
Auth: `/auth/{login,register,logout,me}`
Users: `/users` (GET, POST, PATCH/{id}, DELETE/{id})
Flats: `/flats` (GET, POST, PATCH/{id}, DELETE/{id})
Invoices: `/invoices`, `/invoices/bulk`, `/invoices/{id}/pay`, DELETE `/invoices/{id}`
Expenses: `/expenses` (GET, POST, DELETE/{id})
Files: `/files/upload`, `/files/{id}/download`
Complaints: `/complaints` (GET, POST, PATCH/{id})
Announcements: `/announcements` (GET, POST, DELETE/{id})
Visitors: `/visitors` (GET, POST), `/visitors/{id}/checkout`
Stats: `/stats`
