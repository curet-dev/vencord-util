import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const shared = { "@shared": resolve(__dirname, "src/shared") };

export default defineConfig({
    main: {
        resolve: { alias: shared },
        build: {
            externalizeDeps: true,
            rollupOptions: {
                external: ["original-fs"]
            }
        }
    },
    preload: {
        resolve: { alias: shared },
        build: { externalizeDeps: true }
    },
    renderer: {
        resolve: {
            alias: {
                ...shared,
                "@renderer": resolve(__dirname, "src/renderer/src")
            }
        },
        plugins: [react()]
    }
});
