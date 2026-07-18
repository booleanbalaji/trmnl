import rawStations from '../data/weather-stations.json';

export interface WeatherStation {
  city: string;
  name: string;
  id: string;
  latitude: number;
  longitude: number;
  deviceType: 1 | 2;
}

export type SelectOption = Record<string, string>;

const stations = rawStations as WeatherStation[];
const normalize = (value: string) => value.trim().toLocaleLowerCase('en-IN');
const cityValue = (city: string) =>
  normalize(city).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const toRad = (deg: number) => (deg * Math.PI) / 180;

const byId = new Map(stations.map((station) => [normalize(station.id), station]));
const byName = new Map(stations.map((station) => [normalize(station.name), station]));

export function findStation(location: string): WeatherStation | null {
  const key = normalize(location);
  return byId.get(key) ?? byName.get(key) ?? null;
}

export function citiesAsOptions(): SelectOption[] {
  return [...new Set(stations.map((station) => station.city))]
    .sort((a, b) => a.localeCompare(b))
    .map((city) => ({ [city]: cityValue(city) }));
}

export function stationsAsOptions(city: string): SelectOption[] {
  const key = normalize(city);
  return stations
    .filter((station) => cityValue(station.city) === key)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((station) => ({ [station.name]: station.id }));
}

export function distanceKm(
  a: Pick<WeatherStation, 'latitude' | 'longitude'>,
  b: Pick<WeatherStation, 'latitude' | 'longitude'>,
): number {
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearestStations(origin: WeatherStation, limit = 3): WeatherStation[] {
  return stations
    .filter((station) => station.id !== origin.id)
    .map((station) => ({ station, distance: distanceKm(origin, station) }))
    .sort((a, b) => a.distance - b.distance || a.station.id.localeCompare(b.station.id))
    .slice(0, limit)
    .map(({ station }) => station);
}
