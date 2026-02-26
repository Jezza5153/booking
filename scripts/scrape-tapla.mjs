#!/usr/bin/env node
// Scrape all bookings from Tapla dashboard API and save to JSON
import { writeFileSync } from 'fs';

const RESTAURANT_ID = 'e915e6ca-9391-4777-b651-7e2d2c145afc';
const BASE_URL = `https://dashboard.tapla.nl/${RESTAURANT_ID}/reservations`;

// Supabase auth cookies extracted from browser session
const COOKIE = `sb-biczkwpfvlmngmqufsdp-auth-token.0=base64-eyJhY2Nlc3NfdG9rZW4iOiJleUpoYkdjaU9pSklVekkxTmlJc0ltdHBaQ0k2SWprMGEzQkRTRTlyVDNSVk5sWTNla0VpTENKMGVYQWlPaUpLVjFRaWZRLmV5SnBjM01pT2lKb2RIUndjem92TDJKcFkzcHJkM0JtZG14dGJtZHRjWFZtYzJSd0xuTjFjR0ZpWVhObExtTnZMMkYxZEdndmRqRWlMQ0p6ZFdJaU9pSXhNamxoTWpCbFlpMDNZek14TFRRMlptRXRZbUUwTWkwNU1UUTNabUl5WVdNeU5qVWlMQ0poZFdRaU9pSmhkWFJvWlc1MGFXTmhkR1ZrSWl3aVpYaHdJam94TnpjeU1EWXpORGt3TENKcFlYUWlPakUzTnpJd05UazRPVEFzSW1WdFlXbHNJam9pYVc1bWIwQjBZV1psYkdGaGNtRnRaWEp6Wm05dmNuUXVibXdpTENKd2FHOXVaU0k2SWlJc0ltRndjRjl0WlhSaFpHRjBZU0k2ZXlKd2NtOTJhV1JsY2lJNkltVnRZV2xzSWl3aWNISnZkbWxrWlhKeklqcGJJbVZ0WVdsc0lsMTlMQ0oxYzJWeVgyMWxkR0ZrWVhSaElqcDdJbVZ0WVdsc0lqb2lhVzVtYjBCMFlXWmxiR0ZoY21GdFpYSnpabTl2Y25RdWJtd2lMQ0psYldGcGJGOTJaWEpwWm1sbFpDSTZkSEoxWlN3aWJtRnRaU0k2SWtwaGJpQk5iMnh0WVc1eklpd2ljR2h2Ym1WZmRtVnlhV1pwWldRaU9tWmhiSE5sTENKeVpYTjBZWFZ5WVc1MFRtRnRaU0k2SWxSaFptVnNZV0Z5SUVGdFpYSnpabTl2Y25RZ1FpNVdMaUlzSW5OMVlpSTZJakV5T1dFeU1HVmlMVGRqTXpFdE5EWm1ZUzFpWVRReUxUa3hORGRtWWpKaFl6STJOU0o5TENKeWIyeGxJam9pWVhWMGFHVnVkR2xqWVhSbFpDSXNJbUZoYkNJNkltRmhiREVpTENKaGJYSWlPbHQ3SW0xbGRHaHZaQ0k2SW5CaGMzTjNiM0prSWl3aWRHbHRaWE4wWVcxd0lqb3hOemN5TURVNU9Ea3dmVjBzSW5ObGMzTnBiMjVmYVdRaU9pSXpZamxqTTJZeVlpMDFZMlprTFRRNE9UZ3RZVGd4WWkwMFpEWTROMll6TWpBek9EZ2lMQ0pwYzE5aGJtOXVlVzF2ZFhNaU9tWmhiSE5sZlEuSDZrNXZLbXJQQ2ZQc0NyWG9LTVpocmZ3V3BxTGFueHBmZmdIZjlidDdBWSIsInRva2VuX3R5cGUiOiJiZWFyZXIiLCJleHBpcmVzX2luIjozNjAwLCJleHBpcmVzX2F0IjoxNzcyMDYzNDkwLCJyZWZyZXNoX3Rva2VuIjoiYzR0d21iaXRseW16IiwidXNlciI6eyJpZCI6IjEyOWEyMGViLTdjMzEtNDZmYS1iYTQyLTkxNDdmYjJhYzI2NSIsImF1ZCI6ImF1dGhlbnRpY2F0ZWQiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImVtYWlsIjoiaW5mb0B0YWZlbGFhcmFtZXJzZm9vcnQubmwiLCJlbWFpbF9jb25maXJtZWRfYXQiOiIyMDI1LTEwLTIyVDA5OjM0OjExLjM0MzM0NloiLCJwaG9uZSI6IiIsImNvbmZpcm1hdGlvbl9zZW50X2F0IjoiMjAyNS0xMC0yMlQwOTozNDowMS41NDQyMloiLCJjb25maXJtZWRfYXQiOiIyMDI1LTEwLTIyVDA5OjM0OjExLjM0MzM0NloiLCJsYXN0X3NpZ25faW5fYXQiOiIyMDI2LTAyLTI1VDIyOjUxOjMwLjIxMzQ4NzkyMVoiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJlbWFpbCIsInByb3ZpZGVycyI6WyJlbWFpbCJdfSwidXNlcl9tZXRhZGF0YSI6eyJlbWFpbCI6ImluZm9AdGFmZWxhYXJhbWVyc2Zvb3J0Lm5sIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJKYW4gTW9sbWFucyIsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwicmVzdGF1cmFudE5hbWUiOiJUYWZlbGFhciBBbWVyc2Zvb3J0IEIuVi4iLCJzdWIiOiIxMjlhMjBlYi03YzMxLTQ2ZmEtYmE0Mi05MTQ3ZmIyYWMyNjUifSwiaWRlbnRpdGllcyI6W3siaWRlbnRpdHlfaWQiOiJmNzhiNzg3Yi04Zjg4LTQzZjgtYTVlMC1hOGQ3OTI3ZjBlMjIiLCJpZCI6IjEyOWEyMGViLTdjMzEtNDZmYS1iYTQyLTkxNDdmYjJhYzI2NSIsInVzZXJfaWQiOiIxMjlhMjBlYi03YzMxLTQ2ZmEtYmE0Mi05MTQ3ZmIyYWMyNjUiLCJpZGVudGl0eV9kYXRhIjp7ImVtYWlsIjoiaW5mb0B0YWZlbGFhcmFtZXJzZm9vcnQubmwiLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwibmFtZSI6IkphbiBNb2xtYW5zIiwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJyZXN0YXVyYW50TmFtZSI6IlRhZmVsYWFyIEFtZXJzZm9vcnQgQi5WLiIsInN1YiI6IjEyOWEyMGViLTdjMzEtNDZmYS1iYTQyLTkxNDdmYjJhYzI2NSJ9LCJwcm92aWRlciI6ImVtYWlsIiwibGFzdF9zaWduX2luX2F0IjoiMjAyNS0xMC0yMlQwOTozNDowMS41MDE2ODRaIiwiY3JlYXRlZF9hdCI6IjIwMjUtMTAtMjJUMDk6MzQ6MDEuNTAyODc0WiIsInVwZGF0ZWRfYXQiOiIyMDI1LTEwLTIyVDA5OjM0OjAxLjUwMjg3NFoiLCJlbWFpbCI6ImluZm9AdGFmZWxhYXJhbWVyc2Zvb3J0Lm5sIn1dLCJjcmVhdGVkX2F0IjoiMjAyNS0xMC0yMlQwOTozNDowMS40MDgzMDZaIiwidXBkYXRlZF9hdCI6IjIwMjYtMDItMjVUMjI6NTE6MzAuMjMxNDE4WiIsImlzX2Fub255bW91cyI6ZmFsc2V9LCJ3ZWFrX3Bhc3N3b3JkIjpud; sb-biczkwpfvlmngmqufsdp-auth-token.1=WxsfQ`;

async function scrapeRange(startDate, endDate) {
    const allBookings = [];
    const d = new Date(startDate);
    const end = new Date(endDate);

    while (d <= end) {
        const dateStr = d.toISOString().split('T')[0];
        try {
            const res = await fetch(`${BASE_URL}/${dateStr}`, {
                headers: { Cookie: COOKIE },
            });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    allBookings.push(...data);
                    process.stdout.write(`${dateStr}: ${data.length} bookings\n`);
                }
            } else if (res.status === 401) {
                console.error('Auth expired! Status 401');
                break;
            }
        } catch (e) {
            console.error(`Error on ${dateStr}:`, e.message);
        }
        d.setDate(d.getDate() + 1);
        // Small delay to be polite
        await new Promise(r => setTimeout(r, 100));
    }
    return allBookings;
}

console.log('Scraping Tapla bookings...');
const bookings = await scrapeRange('2026-01-01', '2026-03-31');
console.log(`\nTotal: ${bookings.length} bookings`);

const outPath = new URL('../tapla-bookings.json', import.meta.url).pathname;
writeFileSync(outPath, JSON.stringify(bookings, null, 2));
console.log(`Saved to ${outPath}`);
