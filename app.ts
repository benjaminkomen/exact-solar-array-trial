// The data module: the panel slots and their inverters, ported from
// solar-array-simulator's src/utils/configStore.ts (DEFAULT_CONFIG).
import type { Answer, Result, Sources } from './app.contract.d.ts';

export const grants = '';

// configStore.ts DEFAULT_CONFIG.defaultMaxWattage
const DEFAULT_MAX_WATTAGE = 430;

// configStore.ts DEFAULT_CONFIG.inverters (ids and efficiencies; serial numbers are random there)
const INVERTER_EFFICIENCY = [95, 95, 95, 95, 95, 95, 95, 75, 68, 62, 20, 15, 0, 0];

const sources: Sources = {
  array: (): Result<'array'> => ({
    maxWattage: DEFAULT_MAX_WATTAGE,
    // One slot per default inverter: two rows of seven portrait panels.
    slots: INVERTER_EFFICIENCY.map((efficiency, i) => ({
      id: String(i + 1),
      inverterId: String(i + 1),
      efficiency,
    })),
  }),
};

export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
