// Vercel Serverless Function: /api/jobs
// Proxies Adzuna Job Search API requests securely with server-side API credentials.

export default async function handler(req, res) {
  // Set CORS and Cache-Control headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method Not Allowed',
      message: 'Only GET requests are supported on /api/jobs.'
    });
  }

  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;

  if (!appId || !appKey) {
    return res.status(500).json({
      error: 'Server Configuration Error',
      message: 'ADZUNA_APP_ID and/or ADZUNA_APP_KEY environment variables are missing on the server.',
      details: 'Please ensure ADZUNA_APP_ID and ADZUNA_APP_KEY are configured in the Vercel project environment settings.'
    });
  }

  try {
    const { query, what, location, where, country = 'in', page = '1' } = req.query || {};

    const searchQuery = (query || what || '').trim() || 'software engineer';
    const searchLocation = (location || where || '').trim();
    const countryCode = (country || 'in').toLowerCase().trim();
    const pageNum = Math.max(1, parseInt(page, 10) || 1);

    // Build Adzuna URL
    const adzunaBase = `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(countryCode)}/search/${pageNum}`;
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      'content-type': 'application/json',
      results_per_page: '10',
      what: searchQuery
    });

    if (searchLocation) {
      params.append('where', searchLocation);
    }

    const targetUrl = `${adzunaBase}?${params.toString()}`;

    const response = await fetch(targetUrl, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: 'Adzuna API Error',
        message: `Adzuna API returned HTTP ${response.status}`,
        details: errText || 'No additional upstream details provided.'
      });
    }

    const data = await response.json();
    const rawResults = data.results || [];

    // Trim and sanitize results
    const trimmedJobs = rawResults.slice(0, 10).map(item => {
      const rawTitle = (item.title || '').replace(/<\/?[^>]+(>|$)/g, '').trim();
      const rawCompany = item.company && item.company.display_name ? item.company.display_name.trim() : 'Direct Employer';
      
      let locStr = 'Remote / India';
      if (item.location && item.location.display_name) {
        locStr = item.location.display_name.trim();
      } else if (item.location && Array.isArray(item.location.area) && item.location.area.length > 0) {
        locStr = item.location.area.slice(-2).join(', ');
      }

      const rawDesc = (item.description || '').replace(/<\/?[^>]+(>|$)/g, '').trim();
      const jobUrl = item.redirect_url || item.url || '#';

      return {
        id: String(item.id || ''),
        title: rawTitle || 'Software Engineer',
        company: rawCompany,
        location: locStr,
        url: jobUrl,
        salary_min: item.salary_min !== undefined ? item.salary_min : null,
        salary_max: item.salary_max !== undefined ? item.salary_max : null,
        created: item.created || new Date().toISOString(),
        description: rawDesc
      };
    });

    return res.status(200).json({
      success: true,
      query: searchQuery,
      location: searchLocation,
      country: countryCode,
      total_results: data.count || trimmedJobs.length,
      jobs: trimmedJobs
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Proxy Execution Error',
      message: error.message || 'Internal error while contacting Adzuna API.',
      details: error.stack || String(error)
    });
  }
}
