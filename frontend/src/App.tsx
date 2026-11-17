import React, { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import {
  Activity,
  Armchair,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardList,
  Clock,
  DoorOpen,
  LayoutDashboard,
  LogOut,
  Plus,
  RefreshCw,
  Settings,
  Users,
  X,
  History,
  ArrowLeftRight,
  Building2,
} from 'lucide-react';

// ======================================================
// API CONFIGURATION
// ======================================================

const API =
  import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const SOCKET_URL = API.replace(/\/api\/?$/, '');

// ======================================================
// TYPES
// ======================================================

type User = {
  id: string;
  name: string;
  full_name?: string;
  email: string;
  role: string;
};

type Desk = {
  id: string;
  code: string;
  floor: string;
  zone_name: string;
  zone_id?: string;
  status: string;
  occupied: number;
};

type ApiRecord = Record<string, any>;

// ======================================================
// HELPERS
// ======================================================

function normalizeStatus(value: any): string {
  return String(value || '').toLowerCase();
}

function normalizeUser(user: ApiRecord): User {
  return {
    ...user,
    id: String(user.id || ''),
    name:
      user.full_name ||
      user.name ||
      user.email ||
      'User',
    full_name:
      user.full_name ||
      user.name ||
      'User',
    email: user.email || '',
    role: String(user.role || 'EMPLOYEE').toUpperCase(),
  };
}

function normalizeDesk(desk: ApiRecord): Desk {
  return {
    ...desk,
    id: String(desk.id || ''),
    code: desk.code || 'Unknown desk',
    floor: desk.floor || 'Floor 1',
    zone_name:
      desk.zone_name ||
      desk.zone ||
      'Unassigned zone',
    zone_id: desk.zone_id || '',
    status: normalizeStatus(desk.status || 'available'),
    occupied: Number(desk.occupied || 0),
  };
}

function normalizeBooking(booking: ApiRecord): ApiRecord {
  return {
    ...booking,
    status: normalizeStatus(booking.status),
    employee_name:
      booking.employee_name ||
      booking.full_name ||
      booking.name ||
      '',
    start_at:
      booking.start_at ||
      booking.startAt ||
      '',
    end_at:
      booking.end_at ||
      booking.endAt ||
      '',
  };
}

function normalizeChange(change: ApiRecord): ApiRecord {
  return {
    ...change,
    status: normalizeStatus(change.status),
    employee_name:
      change.employee_name ||
      change.full_name ||
      change.name ||
      '',
  };
}

// Convert a JavaScript Date to the local datetime-local format.
// This avoids converting the user's local time into UTC.
function toLocalInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function getSavedUser(): User | null {
  try {
    const saved = localStorage.getItem('ds_user');

    if (!saved) return null;

    const parsed = JSON.parse(saved);

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return normalizeUser(parsed);
  } catch {
    localStorage.removeItem('ds_user');
    localStorage.removeItem('ds_token');
    return null;
  }
}

function formatDate(value: any): string {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function getErrorMessage(data: ApiRecord, fallback: string): string {
  if (Array.isArray(data.message)) {
    return data.message.join(', ');
  }

  return data.message || data.error || fallback;
}

// ======================================================
// MAIN APPLICATION
// ======================================================

export default function App() {
  const [token, setToken] = useState(
    localStorage.getItem('ds_token') || ''
  );

  const [user, setUser] = useState<User | null>(getSavedUser);

  const [page, setPage] = useState('Dashboard');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [desks, setDesks] = useState<Desk[]>([]);
  const [bookings, setBookings] = useState<ApiRecord[]>([]);
  const [changes, setChanges] = useState<ApiRecord[]>([]);
  const [stats, setStats] = useState<ApiRecord>({});
  const [logs, setLogs] = useState<ApiRecord[]>([]);
  const [people, setPeople] = useState<ApiRecord[]>([]);
  const [zones, setZones] = useState<ApiRecord[]>([]);

  const [filter, setFilter] = useState('All');
  const [modal, setModal] = useState('');
  const [selected, setSelected] = useState<ApiRecord | null>(null);
  const [form, setForm] = useState<ApiRecord>({});

  const admin = user?.role?.toUpperCase() === 'ADMIN';

  const displayName =
    user?.full_name ||
    user?.name ||
    user?.email ||
    'User';

  // ====================================================
  // API REQUEST HELPER
  // ====================================================

  const api = useCallback(
    async (path: string, opts: RequestInit = {}) => {
      const response = await fetch(API + path, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
          ...(token
            ? { Authorization: `Bearer ${token}` }
            : {}),
          ...(opts.headers || {}),
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem('ds_token');
          localStorage.removeItem('ds_user');
        }

        throw new Error(
          getErrorMessage(
            data,
            `Request failed (${response.status})`
          )
        );
      }

      return data;
    },
    [token]
  );

  // ====================================================
  // NOTIFICATIONS
  // ====================================================

  const notify = (message: string) => {
    setToast(message);

    window.setTimeout(() => {
      setToast('');
    }, 3000);
  };

  // ====================================================
  // LOAD APPLICATION DATA
  // ====================================================

  const refresh = useCallback(async () => {
    if (!token || !user) return;

    setLoading(true);

    try {
      const [deskData, bookingData, changeData, zoneData] =
        await Promise.all([
          api('/desks'),
          api('/bookings'),
          api('/desk-changes'),
          api('/zones'),
        ]);

      setDesks(
        Array.isArray(deskData)
          ? deskData.map(normalizeDesk)
          : []
      );

      setBookings(
        Array.isArray(bookingData)
          ? bookingData.map(normalizeBooking)
          : []
      );

      setChanges(
        Array.isArray(changeData)
          ? changeData.map(normalizeChange)
          : []
      );

      setZones(Array.isArray(zoneData) ? zoneData : []);

      if (admin) {
        const [statsData, logsData, peopleData] =
          await Promise.all([
            api('/admin/stats'),
            api('/admin/audit-logs'),
            api('/admin/users'),
          ]);

        setStats(statsData || {});
        setLogs(Array.isArray(logsData) ? logsData : []);
        setPeople(Array.isArray(peopleData) ? peopleData : []);
      }
    } catch (e: any) {
      setError(e.message || 'Unable to load application data');
    } finally {
      setLoading(false);
    }
  }, [token, user, admin, api]);

  useEffect(() => {
    if (token && user) {
      refresh();
    }
  }, [token, user, refresh]);

  // ====================================================
  // REAL-TIME SOCKET CONNECTION
  // ====================================================

  
useEffect(() => {
  if (!token) return;

  const socket = io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    console.log('DeskSync connected:', socket.id);
  });

  socket.on('connect_error', (error) => {
    console.error('DeskSync WebSocket error:', error.message);
  });

  socket.on('desk:update', () => {
    refresh();
  });

  socket.on('requests:update', () => {
    refresh();
  });

  socket.on('disconnect', (reason) => {
    console.log('DeskSync disconnected:', reason);
  });

  return () => {
    socket.disconnect();
  };
}, [token, refresh]);


  // ====================================================
  // LOGIN
  // ====================================================

  const handleLogin = (newToken: string, rawUser: ApiRecord) => {
    const normalized = normalizeUser(rawUser);

    localStorage.setItem('ds_token', newToken);
    localStorage.setItem(
      'ds_user',
      JSON.stringify(normalized)
    );

    setToken(newToken);
    setUser(normalized);
    setPage('Dashboard');
    setError('');
  };

  // ====================================================
  // LOGOUT
  // ====================================================

  const logout = () => {
    localStorage.removeItem('ds_token');
    localStorage.removeItem('ds_user');

    setToken('');
    setUser(null);

    setDesks([]);
    setBookings([]);
    setChanges([]);
    setStats({});
    setLogs([]);
    setPeople([]);
    setZones([]);

    setPage('Dashboard');
    setFilter('All');
    setError('');
    setModal('');
  };

  // ====================================================
  // COMMON ACTION HANDLER
  // ====================================================

  const run = async (
    fn: () => Promise<any>,
    success: string
  ) => {
    setBusy(true);
    setError('');

    try {
      await fn();
      await refresh();

      notify(success);
      setModal('');
      setSelected(null);
      setForm({});
    } catch (e: any) {
      setError(e.message || 'Operation failed');
    } finally {
      setBusy(false);
    }
  };

  // ====================================================
  // NAVIGATION
  // ====================================================

  const nav = admin
    ? [
        'Dashboard',
        'Booking Requests',
        'Desk Changes',
        'Desk Management',
        'Live View',
        'Reports',
        'Audit Logs',
        'Users',
      ]
    : [
        'Dashboard',
        'Office Layout',
        'My Bookings',
        'Request Desk Change',
      ];

  // ====================================================
  // SUMMARY VALUES
  // ====================================================

  const activeBookings = bookings.filter((booking) =>
    ['approved', 'pending'].includes(booking.status)
  );

  const occupied = desks.filter(
    (desk) => Number(desk.occupied) > 0
  ).length;

  const available = desks.filter(
    (desk) =>
      desk.status === 'available' &&
      Number(desk.occupied) === 0
  ).length;

  const pendingBookings = bookings.filter(
    (booking) => booking.status === 'pending'
  ).length;

  const pendingChanges = changes.filter(
    (change) => change.status === 'pending'
  ).length;

  // ====================================================
  // LOGIN SCREEN
  // ====================================================

  if (!token || !user) {
    return <Login onLogin={handleLogin} />;
  }

  // ====================================================
  // BOOKING FORM
  // ====================================================

  const openBooking = (desk: Desk) => {
    const start = new Date(Date.now() + 60 * 60 * 1000);
    const end = new Date(Date.now() + 2 * 60 * 60 * 1000);

    setSelected(desk);

    setForm({
      startAt: toLocalInputValue(start),
      endAt: toLocalInputValue(end),
      note: '',
    });

    setError('');
    setModal('book');
  };

  // ====================================================
  // NAVIGATION ICONS
  // ====================================================

  const navIcon = (name: string) => {
    const icons: Record<string, any> = {
      Dashboard: LayoutDashboard,
      'Booking Requests': ClipboardList,
      'Desk Changes': ArrowLeftRight,
      'Desk Management': Settings,
      'Live View': Activity,
      Reports: CalendarDays,
      'Audit Logs': History,
      Users: Users,
      'Office Layout': Building2,
      'My Bookings': CalendarDays,
      'Request Desk Change': RefreshCw,
    };

    const Icon = icons[name] || LayoutDashboard;

    return <Icon size={17} />;
  };

  // ====================================================
  // STATUS BADGE
  // ====================================================

  const status = (value: string) => {
    const normalized = normalizeStatus(value);

    return (
      <span className={`pill ${normalized}`}>
        {normalized || 'unknown'}
      </span>
    );
  };

  // ====================================================
  // REUSABLE TABLE
  // ====================================================

  const table = (
    heads: string[],
    rows: React.ReactNode[][]
  ) => (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            {heads.map((head) => (
              <th key={head}>{head}</th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.length > 0 ? (
            rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={heads.length} className="empty">
                Nothing to show yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  // ====================================================
  // ADMIN APPROVAL / REJECTION
  // ====================================================

  const approve = (
    type: 'booking' | 'desk-change',
    id: string,
    requestStatus: 'approved' | 'rejected'
  ) =>
    run(
      () =>
        api(`/admin/review/${type}/${id}`, {
          method: 'POST',
          body: JSON.stringify({
            status: requestStatus,
            comment: form.comment || '',
          }),
        }),
      `Request ${requestStatus}`
    );

  // ====================================================
  // DESK CARDS
  // ====================================================

  const deskCards = (
    <div className="deskgrid">
      {desks
        .filter(
          (desk) =>
            filter === 'All' ||
            desk.zone_name === filter
        )
        .map((desk) => {
          const isOccupied = Number(desk.occupied) > 0;
          const isAvailable =
            desk.status === 'available' && !isOccupied;

          return (
            <button
              className={
                'desk ' +
                (isOccupied
                  ? 'occupied'
                  : !isAvailable
                    ? 'maintenance'
                    : 'available')
              }
              key={desk.id}
              onClick={() => openBooking(desk)}
              disabled={!admin && !isAvailable}
            >
              <Armchair size={20} />

              <b>{desk.code}</b>

              <small>
                {desk.zone_name} · {desk.floor}
              </small>

              <span>
                {isOccupied
                  ? 'Occupied'
                  : isAvailable
                    ? 'Available'
                    : 'Unavailable'}
              </span>
            </button>
          );
        })}
    </div>
  );

  // ====================================================
  // PAGE CONTENT
  // ====================================================

  let content: React.ReactNode = null;

  // ====================================================
  // DASHBOARD
  // ====================================================

  if (page === 'Dashboard') {
    const currentBooking = activeBookings.find(
      (booking) => booking.status === 'approved'
    );

    content = (
      <>
        <div className="welcome">
          <div>
            <div className="eyebrow">
              WORKSPACE OVERVIEW
            </div>

            <h1>
              {admin
                ? 'Dashboard Overview'
                : `Welcome back, ${displayName.split(' ')[0]}`}
            </h1>

            <p>
              {admin
                ? 'Real-time workspace utilization and booking metrics.'
                : 'Here is your workspace overview.'}
            </p>
          </div>

          <button className="btn ghost" onClick={refresh}>
            <RefreshCw size={15} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {admin ? (
          <>
            <div className="stats">
              <Stat
                label="Total desks"
                value={stats.total_desks ?? desks.length}
                icon={<Armchair />}
              />

              <Stat
                label="Occupied now"
                value={stats.occupied ?? occupied}
                icon={<Users />}
              />

              <Stat
                label="Available"
                value={available}
                icon={<DoorOpen />}
              />

              <Stat
                label="Pending requests"
                value={
                  (Number(stats.pending_bookings) || pendingBookings) +
                  (Number(stats.pending_changes) || pendingChanges)
                }
                icon={<Clock />}
              />
            </div>

            <div className="panels">
              <section className="panel">
                <h3>Floor-wise utilization</h3>

                {desks.length > 0 ? (
                  Object.entries(
                    desks.reduce(
                      (result: Record<string, Desk[]>, desk) => {
                        const floor = desk.floor || 'Floor 1';

                        if (!result[floor]) {
                          result[floor] = [];
                        }

                        result[floor].push(desk);

                        return result;
                      },
                      {}
                    )
                  ).map(([floor, floorDesks]) => {
                    const items = floorDesks as Desk[];

                    const percentage = Math.round(
                      (items.filter(
                        (desk) => Number(desk.occupied) > 0
                      ).length /
                        items.length) *
                        100
                    );

                    return (
                      <div className="barrow" key={floor}>
                        <span>{floor}</span>

                        <div className="bar">
                          <i
                            style={{
                              width: `${percentage}%`,
                            }}
                          />
                        </div>

                        <b>{percentage}%</b>
                      </div>
                    );
                  })
                ) : (
                  <p className="muted">
                    Add desks to view utilization.
                  </p>
                )}
              </section>

              <section className="panel">
                <h3>Recent activity</h3>

                {logs.slice(0, 5).length > 0 ? (
                  logs.slice(0, 5).map((log, index) => (
                    <div
                      className="activity"
                      key={log.id || index}
                    >
                      <span className="dot" />

                      <div>
                        <b>
                          {String(
                            log.action || 'Activity'
                          ).replace(/_/g, ' ')}
                        </b>

                        <small>
                          {log.actor_name || 'System'} ·{' '}
                          {formatDate(log.created_at)}
                        </small>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    No recent activity.
                  </p>
                )}
              </section>
            </div>
          </>
        ) : (
          <>
            <div className="employeehero">
              <div>
                <span className="eyebrow">MY DESK</span>

                <h2>
                  {currentBooking?.desk_code ||
                    'No active desk assigned'}
                </h2>

                <p>
                  {currentBooking
                    ? `Your current reservation · ${formatDate(
                        currentBooking.start_at
                      )}`
                    : 'Book a desk to reserve your workspace.'}
                </p>
              </div>

              <div className="heroactions">
                <button
                  className="btn primary"
                  onClick={() => setPage('Office Layout')}
                >
                  View Office Layout
                </button>

                <button
                  className="btn ghost"
                  onClick={() => setPage('Request Desk Change')}
                >
                  Request Desk Change
                </button>
              </div>
            </div>

            <div className="stats">
              <Stat
                label="My bookings"
                value={bookings.length}
                icon={<CalendarDays />}
              />

              <Stat
                label="Pending requests"
                value={pendingChanges}
                icon={<Clock />}
              />

              <Stat
                label="Available desks"
                value={available}
                icon={<Armchair />}
              />
            </div>
          </>
        )}
      </>
    );
  }

  // ====================================================
  // OFFICE LAYOUT / LIVE VIEW
  // ====================================================

  if (
    page === 'Office Layout' ||
    page === 'Live View'
  ) {
    content = (
      <>
        <div className="welcome">
          <div>
            <div className="eyebrow">WORKSPACE MAP</div>

            <h1>
              {admin ? 'Live Office View' : 'Select Your Desk'}
            </h1>

            <p>
              Choose an available desk to book.
              Occupancy refreshes live.
            </p>
          </div>

          <button className="btn ghost" onClick={refresh}>
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>

        <div className="legend">
          <span><i className="green" /> Available</span>
          <span><i className="red" /> Occupied</span>
          <span><i className="orange" /> Unavailable</span>
        </div>

        <div className="filters">
          <button
            className={filter === 'All' ? 'selected' : ''}
            onClick={() => setFilter('All')}
          >
            All zones
          </button>

          {zones.map((zone) => (
            <button
              key={zone.id || zone.name}
              className={
                filter === zone.name ? 'selected' : ''
              }
              onClick={() => setFilter(zone.name)}
            >
              {zone.name}
            </button>
          ))}
        </div>

        {deskCards}
      </>
    );
  }

  // ====================================================
  // BOOKING REQUESTS / MY BOOKINGS
  // ====================================================

  if (
    page === 'My Bookings' ||
    page === 'Booking Requests'
  ) {
    content = (
      <>
        <div className="welcome">
          <div>
            <div className="eyebrow">RESERVATIONS</div>

            <h1>
              {admin ? 'Booking Requests' : 'Booking Status'}
            </h1>

            <p>
              {admin
                ? 'Manage and respond to employee desk booking requests.'
                : 'Track your current and past bookings.'}
            </p>
          </div>

          <button className="btn ghost" onClick={refresh}>
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>

        {admin && (
          <div className="filters">
            {[
              'All',
              'pending',
              'approved',
              'rejected',
              'cancelled',
            ].map((value) => (
              <button
                key={value}
                className={
                  filter === value ? 'selected' : ''
                }
                onClick={() => setFilter(value)}
              >
                {value}
              </button>
            ))}
          </div>
        )}

        {table(
          [
            'Employee',
            'Desk',
            'Zone',
            'Start',
            'End',
            'Status',
            'Actions',
          ],
          bookings
            .filter(
              (booking) =>
                !admin ||
                filter === 'All' ||
                booking.status === filter
            )
            .map((booking) => [
              <div>
                <b>
                  {booking.employee_name || displayName}
                </b>

                <small>
                  {booking.email || user.email}
                </small>
              </div>,

              booking.desk_code || '—',
              booking.zone_name || '—',
              formatDate(booking.start_at),
              formatDate(booking.end_at),
              status(booking.status),

              <div className="actions">
                {admin && booking.status === 'pending' ? (
                  <>
                    <button
                      className="iconbtn good"
                      title="Approve booking"
                      onClick={() =>
                        approve(
                          'booking',
                          booking.id,
                          'approved'
                        )
                      }
                    >
                      <Check size={15} />
                    </button>

                    <button
                      className="iconbtn bad"
                      title="Reject booking"
                      onClick={() =>
                        approve(
                          'booking',
                          booking.id,
                          'rejected'
                        )
                      }
                    >
                      <X size={15} />
                    </button>
                  </>
                ) : !admin &&
                  ['pending', 'approved'].includes(
                    booking.status
                  ) ? (
                  <button
                    className="btn danger small"
                    onClick={() => {
                      setSelected(booking);
                      setForm({ reason: '' });
                      setModal('cancel');
                    }}
                  >
                    Cancel
                  </button>
                ) : (
                  '—'
                )}
              </div>,
            ])
        )}
      </>
    );
  }

  // ====================================================
  // DESK CHANGE REQUESTS
  // ====================================================

  if (
    page === 'Request Desk Change' ||
    page === 'Desk Changes'
  ) {
    content = (
      <>
        <div className="welcome">
          <div>
            <div className="eyebrow">DESK REASSIGNMENT</div>

            <h1>
              {admin
                ? 'Desk Change Requests'
                : 'Request Desk Change'}
            </h1>

            <p>
              {admin
                ? 'Review and respond to employee desk reassignment requests.'
                : 'Submit a request to change your assigned desk.'}
            </p>
          </div>
        </div>

        {!admin && (
          <section className="panel formpanel">
            <h3>New desk change request</h3>

            <label>
              Current booking

              <select
                value={form.bookingId || ''}
                onChange={(event) =>
                  setForm({
                    ...form,
                    bookingId: event.target.value,
                  })
                }
              >
                <option value="">
                  Select your approved booking
                </option>

                {bookings
                  .filter(
                    (booking) =>
                      booking.status === 'approved'
                  )
                  .map((booking) => (
                    <option
                      key={booking.id}
                      value={booking.id}
                    >
                      {booking.desk_code || 'Desk'} ·{' '}
                      {formatDate(booking.start_at)}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              Requested desk

              <select
                value={form.requestedDeskId || ''}
                onChange={(event) =>
                  setForm({
                    ...form,
                    requestedDeskId: event.target.value,
                  })
                }
              >
                <option value="">Select a desk</option>

                {desks
                  .filter(
                    (desk) =>
                      desk.status === 'available' &&
                      Number(desk.occupied) === 0
                  )
                  .map((desk) => (
                    <option
                      key={desk.id}
                      value={desk.id}
                    >
                      {desk.code} · {desk.zone_name} ·{' '}
                      {desk.floor}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              Reason

              <textarea
                value={form.reason || ''}
                onChange={(event) =>
                  setForm({
                    ...form,
                    reason: event.target.value,
                  })
                }
                placeholder="Explain why you need a desk change..."
              />
            </label>

            <button
              className="btn primary"
              disabled={
                busy ||
                !form.bookingId ||
                !form.requestedDeskId ||
                !String(form.reason || '').trim()
              }
              onClick={() =>
                run(
                  () =>
                    api('/desk-changes', {
                      method: 'POST',
                      body: JSON.stringify({
                        bookingId: form.bookingId,
                        requestedDeskId: form.requestedDeskId,
                        reason: form.reason.trim(),
                      }),
                    }),
                  'Desk change request submitted'
                )
              }
            >
              {busy ? 'Submitting...' : 'Submit request'}
            </button>
          </section>
        )}

        {admin && (
          <div className="filters">
            {['All', 'pending', 'approved', 'rejected'].map(
              (value) => (
                <button
                  key={value}
                  className={
                    filter === value ? 'selected' : ''
                  }
                  onClick={() => setFilter(value)}
                >
                  {value}
                </button>
              )
            )}
          </div>
        )}

        {table(
          [
            'Employee',
            'Current desk',
            'Requested desk',
            'Reason',
            'Status',
            'Admin comment',
            'Actions',
          ],
          changes
            .filter(
              (change) =>
                !admin ||
                filter === 'All' ||
                change.status === filter
            )
            .map((change) => [
              change.employee_name || displayName,
              change.current_desk_code || '—',
              change.requested_desk_code || '—',
              change.reason || '—',
              status(change.status),
              change.admin_comment || '—',

              admin && change.status === 'pending' ? (
                <div className="actions">
                  <button
                    className="iconbtn good"
                    title="Approve desk change"
                    onClick={() =>
                      approve(
                        'desk-change',
                        change.id,
                        'approved'
                      )
                    }
                  >
                    <Check size={15} />
                  </button>

                  <button
                    className="iconbtn bad"
                    title="Reject desk change"
                    onClick={() =>
                      approve(
                        'desk-change',
                        change.id,
                        'rejected'
                      )
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              ) : (
                '—'
              ),
            ])
        )}
      </>
    );
  }

  // ====================================================
  // DESK MANAGEMENT
  // ====================================================

  if (page === 'Desk Management') {
    content = (
      <>
        <div className="welcome">
          <div>
            <div className="eyebrow">ADMINISTRATION</div>

            <h1>Desk Management</h1>

            <p>
              Add and manage office desks.
            </p>
          </div>

          <button
            className="btn primary"
            onClick={() => {
              setForm({
                code: '',
                zoneId: '',
                floor: 'Floor 1',
              });

              setModal('adddesk');
            }}
          >
            <Plus size={16} />
            Add Desk
          </button>
        </div>

        {table(
          [
            'Desk ID',
            'Floor',
            'Zone',
            'Status',
            'Actions',
          ],
          desks.map((desk) => [
            <b>{desk.code}</b>,
            desk.floor,
            desk.zone_name || '—',

            status(
              Number(desk.occupied) > 0
                ? 'occupied'
                : desk.status
            ),

            <button
              className="iconbtn bad"
              title="Delete desk"
              onClick={() => {
                const confirmed = window.confirm(
                  `Are you sure you want to delete desk ${desk.code}?`
                );

                if (!confirmed) return;

                run(
                  () =>
                    api(`/admin/desks/${desk.id}`, {
                      method: 'DELETE',
                    }),
                  'Desk deleted'
                );
              }}
            >
              <X size={15} />
            </button>,
          ])
        )}
      </>
    );
  }

  // ====================================================
  // AUDIT LOGS
  // ====================================================

  if (page === 'Audit Logs') {
    content = (
      <>
        <div className="welcome">
          <div>
            <div className="eyebrow">ACCOUNTABILITY</div>

            <h1>Audit Logs</h1>

            <p>
              Complete record of workspace actions.
            </p>
          </div>

          <button className="btn ghost" onClick={refresh}>
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>

        {table(
          [
            'Date',
            'Action',
            'Actor',
            'Entity',
            'Details',
          ],
          logs.map((log) => [
            formatDate(log.created_at),
            <b>{log.action || '—'}</b>,
            log.actor_name || 'System',
            log.entity_type || '—',
            typeof log.details === 'object'
              ? JSON.stringify(log.details)
              : log.details || '—',
          ])
        )}
      </>
    );
  }

  // ====================================================
  // USERS
  // ====================================================

  if (page === 'Users') {
    content = (
      <>
        <div className="welcome">
          <div>
            <div className="eyebrow">ADMINISTRATION</div>

            <h1>Users</h1>

            <p>
              Employee and administrator accounts.
            </p>
          </div>

          <button className="btn ghost" onClick={refresh}>
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>

        {table(
          [
            'Name',
            'Email',
            'Department',
            'Role',
            'Status',
          ],
          people.map((person) => [
            person.full_name ||
              person.name ||
              'Unknown',
            person.email || '—',
            person.department || '—',
            person.role || 'EMPLOYEE',
            person.is_active ? 'Active' : 'Disabled',
          ])
        )}
      </>
    );
  }

  // ====================================================
  // REPORTS
  // ====================================================

  if (page === 'Reports') {
    content = (
      <>
        <div className="welcome">
          <div>
            <div className="eyebrow">ANALYTICS</div>

            <h1>Workspace Reports</h1>

            <p>
              Current desk utilization and booking activity.
            </p>
          </div>

          <button className="btn ghost" onClick={refresh}>
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>

        <div className="stats">
          <Stat
            label="Total desks"
            value={desks.length}
            icon={<Armchair />}
          />

          <Stat
            label="Occupied now"
            value={occupied}
            icon={<Users />}
          />

          <Stat
            label="Available now"
            value={available}
            icon={<DoorOpen />}
          />

          <Stat
            label="Bookings"
            value={bookings.length}
            icon={<CalendarDays />}
          />
        </div>

        {table(
          [
            'Desk',
            'Zone',
            'Floor',
            'Current status',
          ],
          desks.map((desk) => [
            desk.code,
            desk.zone_name,
            desk.floor,
            Number(desk.occupied) > 0
              ? 'Occupied'
              : desk.status === 'available'
                ? 'Available'
                : 'Unavailable',
          ])
        )}
      </>
    );
  }

  // ====================================================
  // MAIN APPLICATION LAYOUT
  // ====================================================

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark">D</div>

          <div>
            Desk<span>Sync</span>
            <small>HYBRID WORKSPACE</small>
          </div>
        </div>

        <div className="navlabel">WORKSPACE</div>

        {nav.map((item) => (
          <button
            key={item}
            className={
              'navitem ' +
              (page === item ? 'active' : '')
            }
            onClick={() => {
              setPage(item);
              setFilter('All');
              setError('');
            }}
          >
            {navIcon(item)}
            {item}
          </button>
        ))}

        <div className="sidebottom">
          <div className="profile">
            <div className="avatar">
              {displayName.charAt(0).toUpperCase()}
            </div>

            <div>
              <b>{displayName}</b>

              <small>
                {admin ? 'Administrator' : 'Employee'}
              </small>
            </div>
          </div>

          <button className="navitem" onClick={logout}>
            <LogOut size={17} />
            Logout
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb">
            DeskSync
            <ChevronRight size={14} />
            <b>{page}</b>
          </div>

          <div className="topright">
            <span className="livebadge">
              <i />
              Live
            </span>

            <div className="avatar">
              {displayName.charAt(0).toUpperCase()}
            </div>

            <span>{displayName}</span>

            <button
              className="iconbtn"
              title="Logout"
              onClick={logout}
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <div className="content">
          {error && (
            <div className="alert">
              {error}

              <button onClick={() => setError('')}>
                <X size={15} />
              </button>
            </div>
          )}

          {content}
        </div>
      </main>

      {toast && (
        <div className="toast">
          {toast}
        </div>
      )}

      {/* ================================================
          MODALS
      ================================================= */}

      {modal && (
        <div
          className="overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setModal('');
              setSelected(null);
            }
          }}
        >
          <section className="modal">
            <button
              className="close"
              onClick={() => {
                setModal('');
                setSelected(null);
              }}
            >
              <X />
            </button>

            {/* BOOK DESK */}

            {modal === 'book' && (
              <>
                <h2>Book {selected?.code}</h2>

                <p className="muted">
                  {selected?.zone_name} · {selected?.floor}
                </p>

                <label>
                  Start date & time

                  <input
                    type="datetime-local"
                    value={form.startAt || ''}
                    min={toLocalInputValue(new Date())}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        startAt: event.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  End date & time

                  <input
                    type="datetime-local"
                    value={form.endAt || ''}
                    min={form.startAt || toLocalInputValue(new Date())}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        endAt: event.target.value,
                      })
                    }
                  />
                </label>

                <label>
                  Note (optional)

                  <textarea
                    value={form.note || ''}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        note: event.target.value,
                      })
                    }
                    placeholder="Add an optional note..."
                  />
                </label>

                <button
                  className="btn primary full"
                  disabled={
                    busy ||
                    !form.startAt ||
                    !form.endAt ||
                    form.endAt <= form.startAt
                  }
                  onClick={() =>
                    run(
                      () =>
                        api('/bookings', {
                          method: 'POST',
                          body: JSON.stringify({
                            startAt: form.startAt,
                            endAt: form.endAt,
                            note: form.note || '',
                            deskId: selected?.id,
                          }),
                        }),
                      'Booking request submitted'
                    )
                  }
                >
                  {busy
                    ? 'Submitting...'
                    : 'Submit booking request'}
                </button>
              </>
            )}

            {/* CANCEL BOOKING */}

            {modal === 'cancel' && (
              <>
                <h2>Cancel booking</h2>

                <p className="muted">
                  Please provide a reason for cancelling.
                </p>

                <label>
                  Cancellation reason

                  <textarea
                    value={form.reason || ''}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        reason: event.target.value,
                      })
                    }
                    placeholder="Enter cancellation reason..."
                  />
                </label>

                <button
                  className="btn danger full"
                  disabled={
                    busy ||
                    !String(form.reason || '').trim()
                  }
                  onClick={() =>
                    run(
                      () =>
                        api(
                          `/bookings/${selected?.id}/cancel`,
                          {
                            method: 'POST',
                            body: JSON.stringify({
                              reason: form.reason.trim(),
                            }),
                          }
                        ),
                      'Booking cancelled'
                    )
                  }
                >
                  {busy
                    ? 'Cancelling...'
                    : 'Confirm cancellation'}
                </button>
              </>
            )}

            {/* ADD DESK */}

            {modal === 'adddesk' && (
              <>
                <h2>Add desk</h2>

                <label>
                  Desk code

                  <input
                    value={form.code || ''}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        code: event.target.value,
                      })
                    }
                    placeholder="e.g. C-101"
                  />
                </label>

                <label>
                  Zone

                  <select
                    value={form.zoneId || ''}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        zoneId: event.target.value,
                      })
                    }
                  >
                    <option value="">Select zone</option>

                    {zones.map((zone) => (
                      <option
                        key={zone.id}
                        value={zone.id}
                      >
                        {zone.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Floor

                  <input
                    value={form.floor || 'Floor 1'}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        floor: event.target.value,
                      })
                    }
                    placeholder="e.g. Floor 1"
                  />
                </label>

                <button
                  className="btn primary full"
                  disabled={
                    busy ||
                    !String(form.code || '').trim() ||
                    !form.zoneId ||
                    !String(form.floor || '').trim()
                  }
                  onClick={() =>
                    run(
                      () =>
                        api('/admin/desks', {
                          method: 'POST',
                          body: JSON.stringify({
                            code: form.code.trim(),
                            zoneId: form.zoneId,
                            floor: form.floor.trim(),
                          }),
                        }),
                      'Desk added successfully'
                    )
                  }
                >
                  {busy ? 'Adding...' : 'Add desk'}
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ======================================================
// STATISTICS COMPONENT
// ======================================================

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <div className="stat">
      <div className="staticon">
        {icon}
      </div>

      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

// ======================================================
// LOGIN AND REGISTRATION COMPONENT
// ======================================================

function Login({
  onLogin,
}: {
  onLogin: (token: string, user: ApiRecord) => void;
}) {
  const [email, setEmail] = useState('admin@desksync.local');
  const [password, setPassword] = useState('');

  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');

  const [register, setRegister] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setLoading(true);
    setErr('');

    try {
      const response = await fetch(
        API + (register ? '/auth/register' : '/auth/login'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            register
              ? {
                  name,
                  full_name: name,
                  email,
                  password,
                  department,
                }
              : {
                  email,
                  password,
                }
          ),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          getErrorMessage(data, 'Unable to continue')
        );
      }

      if (!data.token || !data.user) {
        throw new Error(
          'Invalid login response from server'
        );
      }

      onLogin(data.token, data.user);
    } catch (error: any) {
      setErr(
        error.message || 'Unable to connect to server'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="loginpage">
      <div className="loginbox">
        <div className="brand loginbrand">
          <div className="brandmark">D</div>

          <div>
            Desk<span>Sync</span>

            <small>
              HYBRID OFFICE BOOKING PLATFORM
            </small>
          </div>
        </div>

        <h1>
          {register
            ? 'Create employee account'
            : 'Welcome back'}
        </h1>

        <p>
          {register
            ? 'Register to reserve your workspace.'
            : 'Sign in to manage your workspace.'}
        </p>

        {err && (
          <div className="alert">
            {err}
          </div>
        )}

        <form onSubmit={submit}>
          {register && (
            <>
              <label>
                Full name

                <input
                  value={name}
                  onChange={(event) =>
                    setName(event.target.value)
                  }
                  placeholder="Enter your full name"
                  required
                />
              </label>

              <label>
                Department (optional)

                <input
                  value={department}
                  onChange={(event) =>
                    setDepartment(event.target.value)
                  }
                  placeholder="Enter your department"
                />
              </label>
            </>
          )}

          <label>
            Email address

            <input
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder="Enter your email"
              required
            />
          </label>

          <label>
            Password

            <input
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              placeholder="Enter your password"
              minLength={8}
              required
            />
          </label>

          <button
            className="btn primary full"
            disabled={loading}
            type="submit"
          >
            {loading
              ? 'Please wait...'
              : register
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        <button
          type="button"
          className="switchauth"
          onClick={() => {
            setRegister(!register);
            setErr('');
          }}
        >
          {register
            ? 'Already have an account? Sign in'
            : 'New employee? Create an account'}
        </button>

        {!register && (
          <div className="loginhint">
            Initial administrator: admin@desksync.local
            <br />
            Use the administrator password configured in your database.
          </div>
        )}
      </div>

      <div className="loginfoot">
        DESKSYNC · HYBRID WORKSPACE MANAGEMENT
      </div>
    </div>
  );
}