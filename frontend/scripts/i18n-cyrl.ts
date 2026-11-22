/**
 * Lugʻatlar: `messages/<til>/<nomlar fazosi>.json`. Bu skript (`pnpm i18n:cyrl`):
 *  1) `messages/uz-Cyrl/*.json` ni `messages/uz-Latn/*.json` dan avtomatik yasaydi
 *     (qoʻlda tuzatish — `messages/uz-Cyrl.overrides.json`, kalit: "<fazo>.<yoʻl>" emas, ichma-ich obyekt: { "<fazo>": { … } });
 *  2) `i18n/dict/<til>.generated.ts` (har til alohida modul) va `i18n/messages.generated.ts` (uchalasi) ni yangilaydi.
 * Yangi fazo qoʻshish: `messages/uz-Latn/<fazo>.json` + `messages/ru/<fazo>.json`, keyin shu skript.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { buildCyrillic } from "../i18n/cyrl.ts";
import type { Messages } from "../i18n/translit.ts";

const root = new URL("../messages/", import.meta.url);
const read = (path: string): Messages => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const namespaces = readdirSync(new URL("uz-Latn/", root))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5))
  .sort();

const overrides = existsSync(new URL("uz-Cyrl.overrides.json", root)) ? read("uz-Cyrl.overrides.json") : {};
rmSync(new URL("uz-Cyrl/", root), { recursive: true, force: true });
mkdirSync(new URL("uz-Cyrl/", root));
for (const ns of namespaces) {
  const extra = overrides[ns];
  const cyr = buildCyrillic(read(`uz-Latn/${ns}.json`), typeof extra === "object" ? extra : {});
  writeFileSync(new URL(`uz-Cyrl/${ns}.json`, root), `${JSON.stringify(cyr, null, 2)}\n`);
}

const LOCALES = ["uz-Latn", "uz-Cyrl", "ru"];
const ident = (locale: string) => locale.replace("-", "");
// Har til — alohida modul: brauzer faqat tanlangan til lugʻatini yuklaydi (S1 5-qism).
mkdirSync(new URL("../i18n/dict/", import.meta.url), { recursive: true });
for (const l of LOCALES) {
  const id = (ns: string) => `m_${ns.replace(/\W/g, "_")}`;
  const dict = [
    "// AVTOMATIK YASALGAN (`pnpm i18n:cyrl`) — qoʻlda oʻzgartirmang.",
    ...namespaces.map((ns) => `import ${id(ns)} from "@/messages/${l}/${ns}.json";`),
    "",
    `export const ${ident(l)} = {\n${namespaces.map((ns) => `  ${JSON.stringify(ns)}: ${id(ns)},`).join("\n")}\n};\n`,
  ];
  writeFileSync(new URL(`../i18n/dict/${l}.generated.ts`, import.meta.url), dict.join("\n"));
}
const lines = [
  "// AVTOMATIK YASALGAN (`pnpm i18n:cyrl`) — qoʻlda oʻzgartirmang.",
  "// Uch til birga — faqat server, testlar va tiplar uchun (brauzerga `i18n/dict/*` dan bittasi boradi).",
  ...LOCALES.map((l) => `export { ${ident(l)} } from "./dict/${l}.generated";`),
  "",
];
writeFileSync(new URL("../i18n/messages.generated.ts", import.meta.url), lines.join("\n"));
console.log(`messages: ${namespaces.length} ta fazo, uz-Cyrl, i18n/dict/* va messages.generated.ts yangilandi`);
