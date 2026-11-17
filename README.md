# DeskSync — Hybrid Office Desk Occupancy & Reassignment Tracker

A full-stack React + TypeScript + Tailwind + NestJS + PostgreSQL application based on the supplied 8-page project document.

## Included
- Employee and admin authentication (JWT + bcrypt)
- Desk inventory, zones and floor grouping
- Date/time desk reservations with overlap protection using PostgreSQL transaction-level advisory locks
- Optional admin booking approval (`REQUIRE_BOOKING_APPROVAL=true`)
- Booking cancellation with reason
- Desk reassignment requests with reason and admin review/comment
- Live desk/request refresh events over Socket.IO
- Audit trail, user listing, utilization dashboard and reports
- Responsive dark DeskSync UI based on the PDF screenshots

## 1. Prerequisites
- Node.js 20+ and npm
- PostgreSQL 15+
- VS Code

## 2. Database setup (Windows)
Open pgAdmin Query Tool or psql and run:
```sql
CREATE DATABASE desk_management;
```
Then execute `database/001_init.sql` against `desk_management`.

## 3. Backend setup
Open a terminal in `backend`:
```powershell
npm install
Copy-Item .env.example .env
```
Edit `backend/.env` and set your PostgreSQL password in `DATABASE_URL`, plus a long random `JWT_SECRET`.
Run the API in terminal 1:
```powershell
npm run start:dev
```
In terminal 2, seed the initial admin:
```powershell
npm run seed:admin
```


Initial admin: `admin@desksync.local` / `ChangeMe123!`. Change the password before real use. The seed script does not overwrite an existing admin.

## 4. Frontend setup
Open another terminal in `frontend`:
```powershell
npm install
npm run dev
```
Open http://localhost:5173.

If your API is not at `http://localhost:4000/api`, create `frontend/.env`:
```env
VITE_API_URL=http://localhost:4000/api
```

## 5. Test workflow
1. Sign in as the seeded admin.
2. Review Dashboard, Desk Management, Live View, Audit Logs and Users.
3. Register an employee through `POST /api/auth/register` (or use the API directly) and sign in as that employee.
4. Book a desk from Office Layout. Default policy auto-approves bookings; set `REQUIRE_BOOKING_APPROVAL=true` to require admin review.
5. Cancel a booking with a reason, or request a desk change and sign back in as admin to approve/reject it.
6. Keep two browser sessions open to observe Socket.IO refresh events.

## API overview
- `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me`
- `GET /api/desks`, `GET /api/zones`, `GET /api/bookings`, `POST /api/bookings`
- `POST /api/bookings/:id/cancel`
- `GET /api/desk-changes`, `POST /api/desk-changes`
- Admin: `GET /api/admin/stats`, `/users`, `/audit-logs`; `POST /api/admin/review/:type/:id`; `POST /api/admin/desks`; `DELETE /api/admin/desks/:id`

## Important production hardening
This is a development baseline, not a production deployment. Before public deployment, add password reset/change UI, email verification, rate limiting, DTO validation on every request, role/ownership checks for every mutation, HTTPS, backups, structured logging, pagination, and an automated test suite. Restrict registration to approved company emails or an admin invitation workflow. Use a unique production JWT secret and rotate the initial admin password immediately.
