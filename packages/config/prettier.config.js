/** Gemeinsame Formatregeln. */
export default {
  printWidth: 110,
  singleQuote: false,
  trailingComma: "all",
  proseWrap: "preserve",
  // Astro-Seiten der Storefront
  plugins: ["prettier-plugin-astro"],
  overrides: [{ files: "*.astro", options: { parser: "astro" } }],
};
