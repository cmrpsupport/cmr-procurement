import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { createServer } from "./server";

// Custom plugin to copy public files
function copyPublicFiles(): Plugin {
  return {
    name: "copy-public-files",
    generateBundle() {
      // Copy logo file to build output
      const logoPath = path.resolve(__dirname, "public/cmr-logo.png");
      const faviconPath = path.resolve(__dirname, "public/favicon.ico");
      const placeholderPath = path.resolve(__dirname, "public/placeholder.svg");
      const robotsPath = path.resolve(__dirname, "public/robots.txt");
      
      if (fs.existsSync(logoPath)) {
        this.emitFile({
          type: "asset",
          fileName: "cmr-logo.png",
          source: fs.readFileSync(logoPath)
        });
      }
      
      if (fs.existsSync(faviconPath)) {
        this.emitFile({
          type: "asset",
          fileName: "favicon.ico",
          source: fs.readFileSync(faviconPath)
        });
      }
      
      if (fs.existsSync(placeholderPath)) {
        this.emitFile({
          type: "asset",
          fileName: "placeholder.svg",
          source: fs.readFileSync(placeholderPath)
        });
      }
      
      if (fs.existsSync(robotsPath)) {
        this.emitFile({
          type: "asset",
          fileName: "robots.txt",
          source: fs.readFileSync(robotsPath)
        });
      }
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    fs: {
      allow: ["./client", "./shared"],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "server/**"],
    },
  },
  build: {
    outDir: "dist/spa",
  },
  plugins: [react(), copyPublicFiles(), expressPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
}));

function expressPlugin(): Plugin {
  return {
    name: "express-plugin",
    apply: "serve", // Only apply during development (serve mode)
    configureServer(server) {
      // Dynamic import to avoid issues during build
      import("./server").then(({ createServer }) => {
        const app = createServer();
        server.middlewares.use(app);
      });
    },
  };
}
