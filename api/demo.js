// POST /api/demo  — creates a 30-min demo slot (Mon–Fri, 10:00–15:00 ET),
// emails you + the requester, and includes an .ics calendar invite.

import { Resend } from 'resend';
import { DateTime } from 'luxon';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = process.env.FROM_EMAIL || 'Support <support@leadshingle.com>';
const ORGANIZER_EMAIL= process.env.ORGANIZER_EMAIL || 'support@leadshingle.com';
const ORGANIZER_NAME = process.env.ORGANIZER_NAME || 'LeadShingle Demos';

// Allow CORS from your site (TEMP during testing you can set '*' then lock it down)
const ALLOW_ORIGIN   = process.env.ALLOW_ORIGIN || 'https://leadshingle.com';

function s(v, max = 3000) { return String(v ?? '').trim().slice(0, max); }
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function parseBody(req) {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) return req.body || {};
  // Fallback for urlencoded forms:
  const raw = await new Promise((resolve) => {
    let data = ''; req.on('data', c => data += c); req.on('end', () => resolve(data));
  });
  try { return JSON.parse(raw); } catch {}
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok:false, error:'Method not allowed' });

  try {
    if (!RESEND_API_KEY) return res.status(500).json({ ok:false, error:'Missing RESEND_API_KEY' });

    const body = await parseBody(req);
    const {
      name, email, phone, company,
      date,              // "YYYY-MM-DD" (user picked)
      time_slot,         // "HH:mm" in 24h, ET (e.g. "10:30")
      consent,
      // optional extras for attribution:
      page_url, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content, cta
    } = body;

    // Basic validation
    if (!s(name) || !s(email) || !s(phone) || !s(company) || !s(date) || !s(time_slot) || !consent) {
      return res.status(400).json({ ok:false, error:'Missing required fields or consent' });
    }

    // Compose start/end in America/New_York
    const zone = 'America/New_York';
    const start = DateTime.fromISO(`${date}T${time_slot}`, { zone });
    if (!start.isValid) return res.status(400).json({ ok:false, error:'Invalid date/time' });

    // Guard: weekdays only (Mon–Fri) and within 10:00–15:00 ET
    const dow = start.weekday; // 1..7 (Mon..Sun)
    if (dow > 5) return res.status(400).json({ ok:false, error:'Weekend not allowed' });

    const minutes = start.hour * 60 + start.minute;
    const minMins = 10 * 60;   // 10:00
    const maxMins = 15 * 60;   // 15:00
    if (minutes < minMins || minutes > maxMins) {
      return res.status(400).json({ ok:false, error:'Outside allowed hours' });
    }

    const end = start.plus({ minutes: 30 });
    const uid = `demo-${start.toMillis()}-${Math.random().toString(36).slice(2,10)}@leadshingle.com`;

    // Build ICS invite
    const dtstampUTC = DateTime.utc().toFormat("yyyyMMdd'T'HHmmss'Z'");
    const dtstartLocal = start.toFormat("yyyyMMdd'T'HHmmss");
    const dtendLocal   = end.toFormat("yyyyMMdd'T'HHmmss");
    const tzid = zone;

    const description = [
      `Demo for: ${s(company)}`,
      `Name: ${s(name)}`,
      `Email: ${s(email)}`,
      `Phone: ${s(phone)}`,
      '',
      page_url ? `Page: ${s(page_url)}` : '',
      referrer ? `Referrer: ${s(referrer)}` : '',
      cta ? `CTA: ${s(cta)}` : '',
      (utm_source || utm_medium || utm_campaign) ? `UTM: ${s(utm_source)} / ${s(utm_medium)} / ${s(utm_campaign)} ${s(utm_term)} ${s(utm_content)}` : ''
    ].filter(Boolean).join('\\n');

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//LeadShingle//Demo//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstampUTC}`,
      `SUMMARY:LeadShingle Demo — ${s(company)}`,
      `DTSTART;TZID=${tzid}:${dtstartLocal}`,
      `DTEND;TZID=${tzid}:${dtendLocal}`,
      `ORGANIZER;CN=${s(ORGANIZER_NAME)}:MAILTO:${s(ORGANIZER_EMAIL)}`,
      `ATTENDEE;CN=${s(name)};RSVP=TRUE:MAILTO:${s(email)}`,
      `DESCRIPTION:${description}`,
      'LOCATION:Google Meet (link to follow)',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const ip = s(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '');
    const ua = s(req.headers['user-agent'] || '');

    const resend = new Resend(RESEND_API_KEY);

    // 1) Confirmation to the requester (with .ics)
    await resend.emails.send({
      from: FROM_EMAIL,
      to: s(email),
      reply_to: ORGANIZER_EMAIL,
      subject: `You're booked: LeadShingle Demo on ${start.toFormat("ccc, LLL d @ h:mma 'ET'")}`,
      text: [
        `Thanks, ${s(name)}! Your demo is scheduled.`,
        `Date/Time (ET): ${start.toFormat("cccc, LLL d yyyy")} ${start.toFormat("h:mma")}–${end.toFormat("h:mma")}`,
        `Company: ${s(company)}`,
        '',
        'Add this to your calendar with the attached invite.',
        '',
        `If you need changes: ${ORGANIZER_EMAIL}`
      ].join('\n'),
      html: `
        <p>Thanks, <b>${s(name)}</b>! Your demo is scheduled.</p>
        <p><b>Date/Time (ET):</b> ${start.toFormat("cccc, LLL d yyyy")} ${start.toFormat("h:mma")}–${end.toFormat("h:mma")}</p>
        <p><b>Company:</b> ${s(company)}</p>
        <p>Add this to your calendar using the attached invite.<br/>
        If you need changes, reply to this email.</p>
      `,
      attachments: [
        {
          filename: 'LeadShingle-Demo.ics',
          content: Buffer.from(ics, 'utf8'),
          contentType: 'text/calendar'
        }
      ]
    });

    // 2) Notification to you (with the same .ics)
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ORGANIZER_EMAIL,
      reply_to: s(email),
      subject: `New Demo Booked — ${s(company)} (${start.toFormat("ccc LLL d h:mma 'ET'")})`,
      text: [
        `Demo booked`,
        `Name: ${s(name)}  Email: ${s(email)}  Phone: ${s(phone)}`,
        `Company: ${s(company)}`,
        `When (ET): ${start.toFormat("cccc, LLL d yyyy")} ${start.toFormat("h:mma")}–${end.toFormat("h:mma")}`,
        '',
        `Page: ${s(page_url)}  Referrer: ${s(referrer)}  CTA: ${s(cta)}`,
        `UTM: ${s(utm_source)} / ${s(utm_medium)} / ${s(utm_campaign)} ${s(utm_term)} ${s(utm_content)}`,
        `IP: ${ip}  UA: ${ua}`
      ].join('\n'),
      html: `
        <h3>New Demo Booked</h3>
        <p><b>Name:</b> ${s(name)} &nbsp; <b>Email:</b> ${s(email)} &nbsp; <b>Phone:</b> ${s(phone)}</p>
        <p><b>Company:</b> ${s(company)}</p>
        <p><b>When (ET):</b> ${start.toFormat("cccc, LLL d yyyy")} ${start.toFormat("h:mma")}–${end.toFormat("h:mma")}</p>
        <p><b>Page:</b> ${s(page_url)} &nbsp; <b>Referrer:</b> ${s(referrer)} &nbsp; <b>CTA:</b> ${s(cta)}</p>
        <p><b>UTM:</b> ${s(utm_source)} / ${s(utm_medium)} / ${s(utm_campaign)} ${s(utm_term)} ${s(utm_content)}</p>
      `,
      attachments: [
        {
          filename: 'LeadShingle-Demo.ics',
          content: Buffer.from(ics, 'utf8'),
          contentType: 'text/calendar'
        }
      ]
    });

    return res.status(200).json({ ok:true });
  } catch (e) {
    console.error('Demo error:', e);
    return res.status(500).json({ ok:false, error:'Unable to schedule right now' });
  }
}
