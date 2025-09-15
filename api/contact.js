// Vercel Node function: POST /api/contact
import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Support <support@leadshingle.com>';
const DESTINATION = 'support@leadshingle.com';

// CHANGE THIS to your live site domain when it’s ready.
// For development, you can temporarily set '*' to test.
const ALLOW_ORIGIN = 'https://leadshingle.com';

function s(v, max = 3000) { return String(v ?? '').trim().slice(0, max); }

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const {
      name, email, phone, company, website, service_area, message, consent,
      page_url, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content, cta
    } = req.body || {};

    if (!s(name) || !s(email) || !s(phone) || !s(company) || !s(website) || !s(service_area) || !consent) {
      return res.status(400).json({ ok: false, error: 'Missing required fields or consent' });
    }

    if (!RESEND_API_KEY) {
      return res.status(500).json({ ok: false, error: 'Missing RESEND_API_KEY' });
    }

    const ip = s(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '');
    const ua = s(req.headers['user-agent'] || '');

    const subject = `Custom Lead Strategy Request — ${s(company)}`;
    const text = [
      `Custom Lead Strategy Request`,
      ``,
      `Name: ${s(name)}`,
      `Email: ${s(email)}`,
      `Phone: ${s(phone)}`,
      `Company: ${s(company)}`,
      `Website: ${s(website)}`,
      `Service Area: ${s(service_area)}`,
      ``,
      `Message:`,
      s(message),
      ``,
      `Attribution:`,
      `Page: ${s(page_url)}`,
      `Referrer: ${s(referrer)}`,
      `CTA: ${s(cta)}`,
      `UTM: source=${s(utm_source)} medium=${s(utm_medium)} campaign=${s(utm_campaign)} term=${s(utm_term)} content=${s(utm_content)}`,
      ``,
      `Meta: IP=${ip} UA=${ua}`
    ].join('\n');

    const html = `
      <h2>Custom Lead Strategy Request</h2>
      <p><b>Name:</b> ${s(name)}<br/>
         <b>Email:</b> ${s(email)}<br/>
         <b>Phone:</b> ${s(phone)}</p>
      <p><b>Company:</b> ${s(company)}<br/>
         <b>Website:</b> ${s(website)}<br/>
         <b>Service Area:</b> ${s(service_area)}</p>
      <p><b>Message:</b><br/>${(s(message) || '-').replace(/\n/g,'<br/>')}</p>
      <hr/>
      <p style="font-size:12px;color:#6b7280">
        Page: ${s(page_url)}<br/>
        Referrer: ${s(referrer)}<br/>
        CTA: ${s(cta)}<br/>
        UTM: source=${s(utm_source)} medium=${s(utm_medium)} campaign=${s(utm_campaign)} term=${s(utm_term)} content=${s(utm_content)}<br/>
        IP: ${ip} • UA: ${ua}
      </p>
    `;

    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: FROM_EMAIL,           // must be under your verified domain in Resend
      to: DESTINATION,            // where you receive it
      reply_to: s(email),         // replying goes to the requester
      subject,
      text,
      html
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Contact error:', e);
    return res.status(500).json({ ok: false, error: 'Email send failed' });
  }
}
