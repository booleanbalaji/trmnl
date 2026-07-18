import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    greeting: 'Hello from TRMNL!',
    current_time: new Date().toISOString(),
  });
}
