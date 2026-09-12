import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Instruments are mounted and server-rendered as real SFCs, so Vue has to compile them.
  plugins: [vue()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
