import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
  /** Client for server-side operations (internal Docker network). */
  private s3: S3Client;

  /**
   * Client used exclusively for generating presigned URLs.
   * When S3_PUBLIC_ENDPOINT is set it points to a browser-reachable address
   * (e.g. http://localhost:9000) so the signed URL works from the browser.
   * Falls back to the main client when the variable is not set.
   */
  private s3Signing: S3Client;

  private bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET || 'campuscast-content';

    const region = process.env.S3_REGION || 'us-east-1';
    const credentials = {
      accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
    };

    const internalEndpoint = process.env.S3_ENDPOINT || 'http://localhost:9000';

    this.s3 = new S3Client({
      endpoint: internalEndpoint,
      region,
      credentials,
      forcePathStyle: true,
    });

    const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT;

    this.s3Signing = publicEndpoint
      ? new S3Client({
          endpoint: publicEndpoint,
          region,
          credentials,
          forcePathStyle: true,
        })
      : this.s3;
  }

  async getPresignedUploadUrl(key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    return getSignedUrl(this.s3Signing, command, { expiresIn: 3600 });
  }

  async getPresignedDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const expiresIn = parseInt(process.env.S3_DOWNLOAD_URL_TTL_SECONDS || '604800', 10); // 7 days
    return getSignedUrl(this.s3Signing, command, { expiresIn });
  }
}
