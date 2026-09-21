import { augmontGetCities, augmontGetStates } from './augmont.service';

type Place = { id: string; name: string; stateId?: string };
const cache = new Map<string, { expires: number; value: string }>();
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const findPlace = async (
  label: string, name: string, fetchPage: (page: number) => Promise<any>, stateId?: string
) => {
  const key = `${label}:${stateId || ''}:${normalize(name)}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const matches = new Map<string, Place>();
  for (let page = 1; page <= 100; page++) {
    const payload = await fetchPage(page);
    const rows = payload?.result?.data;
    if (!Array.isArray(rows)) throw new Error(`Augmont ${label} master data is unavailable`);
    for (const row of rows as Place[]) {
      if (typeof row.id !== 'string' || !row.id || typeof row.name !== 'string') continue;
      if (stateId && row.stateId !== stateId) continue;
      if (row.id === name.trim() || normalize(row.name) === normalize(name)) matches.set(row.id, row);
    }
    if (!payload.result.pagination?.hasMore) break;
    if (page === 100) throw new Error(`Augmont ${label} master data exceeded its page limit`);
  }
  if (matches.size !== 1) throw new Error(`Choose a valid Augmont ${label} for this address`);
  const id = [...matches.keys()][0];
  if (cache.size >= 1000) cache.clear();
  cache.set(key, { value: id, expires: Date.now() + 24 * 60 * 60 * 1000 });
  return id;
};

export const resolveAugmontGeography = async (city: string, state: string) => {
  const stateId = await findPlace('state', state, page =>
    augmontGetStates({ name: state.trim(), count: 100, page }));
  const cityId = await findPlace('city', city, page =>
    augmontGetCities({ stateId, name: city.trim(), count: 100, page }), stateId);
  return { cityId, stateId };
};
