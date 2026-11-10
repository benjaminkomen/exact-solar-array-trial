// The data module: the system configuration, ported from solar-array-simulator's
// src/utils/configStore.ts (DEFAULT_CONFIG, updateDefaultWattage, inverter efficiency).
// Kept in memory; the RN app persists it with expo-sqlite kv-store.
import type { Answer, Result, Sources } from './app.contract.d.ts';

export const grants = '';

type Inverter = { id: string; serialNumber: string; efficiency: number };

// configStore.ts DEFAULT_CONFIG: 14 inverters with a realistic efficiency spread.
// Serial numbers are random 8-digit strings there; Contract sources may not use
// randomness, so these are fixed 8-digit stand-ins.
const EFFICIENCIES = [95, 95, 95, 95, 95, 95, 95, 75, 68, 62, 20, 15, 0, 0];
let inverters: Inverter[] = EFFICIENCIES.map((efficiency, i) => ({
  id: String(i + 1),
  serialNumber: String(40210000 + (i + 1) * 1379),
  efficiency,
}));
let defaultMaxWattage = 430;

const config = (): Result<'config'> => ({ defaultMaxWattage, inverters });

const sources: Sources = {
  config,
  // configStore.ts updateDefaultWattage: Math.max(1, wattage); useConfigForm parses with parseInt
  setWattage: ([text]) => {
    const wattage = parseInt(text, 10);
    if (!isNaN(wattage)) defaultMaxWattage = Math.max(1, wattage);
    return { ok: true };
  },
  // InverterDetailsForm: efficiency is a 0-100 percentage
  setEfficiency: ([id, efficiency]) => {
    const clamped = Math.min(100, Math.max(0, efficiency));
    inverters = inverters.map((inv) => (inv.id === id ? { ...inv, efficiency: clamped } : inv));
    return { ok: true };
  },
};

export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
