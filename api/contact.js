export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { firstName, lastName, email, company, role, context, message } = req.body || {};

  if (!firstName || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const fullName = [firstName, lastName].filter(Boolean).map(esc).join(' ');

  const htmlContent = `
    <h3 style="margin-top:0">New message from PathwayGTM website</h3>
    <p><strong>Name:</strong> ${fullName}</p>
    <p><strong>Email:</strong> ${esc(email)}</p>
    ${company ? `<p><strong>Company:</strong> ${esc(company)}</p>` : ''}
    ${role ? `<p><strong>Role:</strong> ${esc(role)}</p>` : ''}
    ${context ? `<p><strong>Topic:</strong> ${esc(context)}</p>` : ''}
    <p><strong>Message:</strong></p>
    <p style="white-space:pre-wrap">${esc(message)}</p>
  `;

  try {
    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'PathwayGTM Website', email: 'hello@pathwaygtm.com' },
        to: [{ email: 'hello@pathwaygtm.com', name: 'Pathway GTM' }],
        replyTo: { email: esc(email), name: fullName },
        subject: `Website inquiry from ${fullName}`,
        htmlContent,
      }),
    });

    if (!brevoRes.ok) {
      const err = await brevoRes.json().catch(() => ({}));
      console.error('Brevo error:', err);
      return res.status(500).json({ error: 'Failed to send' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Contact form error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
