import type { VercelRequest, VercelResponse } from '@vercel/node';
import { citiesAsOptions, stationsAsOptions } from './weather-stations.js';

// TRMNL xhrSelect fetches from the browser, so the options endpoint must
// answer CORS preflights and allow cross-origin GETs from the dashboard.
function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const city = typeof req.query.city === 'string' ? req.query.city : '';
  return res.status(200).json(city ? stationsAsOptions(city) : citiesAsOptions());
}
