# Operations Documentation

## Rate Limiting Architecture

### Current Implementation

The application uses **in-memory rate limiting** via `express-rate-limit`:

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/api/auth/login` | 5 requests | 15 minutes |
| `/api/book` | 10 requests | 1 minute |
| `/api/widget/*` | 60 requests | 1 minute |

**Location**: `server/auth.js`

### Limitations

**Single-instance only**. If Railway scales to multiple instances, rate limits become inconsistent because each instance maintains its own counter.

### Recommended Upgrades

1. **Redis-backed limiter** (Upstash, Railway Redis, etc.)
   - Add `rate-limit-redis` package
   - Point to shared Redis instance

2. **Cloudflare WAF** (if fronted by Cloudflare)
   - Configure rate rules for `/api/book` and `/api/auth/login`
   - Zero code change needed

### Deployment Decision

For **single-instance deployments** (most small-medium use cases), the current in-memory limiter is sufficient.

For **multi-instance scaling**, choose one:
- [ ] Redis-backed limiter
- [ ] Cloudflare WAF rules
- [ ] External API gateway (Kong, etc.)

---

## Database: Railway PostgreSQL

### Connection

```bash
DATABASE_URL=postgresql://postgres:xxx@xxx.railway.app:5432/railway
```

### Backups

Railway provides automatic daily backups. To manually backup:

```bash
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
```

### Restore

```bash
psql $DATABASE_URL < backup_YYYYMMDD.sql
```

---

## Environment Variables

### Backend (Railway)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | Railway PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Server fails to start without this |
| `ADMIN_PASSWORD` | ✅ | Hashed password for admin login |
| `RESEND_API_KEY` | No | For email confirmations |
| `RESEND_FROM_EMAIL` | No | Sender email address |
| `BOOKING_NOTIFICATION_EMAIL` | No | Admin notification email |

### Frontend (Vercel)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | No | Backend API URL (defaults to Railway prod) |

---

## Deployment Checklist

Before deploying:

- [ ] Run migration: `server/migration-add-bookings.sql`
- [ ] Verify `JWT_SECRET` is set in Railway
- [ ] Verify `.env` is NOT committed to git
- [ ] Test booking flow end-to-end
- [ ] Test cancellation flow
