import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import dotenv from 'dotenv'

dotenv.config()

export const env = createEnv({
  server: {
    OPENAI_API_KEY: z.string().min(1),
    TAVILY_API_KEY: z.string().min(1)
  },
  runtimeEnv: process.env,
});
