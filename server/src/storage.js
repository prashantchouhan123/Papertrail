import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "./config.js";
import { AppError } from "./errors.js";

const s3 = config.storageDriver === "s3" ? new S3Client({
  endpoint: process.env.S3_ENDPOINT || undefined,
  region: process.env.S3_REGION || "us-east-1",
  forcePathStyle: Boolean(process.env.S3_ENDPOINT),
  credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "" } : undefined,
}) : null;
const bucket = process.env.S3_BUCKET;

function localPath(key) {
  const full = path.resolve(config.uploadDir, key);
  if (!full.startsWith(`${config.uploadDir}${path.sep}`)) throw new AppError(400, "INVALID_STORAGE_KEY", "Invalid document storage reference.");
  return full;
}

export async function storePdf(buffer) {
  const key = `${crypto.randomUUID()}.pdf`;
  if (config.storageDriver === "s3") {
    if (!s3 || !bucket) throw new AppError(503, "STORAGE_NOT_CONFIGURED", "Private object storage is not configured.");
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: "application/pdf", ServerSideEncryption: "AES256" }));
  } else {
    await fs.mkdir(config.uploadDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(localPath(key), buffer, { flag: "wx", mode: 0o600 });
  }
  return key;
}

export async function readPdf(key) {
  if (config.storageDriver === "s3") {
    if (!s3 || !bucket) throw new AppError(503, "STORAGE_NOT_CONFIGURED", "Private object storage is not configured.");
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await response.Body.transformToByteArray());
  }
  return fs.readFile(localPath(key));
}

export async function deletePdf(key) {
  if (config.storageDriver === "s3") {
    if (!s3 || !bucket) throw new AppError(503, "STORAGE_NOT_CONFIGURED", "Private object storage is not configured.");
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return;
  }
  await fs.rm(localPath(key), { force: true });
}
