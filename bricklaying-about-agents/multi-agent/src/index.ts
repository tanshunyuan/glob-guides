import express from "express";
import { env } from "../env.js";

const app = express();
app.listen(env.PORT, env.HOST, () => {
  console.log(`🚀 Server started on http://${env.HOST}:${env.PORT}`);
});
