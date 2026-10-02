import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [reactRouter()],
    resolve: { alias: { "~": new URL("./app", import.meta.url).pathname } },
    define: {
      "process.env.SUPPORT_API_KEY": JSON.stringify(env.SUPPORT_API_KEY),
      "process.env.BUILD_ID": JSON.stringify(env.GITHUB_SHA ?? "local"),
    },
    build: { sourcemap: true },
  };
});
