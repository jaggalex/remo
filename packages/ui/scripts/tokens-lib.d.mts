export const TOKENS_PATH: string;
export const THEMES: string[];
export const LAYER_PREFIXES: Record<string, string[]>;
export const PAIRS: [string, string, number][];
export interface ContrastRow { theme: string; fg: string; bg: string; min: number; ratio: number; ok: boolean }
export function loadTokens(path?: string): any;
export function allTokens(t: any): { name: string; value: unknown; usage?: string; layer?: string; family: string }[];
export function buildCss(t: any): Record<string, string>;
export function ratio(a: number[], b: number[]): number;
export function resolver(t: any): (name: string, theme: string) => string;
export function contrastReport(t: any): ContrastRow[];
export function lintTokens(t: any): string[];
