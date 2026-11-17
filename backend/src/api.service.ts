
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';

import { Pool, PoolClient } from 'pg';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { DeskGateway } from './realtime.gateway';

@Injectable()
export class ApiService implements OnModuleDestroy {
  private db = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
  });

  constructor(private readonly live: DeskGateway) {}

  async onModuleDestroy() {
    await this.db.end();
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private normalizeStatus(value: any): string {
    return String(value || '').toLowerCase();
  }

  private normalizeRole(value: any): string {
    return String(value || 'EMPLOYEE').toUpperCase();
  }

  private emit(event: string, data: any = {}) {
    try {
      this.live.emitChange(event, data);
    } catch (error) {
      // A real-time notification must not undo a committed transaction.
    }
  }

  private token(user: any) {
    const secret = process.env.JWT_SECRET;

    if (!secret || secret.length < 32) {
      throw new Error(
        'JWT_SECRET must be configured with at least 32 characters',
      );
    }

    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: this.normalizeRole(user.role),
        name: user.full_name || user.name,
      },
      secret,
      { expiresIn: '12h' },
    );
  }

  private async writeLog(
    executor: any,
    actor: string,
    action: string,
    type: string,
    id: string | null,
    details: any = {},
  ) {
    await executor.query(
      `INSERT INTO audit_logs
       (actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        actor,
        action,
        type,
        id,
        JSON.stringify(details),
      ],
    );
  }

  private async rollback(client: PoolClient) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original error.
    }
  }

  private async finish(
    client: PoolClient,
    event?: string,
    data: any = {},
  ) {
    await client.query('COMMIT');

    if (event) {
      this.emit(event, data);
    }
  }

  // ==========================================
  // AUTHENTICATION
  // ==========================================

  async login(email: string, password: string) {
    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      !email.trim() ||
      !password
    ) {
      throw new BadRequestException(
        'Email and password are required',
      );
    }

    const q = await this.db.query(
      `SELECT *
       FROM users
       WHERE LOWER(email) = LOWER($1)
         AND is_active = true`,
      [email.trim()],
    );

    const user = q.rows[0];

    if (
      !user ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      throw new UnauthorizedException(
        'Invalid email or password',
      );
    }

    const { password_hash, ...safeUser } = user;

    return {
      token: this.token(safeUser),
      user: {
        ...safeUser,
        role: this.normalizeRole(safeUser.role),
      },
    };
  }

  async register(body: any) {
    const name = String(body.name || '').trim();
    const email = String(body.email || '')
      .trim()
      .toLowerCase();

    const password = String(body.password || '');

    if (!name || !email || !password) {
      throw new BadRequestException(
        'Name, email and password are required',
      );
    }

    if (name.length > 150) {
      throw new BadRequestException(
        'Name is too long',
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException(
        'Enter a valid email address',
      );
    }

    if (email.length > 255) {
      throw new BadRequestException(
        'Email is too long',
      );
    }

    if (password.length < 8) {
      throw new BadRequestException(
        'Password must contain at least 8 characters',
      );
    }

    if (password.length > 72) {
      throw new BadRequestException(
        'Password is too long',
      );
    }

    const hash = await bcrypt.hash(password, 12);

    try {
      const q = await this.db.query(
        `INSERT INTO users
         (full_name, email, password_hash, role, is_active)
         VALUES ($1, $2, $3, 'EMPLOYEE', true)
         RETURNING
           id, full_name, email, role,
           is_active, created_at`,
        [name, email, hash],
      );

      const user = q.rows[0];

      return {
        token: this.token(user),
        user: {
          ...user,
          role: this.normalizeRole(user.role),
        },
      };
    } catch (e: any) {
      if (e.code === '23505') {
        throw new BadRequestException(
          'Email already registered',
        );
      }

      throw e;
    }
  }

  // ==========================================
  // DESKS
  // ==========================================

  async desks() {
    const q = await this.db.query(`
      SELECT
        d.*,
        z.name AS zone_name,

        (
          SELECT COUNT(*)
          FROM bookings b
          WHERE b.desk_id = d.id
            AND UPPER(b.status) = 'APPROVED'
            AND (b.booking_date + b.start_time) <= NOW()
            AND (b.booking_date + b.end_time) > NOW()
        ) AS occupied

      FROM desks d
      LEFT JOIN zones z ON z.id = d.zone_id
      ORDER BY d.code
    `);

    return q.rows.map((d) => ({
      ...d,
      status: this.normalizeStatus(d.status),
      occupied: Number(d.occupied),
    }));
  }

  // ==========================================
  // BOOKINGS
  // ==========================================

  async bookings(user: any, all = false) {
    const sql = `
      SELECT
        b.*,
        u.full_name AS employee_name,
        u.email,
        d.code AS desk_code,
        z.name AS zone_name,
        (b.booking_date + b.start_time) AS start_at,
        (b.booking_date + b.end_time) AS end_at

      FROM bookings b

      JOIN users u ON u.id = b.user_id
      JOIN desks d ON d.id = b.desk_id
      LEFT JOIN zones z ON z.id = d.zone_id

      ${all ? '' : 'WHERE b.user_id = $1'}

      ORDER BY b.created_at DESC
    `;

    const q = await this.db.query(
      sql,
      all ? [] : [user.sub],
    );

    return q.rows.map((b) => ({
      ...b,
      status: this.normalizeStatus(b.status),
    }));
  }

  async createBooking(user: any, b: any) {
    if (!b.deskId || !b.startAt || !b.endAt) {
      throw new BadRequestException(
        'Desk, start time and end time are required',
      );
    }

    const start = new Date(b.startAt);
    const end = new Date(b.endAt);

    if (
      isNaN(start.getTime()) ||
      isNaN(end.getTime()) ||
      start >= end ||
      start < new Date()
    ) {
      throw new BadRequestException(
        'Choose a valid future time range',
      );
    }

    const bookingDate = start.toISOString().slice(0, 10);
    const startTime = start.toISOString().slice(11, 19);
    const endTime = end.toISOString().slice(11, 19);

    if (
      end.toISOString().slice(0, 10) !== bookingDate
    ) {
      throw new BadRequestException(
        'Bookings must start and end on the same date',
      );
    }

    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      // Prevent concurrent booking operations on the same desk.
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [String(b.deskId)],
      );

      const desk = await client.query(
        `SELECT id
         FROM desks
         WHERE id = $1
           AND UPPER(status) = 'AVAILABLE'
         FOR UPDATE`,
        [b.deskId],
      );

      if (!desk.rowCount) {
        throw new BadRequestException(
          'Desk is unavailable',
        );
      }

      const conflict = await client.query(
        `SELECT id
         FROM bookings
         WHERE desk_id = $1
           AND booking_date = $2
           AND UPPER(status) IN ('PENDING', 'APPROVED')
           AND start_time < $4
           AND end_time > $3
         LIMIT 1`,
        [
          b.deskId,
          bookingDate,
          startTime,
          endTime,
        ],
      );

      if (conflict.rowCount) {
        throw new BadRequestException(
          'This desk is already booked for the selected time',
        );
      }

      // DATABASE CHECK CONSTRAINT: UPPERCASE.
      const status =
        process.env.REQUIRE_BOOKING_APPROVAL === 'true'
          ? 'PENDING'
          : 'APPROVED';

      const q = await client.query(
        `INSERT INTO bookings
         (
           user_id,
           desk_id,
           booking_date,
           start_time,
           end_time,
           status
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          user.sub,
          b.deskId,
          bookingDate,
          startTime,
          endTime,
          status,
        ],
      );

      await this.writeLog(
        client,
        user.sub,
        'BOOKING_CREATED',
        'booking',
        q.rows[0].id,
        {
          deskId: b.deskId,
          status,
        },
      );

      await client.query('COMMIT');

      this.emit('desk:update', {
        deskId: b.deskId,
      });

      this.emit('requests:update');

      return {
        ...q.rows[0],
        status: this.normalizeStatus(q.rows[0].status),
      };
    } catch (e) {
      await this.rollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

  // ==========================================
  // CANCEL BOOKING
  // ==========================================

  async cancelBooking(
    user: any,
    id: string,
    reason: string,
  ) {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      const q = await client.query(
        `UPDATE bookings
         SET status = 'CANCELLED'
         WHERE id = $1
           AND user_id = $2
           AND UPPER(status) IN ('PENDING', 'APPROVED')
         RETURNING *`,
        [id, user.sub],
      );

      if (!q.rowCount) {
        throw new BadRequestException(
          'Booking cannot be cancelled',
        );
      }

      await this.writeLog(
        client,
        user.sub,
        'BOOKING_CANCELLED',
        'booking',
        id,
        {
          reason: String(reason || '').trim() || null,
        },
      );

      await client.query('COMMIT');

      this.emit('desk:update', {
        deskId: q.rows[0].desk_id,
      });

      this.emit('requests:update');

      return {
        ...q.rows[0],
        status: this.normalizeStatus(q.rows[0].status),
      };
    } catch (e) {
      await this.rollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

  // ==========================================
  // DESK CHANGE REQUESTS
  // ==========================================

  async changeRequest(user: any, b: any) {
    if (!b.currentDeskId || !b.requestedDeskId) {
      throw new BadRequestException(
        'Select both desks',
      );
    }

    if (
      String(b.currentDeskId) ===
      String(b.requestedDeskId)
    ) {
      throw new BadRequestException(
        'Choose a different desk',
      );
    }

    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      const own = await client.query(
        `SELECT
           id,
           desk_id,
           booking_date,
           start_time,
           end_time

         FROM bookings

         WHERE user_id = $1
           AND desk_id = $2
           AND UPPER(status) = 'APPROVED'
           AND (booking_date + end_time) > NOW()

         ORDER BY booking_date, start_time
         LIMIT 1

         FOR UPDATE`,
        [user.sub, b.currentDeskId],
      );

      if (!own.rowCount) {
        throw new BadRequestException(
          'You need an active or upcoming approved booking for the current desk',
        );
      }

      const booking = own.rows[0];

      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [String(b.requestedDeskId)],
      );

      const target = await client.query(
        `SELECT id
         FROM desks
         WHERE id = $1
           AND UPPER(status) = 'AVAILABLE'
         FOR UPDATE`,
        [b.requestedDeskId],
      );

      if (!target.rowCount) {
        throw new BadRequestException(
          'Requested desk is unavailable',
        );
      }

      const existing = await client.query(
        `SELECT id
         FROM desk_change_requests
         WHERE booking_id = $1
           AND UPPER(status) = 'PENDING'
         LIMIT 1`,
        [booking.id],
      );

      if (existing.rowCount) {
        throw new BadRequestException(
          'This booking already has a pending desk change request',
        );
      }

      // IMPORTANT:
      // Your PostgreSQL CHECK constraint accepts
      // PENDING, APPROVED and REJECTED only.
      // Never insert lowercase pending here.

      const q = await client.query(
        `INSERT INTO desk_change_requests
         (
           booking_id,
           requested_desk_id,
           reason,
           status
         )
         VALUES ($1, $2, $3, 'PENDING')
         RETURNING *`,
        [
          booking.id,
          b.requestedDeskId,
          String(b.reason || '').trim() || null,
        ],
      );

      await this.writeLog(
        client,
        user.sub,
        'DESK_CHANGE_REQUESTED',
        'desk_change_request',
        q.rows[0].id,
        {
          currentDeskId: b.currentDeskId,
          requestedDeskId: b.requestedDeskId,
          reason: b.reason || null,
        },
      );

      await client.query('COMMIT');

      this.emit('requests:update');

      return {
        ...q.rows[0],
        status: this.normalizeStatus(q.rows[0].status),
      };
    } catch (e) {
      await this.rollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

  // ==========================================
  // LIST DESK CHANGES
  // ==========================================

  async changes(user: any, all = false) {
    const sql = `
      SELECT
        r.*,

        u.id AS user_id,
        u.full_name AS employee_name,
        u.email,

        c.id AS current_desk_id,
        c.code AS current_desk_code,

        n.id AS requested_desk_id,
        n.code AS requested_desk_code

      FROM desk_change_requests r

      JOIN bookings b ON b.id = r.booking_id
      JOIN users u ON u.id = b.user_id
      JOIN desks c ON c.id = b.desk_id
      JOIN desks n ON n.id = r.requested_desk_id

      ${all ? '' : 'WHERE b.user_id = $1'}

      ORDER BY r.created_at DESC
    `;

    const q = await this.db.query(
      sql,
      all ? [] : [user.sub],
    );

    return q.rows.map((r) => ({
      ...r,
      status: this.normalizeStatus(r.status),
    }));
  }

  // ==========================================
  // ADMIN REVIEW
  // ==========================================

  async review(
    user: any,
    type: string,
    id: string,
    status: string,
    comment: string,
  ) {
    status = this.normalizeStatus(status);
    type = String(type || '').toLowerCase();

    if (!['approved', 'rejected'].includes(status)) {
      throw new BadRequestException(
        'Invalid decision',
      );
    }

    if (!['booking', 'desk-change'].includes(type)) {
      throw new BadRequestException(
        'Invalid review type',
      );
    }

    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      // ======================================
      // BOOKING REVIEW
      // ======================================

      if (type === 'booking') {
        const booking = await client.query(
          `SELECT *
           FROM bookings
           WHERE id = $1
             AND UPPER(status) = 'PENDING'
           FOR UPDATE`,
          [id],
        );

        if (!booking.rowCount) {
          throw new NotFoundException(
            'Pending booking not found',
          );
        }

        const x = booking.rows[0];

        if (status === 'approved') {
          await client.query(
            'SELECT pg_advisory_xact_lock(hashtext($1))',
            [String(x.desk_id)],
          );

          const conflict = await client.query(
            `SELECT id
             FROM bookings
             WHERE desk_id = $1
               AND id <> $2
               AND booking_date = $3
               AND UPPER(status) = 'APPROVED'
               AND start_time < $5
               AND end_time > $4
             LIMIT 1`,
            [
              x.desk_id,
              id,
              x.booking_date,
              x.start_time,
              x.end_time,
            ],
          );

          if (conflict.rowCount) {
            throw new BadRequestException(
              'This booking conflicts with an existing approved booking',
            );
          }

          const desk = await client.query(
            `SELECT id
             FROM desks
             WHERE id = $1
               AND UPPER(status) = 'AVAILABLE'
             FOR UPDATE`,
            [x.desk_id],
          );

          if (!desk.rowCount) {
            throw new BadRequestException(
              'The booked desk is no longer available',
            );
          }
        }

        // DATABASE STATUS MUST BE UPPERCASE.
        const dbStatus = status.toUpperCase();

        await client.query(
          `UPDATE bookings
           SET status = $2,
               approved_by = $3
           WHERE id = $1`,
          [id, dbStatus, user.sub],
        );

        await this.writeLog(
          client,
          user.sub,
          status === 'approved'
            ? 'BOOKING_APPROVED'
            : 'BOOKING_REJECTED',
          'booking',
          id,
          {
            comment: String(comment || '').trim() || null,
          },
        );
      }

      // ======================================
      // DESK CHANGE REVIEW
      // ======================================

      else {
        const request = await client.query(
          `SELECT
             r.*,

             b.user_id,
             b.id AS booking_id,
             b.desk_id AS current_desk_id,
             b.booking_date,
             b.start_time,
             b.end_time,
             b.status AS booking_status

           FROM desk_change_requests r

           JOIN bookings b ON b.id = r.booking_id

           WHERE r.id = $1
             AND UPPER(r.status) = 'PENDING'

           FOR UPDATE OF r, b`,
          [id],
        );

        if (!request.rowCount) {
          throw new NotFoundException(
            'Pending desk change not found',
          );
        }

        const x = request.rows[0];

        if (status === 'approved') {
          // Check the original booking using PostgreSQL time,
          // avoiding JavaScript timezone conversion problems.

          const bookingValidity = await client.query(
            `SELECT
               (
                 UPPER($1) = 'APPROVED'
                 AND ($2::date + $3::time) > NOW()
               ) AS valid`,
            [
              x.booking_status,
              x.booking_date,
              x.end_time,
            ],
          );

          if (!bookingValidity.rows[0].valid) {
            throw new BadRequestException(
              'The original booking is no longer active or upcoming',
            );
          }

          await client.query(
            'SELECT pg_advisory_xact_lock(hashtext($1))',
            [String(x.requested_desk_id)],
          );

          const target = await client.query(
            `SELECT id
             FROM desks
             WHERE id = $1
               AND UPPER(status) = 'AVAILABLE'
             FOR UPDATE`,
            [x.requested_desk_id],
          );

          if (!target.rowCount) {
            throw new BadRequestException(
              'Requested desk is unavailable',
            );
          }

          const conflict = await client.query(
            `SELECT id
             FROM bookings
             WHERE desk_id = $1
               AND id <> $2
               AND booking_date = $3
               AND UPPER(status) IN ('PENDING', 'APPROVED')
               AND start_time < $5
               AND end_time > $4
             LIMIT 1`,
            [
              x.requested_desk_id,
              x.booking_id,
              x.booking_date,
              x.start_time,
              x.end_time,
            ],
          );

          if (conflict.rowCount) {
            throw new BadRequestException(
              'Requested desk conflicts with another booking',
            );
          }

          // Reassign the original booking.
          await client.query(
            `UPDATE bookings
             SET desk_id = $1
             WHERE id = $2`,
            [
              x.requested_desk_id,
              x.booking_id,
            ],
          );
        }

        // IMPORTANT:
        // Save uppercase status to satisfy
        // desk_change_requests_status_check.

        await client.query(
          `UPDATE desk_change_requests
           SET status = $2,
               reviewed_by = $3,
               admin_comment = $4,
               reviewed_at = NOW()
           WHERE id = $1`,
          [
            id,
            status.toUpperCase(),
            user.sub,
            String(comment || '').trim() || null,
          ],
        );

        await this.writeLog(
          client,
          user.sub,
          status === 'approved'
            ? 'DESK_CHANGE_APPROVED'
            : 'DESK_CHANGE_REJECTED',
          'desk_change_request',
          id,
          {
            comment: comment || null,
            requestedDeskId: x.requested_desk_id,
          },
        );
      }

      await client.query('COMMIT');

      this.emit('desk:update');
      this.emit('requests:update');

      return {
        success: true,
        status,
      };
    } catch (e) {
      await this.rollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

  // ==========================================
  // CREATE DESK
  // ==========================================

  async createDesk(user: any, b: any) {
    const code = String(b.code || '').trim();

    if (!code || !b.zoneId) {
      throw new BadRequestException(
        'Desk code and zone are required',
      );
    }

    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      const q = await client.query(
        `INSERT INTO desks
         (code, zone_id, status)
         VALUES ($1, $2, 'AVAILABLE')
         RETURNING *`,
        [code, b.zoneId],
      );

      await this.writeLog(
        client,
        user.sub,
        'DESK_CREATED',
        'desk',
        q.rows[0].id,
        {
          code,
          zoneId: b.zoneId,
        },
      );

      await client.query('COMMIT');

      this.emit('desk:update');

      return {
        ...q.rows[0],
        status: this.normalizeStatus(q.rows[0].status),
      };
    } catch (e: any) {
      await this.rollback(client);

      if (e.code === '23505') {
        throw new BadRequestException(
          'A desk with this code already exists',
        );
      }

      if (e.code === '23503') {
        throw new BadRequestException(
          'Selected zone does not exist',
        );
      }

      throw e;
    } finally {
      client.release();
    }
  }

  // ==========================================
  // DELETE / DEACTIVATE DESK
  // ==========================================

  async deleteDesk(user: any, id: string) {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      const desk = await client.query(
        `SELECT id
         FROM desks
         WHERE id = $1
         FOR UPDATE`,
        [id],
      );

      if (!desk.rowCount) {
        throw new NotFoundException('Desk not found');
      }

      const bookings = await client.query(
        `SELECT id
         FROM bookings
         WHERE desk_id = $1
           AND UPPER(status) IN ('PENDING', 'APPROVED')
           AND (booking_date + end_time) > NOW()
         LIMIT 1`,
        [id],
      );

      if (bookings.rowCount) {
        throw new BadRequestException(
          'Cannot remove a desk with active or future bookings',
        );
      }

      const history = await client.query(
        `SELECT id
         FROM bookings
         WHERE desk_id = $1
         LIMIT 1`,
        [id],
      );

      if (history.rowCount) {
        // Preserve historical booking records.
        // DISABLED is supported by your database constraint.

        await client.query(
          `UPDATE desks
           SET status = 'DISABLED'
           WHERE id = $1`,
          [id],
        );

        await this.writeLog(
          client,
          user.sub,
          'DESK_DEACTIVATED',
          'desk',
          id,
          {
            reason: 'Historical bookings preserved',
          },
        );
      } else {
        await client.query(
          'DELETE FROM desks WHERE id = $1',
          [id],
        );

        await this.writeLog(
          client,
          user.sub,
          'DESK_DELETED',
          'desk',
          id,
        );
      }

      await client.query('COMMIT');

      this.emit('desk:update');

      return {
        success: true,
        message: history.rowCount
          ? 'Desk deactivated; historical records preserved'
          : 'Desk deleted',
      };
    } catch (e) {
      await this.rollback(client);
      throw e;
    } finally {
      client.release();
    }
  }

  // ==========================================
  // USERS
  // ==========================================

  async users() {
    const q = await this.db.query(
      `SELECT
         id,
         full_name AS name,
         email,
         role,
         is_active,
         created_at

       FROM users

       ORDER BY created_at DESC`,
    );

    return q.rows.map((u) => ({
      ...u,
      role: this.normalizeRole(u.role),
    }));
  }

  // ==========================================
  // AUDIT LOGS
  // ==========================================

  async logs() {
    const q = await this.db.query(
      `SELECT
         l.*,
         u.full_name AS actor_name,
         u.email AS actor_email

       FROM audit_logs l

       LEFT JOIN users u
         ON u.id = l.actor_user_id

       ORDER BY l.created_at DESC

       LIMIT 300`,
    );

    return q.rows;
  }

  // ==========================================
  // DASHBOARD STATISTICS
  // ==========================================

  async stats() {
    const q = await this.db.query(`
      SELECT

        (SELECT COUNT(*)
         FROM desks
        ) AS total_desks,

        (SELECT COUNT(DISTINCT desk_id)
         FROM bookings
         WHERE UPPER(status) = 'APPROVED'
           AND (booking_date + start_time) <= NOW()
           AND (booking_date + end_time) > NOW()
        ) AS occupied,

        (SELECT COUNT(*)
         FROM bookings
         WHERE UPPER(status) = 'PENDING'
        ) AS pending_bookings,

        (SELECT COUNT(*)
         FROM desk_change_requests
         WHERE UPPER(status) = 'PENDING'
        ) AS pending_changes
    `);

    return q.rows[0];
  }

  // ==========================================
  // ZONES
  // ==========================================

  async zones() {
    const q = await this.db.query(
      `SELECT *
       FROM zones
       ORDER BY name`,
    );

    return q.rows;
  }
}

