import type { VercelRequest, VercelResponse } from '@vercel/node';
import { findStation } from './weather-stations.js';

// Flat, display-ready shape: all derivation (compass text, rain/AQI labels,
// unit conversion) happens here because Liquid is a weak place for logic.
interface WeatherPayload {
  area: string | null;
  temperature: number | null;
  humidity: number | null;
  wind_speed_kmh: number | null;
  wind_direction: string | null;
  rain_intensity: number | null;
  rain_accumulation: number | null;
  rain_status: string | null;
  aqi_pm25: number | null;
  aqi_pm10: number | null;
  aqi_label: string | null;
  updated_at: string;
  error: string | null;
}

const WU_URL = 'https://www.weatherunion.com/gw/weather/external/v0/get_weather_data';
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';

const round1 = (n: number) => Math.round(n * 10) / 10;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function compass(deg: number | null): string | null {
  if (deg === null) return null;
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

// rain_intensity is mm/min per Weather Union docs
function rainStatus(intensity: number | null): string | null {
  if (intensity === null) return null;
  if (intensity === 0) return 'No rain';
  if (intensity < 0.25) return 'Light rain';
  if (intensity < 1) return 'Moderate rain';
  return 'Heavy rain';
}

// Indian AQI bands on PM2.5 concentration
function aqiLabel(pm25: number | null): string | null {
  if (pm25 === null) return null;
  if (pm25 <= 30) return 'Good';
  if (pm25 <= 60) return 'Satisfactory';
  if (pm25 <= 90) return 'Moderate';
  if (pm25 <= 120) return 'Poor';
  if (pm25 <= 250) return 'Very Poor';
  return 'Severe';
}

const istTime = () =>
  new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });

interface Coords { lat: number; lon: number; name: string }

const LATLON_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

// Open-Meteo matches single place names, so "Indiranagar, Bengaluru" falls
// back to its first comma segment when the full string misses.
async function geocode(query: string): Promise<Coords | null> {
  const candidates = [...new Set([query, query.split(',')[0].trim()])].filter(Boolean);
  for (const q of candidates) {
    const resp = await fetch(`${GEO_URL}?name=${encodeURIComponent(q)}&count=1`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) continue;
    const body: any = await resp.json();
    const hit = body?.results?.[0];
    if (hit && typeof hit.latitude === 'number' && typeof hit.longitude === 'number') {
      return { lat: hit.latitude, lon: hit.longitude, name: hit.name ?? q };
    }
  }
  return null;
}

export async function resolveLocation(location: string): Promise<Coords | null> {
  const station = findStation(location);
  if (station) {
    return {
      lat: station.latitude,
      lon: station.longitude,
      name: station.name,
    };
  }

  const match = location.match(LATLON_RE);
  if (match) {
    return {
      lat: parseFloat(match[1]),
      lon: parseFloat(match[2]),
      name: location,
    };
  }

  return geocode(location);
}

function payload(partial: Partial<WeatherPayload>): WeatherPayload {
  return {
    area: null, temperature: null, humidity: null, wind_speed_kmh: null,
    wind_direction: null, rain_intensity: null, rain_accumulation: null,
    rain_status: null, aqi_pm25: null, aqi_pm10: null, aqi_label: null,
    updated_at: istTime(), error: null, ...partial,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
  res.status(200);

  const apiKey = process.env.WEATHER_UNION_API_KEY;
  if (!apiKey) return res.json(payload({ error: 'API key not configured' }));

  const location = typeof req.query.location === 'string' ? req.query.location.trim() : '';
  if (!location) return res.json(payload({ error: 'No location configured' }));

  try {
    const coords = await resolveLocation(location);
    if (!coords) return res.json(payload({ error: `Location not found: ${location}` }));

    const resp = await fetch(
      `${WU_URL}?latitude=${coords.lat}&longitude=${coords.lon}`,
      { headers: { 'x-zomato-api-key': apiKey }, signal: AbortSignal.timeout(4000) },
    );
    const body: any = resp.ok ? await resp.json() : null;
    const data = body?.locality_weather_data;
    if (!resp.ok || body?.status !== '200' || !data) {
      return res.json(payload({ area: coords.name, error: `No weather station near ${coords.name}` }));
    }

    const windMs = num(data.wind_speed);
    const pm25 = num(data.aqi_pm_2_point_5);
    return res.json(payload({
      area: coords.name,
      temperature: num(data.temperature),
      humidity: num(data.humidity) === null ? null : Math.round(data.humidity),
      wind_speed_kmh: windMs === null ? null : round1(windMs * 3.6),
      wind_direction: compass(num(data.wind_direction)),
      rain_intensity: num(data.rain_intensity),
      rain_accumulation: num(data.rain_accumulation),
      rain_status: rainStatus(num(data.rain_intensity)),
      aqi_pm25: pm25 === null ? null : Math.round(pm25),
      aqi_pm10: num(data.aqi_pm_10) === null ? null : Math.round(data.aqi_pm_10),
      aqi_label: aqiLabel(pm25),
    }));
  } catch {
    return res.json(payload({ error: 'Weather fetch failed' }));
  }
}
