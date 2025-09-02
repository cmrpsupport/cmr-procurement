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
      const publicDir = path.resolve(process.cwd(), "public");
      const logoPath = path.join(publicDir, "cmr-logo.png");
      const faviconPath = path.join(publicDir, "favicon.ico");
      const placeholderPath = path.join(publicDir, "placeholder.svg");
      const robotsPath = path.join(publicDir, "robots.txt");
      
      console.log("copyPublicFiles: Checking paths...");
      console.log("publicDir:", publicDir);
      console.log("logoPath:", logoPath, "exists:", fs.existsSync(logoPath));
      
      if (fs.existsSync(logoPath)) {
        console.log("copyPublicFiles: Emitting logo file");
        this.emitFile({
          type: "asset",
          fileName: "cmr-logo.png",
          source: fs.readFileSync(logoPath)
        });
      } else {
        console.warn("copyPublicFiles: Logo file not found at", logoPath);
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
    port: 8082,
    fs: {
      allow: ["./client", "./shared"],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "server/**"],
    }
  },
  build: {
    outDir: "dist/spa",
  },
  publicDir: "public", // Ensure public directory is copied
  assetsInclude: ['**/*.png', '**/*.ico', '**/*.svg'], // Explicitly include assets
  plugins: [react(), copyPublicFiles(), expressPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
}));

function expressPlugin(): Plugin {
  let expressApp: any;
  
  return {
    name: "express-plugin",
    apply: "serve", // Only apply during development (serve mode)
    async configureServer(server) {
      try {
        const { createServer } = await import("./server");
        expressApp = createServer();
        
        // Use the Express app for all API routes, inserted at the beginning
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.startsWith('/api')) {
            expressApp(req, res, next);
          } else {
            next();
          }
        });
        console.log('Express app integrated with Vite server');
      } catch (error) {
        console.error('Failed to integrate Express app:', error);
      }
    },
  };
}
