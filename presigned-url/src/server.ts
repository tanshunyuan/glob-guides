import express, { type Request, type Response } from "express";
import cors from "cors";
import { env } from "../env.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import z from "zod";

const app = express();

app.use(cors());

// Middleware
app.use(express.json());

const s3 = new S3Client({
  region: "auto", // Required by AWS SDK, not used by R2
  endpoint: env.CLOUDFLARE_R2_URL,
  credentials: {
    accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  },
});

const UploadSchema = z.object({
  name: z.string(),
  contentType: z.string(),
});
app.post("/upload", async (req: Request, res: Response) => {
  try {
    const body = UploadSchema.parse(req.body);

    const signedUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: "test-bucket",
        Key: body.name,
        ContentType: body.contentType,
      }),
      { expiresIn: 3600 },
    );
    return res.status(200).json({ signedUrl });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const pretty = z.prettifyError(e);
      return res.status(400).json(pretty);
    }
    console.log(e)
    return res.status(500).json('Unexpected Error');
  }
});

// Start server
app.listen(env.PORT, () => {
  console.log(`Server is running on http://localhost:${env.PORT}`);
});
