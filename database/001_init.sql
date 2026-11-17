CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(120) NOT NULL, email VARCHAR(180) UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'employee' CHECK(role IN ('admin','employee')),
 department VARCHAR(120), is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS zones (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(100) NOT NULL UNIQUE, floor VARCHAR(50) NOT NULL DEFAULT 'Floor 1', zone_type VARCHAR(50) NOT NULL DEFAULT 'Office'
);
CREATE TABLE IF NOT EXISTS desks (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(30) NOT NULL UNIQUE, zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
 floor VARCHAR(50) NOT NULL DEFAULT 'Floor 1', status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK(status IN ('available','maintenance','inactive')),
 x INTEGER NOT NULL DEFAULT 0, y INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bookings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), desk_id UUID NOT NULL REFERENCES desks(id),
 start_at TIMESTAMPTZ NOT NULL, end_at TIMESTAMPTZ NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'approved' CHECK(status IN ('pending','approved','rejected','cancelled','completed')),
 note TEXT, cancellation_reason TEXT, reviewed_by UUID REFERENCES users(id), reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(end_at > start_at)
);
CREATE INDEX IF NOT EXISTS bookings_desk_time_idx ON bookings(desk_id,start_at,end_at);
CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS desk_change_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
 current_desk_id UUID NOT NULL REFERENCES desks(id), requested_desk_id UUID NOT NULL REFERENCES desks(id), reason TEXT NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 admin_comment TEXT, reviewed_by UUID REFERENCES users(id), reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
 action VARCHAR(80) NOT NULL, entity_type VARCHAR(50) NOT NULL, entity_id UUID, details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Prevent overlapping active bookings, including simultaneous requests. The exclusion constraint
-- uses a trigger-compatible advisory lock in the service; this index is for fast conflict checks.
CREATE INDEX IF NOT EXISTS bookings_active_range_idx ON bookings(desk_id,start_at,end_at) WHERE status IN ('pending','approved');
INSERT INTO zones(name,floor,zone_type) VALUES ('Meeting Zone','Floor 1','Meeting'),('Office Zone B','Floor 2','Office') ON CONFLICT(name) DO NOTHING;
INSERT INTO desks(code,zone_id,floor,x,y)
SELECT v.code,z.id,v.floor,v.x,v.y FROM (VALUES
 ('A-101','Meeting Zone','Floor 1',1,1),('A-102','Meeting Zone','Floor 1',2,1),('A-103','Meeting Zone','Floor 1',3,1),('A-104','Meeting Zone','Floor 1',4,1),
 ('B-121','Office Zone B','Floor 2',1,1),('B-122','Office Zone B','Floor 2',2,1),('B-123','Office Zone B','Floor 2',3,1),('B-124','Office Zone B','Floor 2',4,1)
) AS v(code,zone_name,floor,x,y) JOIN zones z ON z.name=v.zone_name ON CONFLICT(code) DO NOTHING;
