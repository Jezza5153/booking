const targetUrl = process.env.KEEPALIVE_URL || 'https://booking-production-de35.up.railway.app/api/health';
const startedAt = Date.now();

try {
  const response = await fetch(targetUrl, {
    headers: {
      'User-Agent': 'events-keepalive/1.0',
      'Accept': 'application/json',
    },
  });

  const elapsed = Date.now() - startedAt;
  if (!response.ok) {
    console.error(`Keepalive failed: ${response.status} ${response.statusText} (${elapsed}ms)`);
    process.exit(1);
  }

  console.log(`Keepalive success: ${response.status} (${elapsed}ms)`);
} catch (error) {
  console.error(`Keepalive error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
