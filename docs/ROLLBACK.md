# EVENTS Booking Widget — Rollback Procedures

## Quick Reference

| Situation | Action |
|-----------|--------|
| Bad backend deploy | Railway: Revert to previous deployment |
| Bad frontend deploy | Vercel: Rollback to previous deployment |
| DB migration broke | Run rollback script (see below) |
| Complete outage | Restore from Neon backup |

---

## 1. Backend Rollback (Railway)

### Via Dashboard
1. Go to [Railway Project](https://railway.app)
2. Select the `server` service
3. Click **Deployments** tab
4. Find the last working deployment
5. Click **⋮** → **Redeploy**

### Via CLI
```bash
railway rollback
```

---

## 2. Frontend Rollback (Vercel)

### Via Dashboard
1. Go to [Vercel Project](https://vercel.com)
2. Click **Deployments** tab
3. Find the last working deployment
4. Click **⋮** → **Promote to Production**

### Via CLI
```bash
vercel rollback
```

---

## 3. Database Rollback

### Recent Migration Issues
```sql
-- If slots.start_datetime migration broke:
ALTER TABLE slots 
  ALTER COLUMN start_datetime TYPE TIMESTAMP 
  USING start_datetime AT TIME ZONE 'UTC';

-- If bookings table has issues, restore from backup
```

### Full Database Restore (Last Resort)
1. Go to [Neon Console](https://console.neon.tech)
2. Select project → **Branches**
3. Create branch from backup point
4. Update `DATABASE_URL` in Railway to new branch

---

## 4. Verification After Rollback

```bash
# Check health
curl https://YOUR-API/api/health

# Check widget loads
curl https://YOUR-API/api/widget/demo-restaurant | jq '.events | length'

# Check admin login works
curl -X POST https://YOUR-API/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_PASSWORD"}'
```

---

## 5. Incident Communication

1. Update status page (if exists)
2. Notify stakeholders via configured alerts
3. Document incident in post-mortem after resolution

---

## Emergency Contacts

| Role | Contact |
|------|---------|
| Backend | [Your contact] |
| Database | Neon Support |
| Frontend | Vercel Support |
