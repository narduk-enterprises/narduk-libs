/** @type {import("prettier").Config} */
// Preserve the extracted source style (byte-identical). Root monorepo prettier
// defaults (semi:false, singleQuote:true) would rewrite these files; this
// package keeps its original double-quote / semicolon style.
export default {
  printWidth: 100,
  proseWrap: "preserve",
};
