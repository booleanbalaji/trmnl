import type { VercelRequest, VercelResponse } from '@vercel/node';
import { citiesAsOptions, stationsAsOptions } from './weather-stations.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  const city = typeof req.query.city === 'string' ? req.query.city : '';
  return res.status(200).json(city ? stationsAsOptions(city) : citiesAsOptions());
}
