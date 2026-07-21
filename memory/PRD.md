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
- JWT auth: /login, /register (self-signup as resident), /logout, /me
- Admin seeded on startup (admin@maintyn.app / Admin@12345)
- Users, Flats, Invoices, Expenses, Complaints, Announcements, Visitors — all CRUD
- Invoices: bulk-for-all-flats, mark paid, filter by status
- Expenses: with receipt upload via Emergent object storage
- Complaints: Kanban board with status transitions
- Role-based dashboard + landing page

### 2026-02-21 (Iteration 2)
- Password reset via Resend email: /api/auth/forgot-password, /api/auth/reset-password
- Frontend pages /forgot-password and /reset-password
- Email notifications on: password reset request, invoice raised (single & bulk), complaint status change
- CSV bulk import for flats: POST /api/flats/import-csv
- CSV bulk import for residents: POST /api/users/import-csv (links to flat via block+flat_number)
- Reusable CsvImport dialog with template download

## Prioritized Backlog
### P1 (Next iteration)
- Payment gateway integration (Stripe / Razorpay)
- Amenity booking module (clubhouse, community hall)

### P2 (Later)
- Rich resident profile (vehicle, family members)
- Polls / voting for AGM
- Society-level branding & multi-society tenancy
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
