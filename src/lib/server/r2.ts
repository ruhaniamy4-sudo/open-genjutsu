import { AwsClient } from 'aws4fetch';

let client: AwsClient | null = null;

function r2(): AwsClient {
  if (!client) {
    client = new AwsClient({
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      service: 's3',
      region: 'auto',
    });
  }
  return client;
}

export function r2Host(): string {
  return `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

function objectUrl(key: string, expiresSec: number): URL {
  const url = new URL(`https://${r2Host()}/${process.env.R2_BUCKET_NAME}/${key.split('/').map(encodeURIComponent).join('/')}`);
  url.searchParams.set('X-Amz-Expires', String(expiresSec));
  return url;
}

/** Presigned PUT (browser upload) + presigned GET (GPU worker / fal read) for one object key. */
export async function presignObject(key: string, contentType: string, size: number) {
  // Content-Length is signed, so the upload must be exactly the size the server validated.
  const put = await r2().sign(
    new Request(objectUrl(key, 600), { method: 'PUT', headers: { 'Content-Type': contentType, 'Content-Length': String(size) } }),
    { aws: { signQuery: true } },
  );
  const get = await r2().sign(new Request(objectUrl(key, 60 * 60 * 24), { method: 'GET' }), { aws: { signQuery: true } });
  return { uploadUrl: put.url, readUrl: get.url };
}
