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
