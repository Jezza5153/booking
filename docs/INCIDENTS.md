# Incident Triage Playbooks

Quick reference for common production issues.

---

## 1. Booking Failures

### Symptoms
- Users see "Booking failed" or "capacity exceeded"
- 500 errors in logs
- 409 responses for valid-looking requests

### Diagnostics
```bash
# Check server health
curl https://YOUR-API/api/health

# Check DB connectivity
railway logs --tail

# Check rate limit hits
grep "Rate limit" logs/
```

### Common Causes

| Error | Likely Cause | Fix |
|-------|--------------|-----|
| 409 "capacity exceeded" | Slot genuinely full | Expected behavior |
| 422 "slot_id is required" | Malformed request | Check client payload |
| 404 "slot not found" | Deleted slot | Verify slot exists in DB |
| 500 + DB error | Connection pool exhausted | Restart server, check pool size |

### Resolution
1. If DB connection: Restart Railway service
2. If rate limit: Temporary, will clear in 60s
3. If capacity: Genuine — no action needed

---

## 2. Admin Save Failures

### Symptoms
- "Save failed" in admin UI
- 400/409 from `/api/admin/save`
- Data doesn't persist after refresh

### Diagnostics
```bash
# Check latest save attempt
curl -i -X POST https://YOUR-API/api/admin/save \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"restaurantId":"demo-restaurant","zones":[],"events":[]}'
```

### Common Causes

| Error | Likely Cause | Fix |
|-------|--------------|-----|
| 400 "Empty payload rejected" | UI bug sending empty data | Send `force=true` or fix UI |
| 400 "Dangerous operation blocked" | Deleting >50% of data | Intentional safety rail |
| 409 "Cannot delete zone" | FK constraint (slots exist) | Delete slots first |
| 401 "Unauthorized" | Token expired | Re-login |

### Resolution
1. Check payload in browser Network tab
2. If FK violation: Delete child records first
3. If empty payload: Debug frontend state

---

## 3. ICS Feed Hammering

### Symptoms
- High CPU/memory on server
- Rate limit 429s from calendar clients
- Slow widget responses

### Diagnostics
```bash
# Check calendar request rate
grep "/api/calendar" access.log | wc -l

# Check unique IPs
grep "/api/calendar" access.log | awk '{print $1}' | sort -u | wc -l
```

### Common Causes
- Calendar client polling too frequently (default: 15min)
- Public ICS URL leaked to many users
- Bot/crawler indexing the endpoint

### Resolution
1. ICS already has `Cache-Control: max-age=60` — clients should respect this
2. If Cloudflare: Add rate rule for `/api/calendar/*`
3. Consider adding `?token=xxx` for private feeds

---

## 4. Widget Not Loading

### Symptoms
- Blank widget area
- CORS errors in console
- 404 from widget endpoint

### Diagnostics
```bash
# Check widget endpoint
curl -i https://YOUR-API/api/widget/demo-restaurant

# Check CORS headers
curl -I https://YOUR-API/api/widget/demo-restaurant | grep -i access-control
```

### Common Causes
| Error | Likely Cause | Fix |
|-------|--------------|-----|
| CORS error | Missing `Access-Control-Allow-Origin` | Check CORS middleware |
| 404 | Wrong restaurant ID | Verify ID in embed code |
| 500 | DB error | Check server logs |

---

## Emergency Contacts

| Role | Contact |
|------|---------|
| Backend | [Add contact] |
| Database | Neon Support or Railway Support |
| Frontend | Vercel Support |

---

## Post-Incident

After resolution:
1. Document root cause in this file or separate post-mortem
2. Consider adding automated alert for this failure mode
3. Update runbook if new pattern discovered
