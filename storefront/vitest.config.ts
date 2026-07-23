import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@/snowtype": path.resolve(__dirname, "./snowtype"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
