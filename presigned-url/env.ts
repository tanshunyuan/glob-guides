import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, ".env") });

export const env = createEnv({
  server: {
    PORT: z.coerce.number().default(8086),
    HOST: z.string().default("0.0.0.0"),
    CLOUDFLARE_R2_URL: z.url(),
    CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().min(1),
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().min(1)
  },
  runtimeEnv: process.env,
});
