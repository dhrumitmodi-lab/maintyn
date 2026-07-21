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

## What's Implemented (2026-02-21)
- JWT auth: /login, /register (self-signup as resident), /logout, /me
- Admin seeded on startup (admin@maintyn.app / Admin@12345)
- Users CRUD (admin only for delete)
- Flats CRUD (staff)
- Invoices: create single, bulk-for-all-flats, mark paid, delete, filter by status
- Expenses: create + delete, optional receipt upload (Emergent object storage), download via ?auth=<token>
- Complaints: raise, staff updates status (open/in_progress/resolved), Kanban-style board
- Announcements: staff post + delete, all view
- Visitors: log entry, check-out, role-scoped view
- Dashboard: role-based stats + recent invoices + latest notices
- Landing page with hero + features grid

## Prioritized Backlog
### P0 (Ready)
- ~~All core modules functional end-to-end~~ ✅

### P1 (Next iteration)
- Payment gateway integration (Stripe / Razorpay) — user indicated this is next step
- Password reset / forgot password flow
- Email notifications (invoice raised, complaint status change) via Resend
- Bulk import (residents & flats via CSV)

### P2 (Later)
- Rich resident profile (vehicle, family members)
- Amenity booking (clubhouse, community hall)
- Polls / voting for AGM decisions
- Society-level branding (upload logo, name)
- Multi-society tenancy (SaaS mode)
- Analytics: month-over-month collection rate, expense category breakdown

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
