import { Storage } from '@google-cloud/storage';
import path from 'path';
import fs from 'fs';

const GCS_BUCKET = process.env.GCS_BUCKET || '';
const USE_GCS = !!GCS_BUCKET;

let storage: Storage | null = null;
if (USE_GCS) {
  storage = new Storage(); // Uses Application Default Credentials on Cloud Run
}

/**
 * Upload a file to GCS or local filesystem.
 * Returns the URL path to access the file (e.g., /uploads/photos/xxx.jpg).
 */
export async function uploadFile(
  localFilePath: string,
  folder: 'photos' | 'ar',
  filename: string,
): Promise<string> {
  const destination = `${folder}/${filename}`;

  if (USE_GCS && storage) {
    const bucket = storage.bucket(GCS_BUCKET);
    await bucket.upload(localFilePath, {
      destination,
      metadata: {
        cacheControl: 'public, max-age=31536000',
      },
    });
    // Clean up local temp file
    fs.unlink(localFilePath, () => {});
    return `/uploads/${destination}`;
  }

  // Local fallback: file is already in the right place (multer saved it)
  return `/uploads/${destination}`;
}

/**
 * Stream a file from GCS. Returns null if not using GCS.
 */
export async function getFileStream(
  filePath: string,
): Promise<{ stream: NodeJS.ReadableStream; contentType: string } | null> {
  if (!USE_GCS || !storage) return null;

  // filePath is like "photos/xxx.jpg" or "ar/xxx.usdz"
  const bucket = storage.bucket(GCS_BUCKET);
  const file = bucket.file(filePath);

  const [exists] = await file.exists();
  if (!exists) return null;

  const ext = path.extname(filePath).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.usdz': 'model/vnd.usdz+zip',
  };

  return {
    stream: file.createReadStream(),
    contentType: contentTypes[ext] || 'application/octet-stream',
  };
}

export { USE_GCS };
