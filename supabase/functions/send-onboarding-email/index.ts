const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const safeLink = (value: unknown) => {
  const url = String(value ?? '');
  return /^https?:\/\//i.test(url) ? url : '#';
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    console.error('RESEND_API_KEY is not configured.');
    return jsonResponse({ error: 'Email service is not configured.' }, 500);
  }

  try {
    const body = await request.json();
    const carrier = body?.carrier;

    if (!carrier?.company_name || !carrier?.email) {
      return jsonResponse({ error: 'Carrier name and email are required.' }, 400);
    }

    const documents = [
      ['MC Authority Letter', carrier.mc_authority_url],
      ['W-9 Form', carrier.w9_url],
      ['Insurance Certificate', carrier.insurance_certificate_url]
    ];

    const documentLinks = documents.map(([label, url]) =>
      `<li><a href="${escapeHtml(safeLink(url))}">${escapeHtml(label)}</a></li>`
    ).join('');

    const html = `
      <h1>New Carrier Onboarding Submission</h1>
      <p>A carrier submitted a new onboarding packet.</p>
      <h2>Carrier details</h2>
      <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse">
        <tr><th align="left">Company</th><td>${escapeHtml(carrier.company_name)}</td></tr>
        <tr><th align="left">MC / DOT</th><td>${escapeHtml(carrier.mc_dot_number)}</td></tr>
        <tr><th align="left">Contact / Phone</th><td>${escapeHtml(carrier.contact_name_phone)}</td></tr>
        <tr><th align="left">Email</th><td>${escapeHtml(carrier.email)}</td></tr>
        <tr><th align="left">Equipment</th><td>${escapeHtml(carrier.equipment_type)}</td></tr>
        <tr><th align="left">Preferred lanes</th><td>${escapeHtml(carrier.preferred_lanes)}</td></tr>
        <tr><th align="left">Target rate per mile</th><td>${escapeHtml(carrier.target_rate_per_mile)}</td></tr>
      </table>
      <h2>Uploaded files</h2>
      <ul>${documentLinks}</ul>
    `;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Delron Dispatch Onboarding <truck@delrondispatch.com>',
        to: ['truck@delrondispatch.com'],
        subject: `New carrier onboarding: ${carrier.company_name}`,
        html
      })
    });

    if (!resendResponse.ok) {
      const resendError = await resendResponse.text();
      console.error('Resend request failed:', resendResponse.status, resendError);
      return jsonResponse({ error: 'Resend rejected the notification.' }, 502);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error('Onboarding email function failed:', error);
    return jsonResponse({ error: 'Unable to send onboarding notification.' }, 500);
  }
});
