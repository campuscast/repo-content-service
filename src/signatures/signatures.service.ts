import { Injectable } from '@nestjs/common';

@Injectable()
export class SignaturesService {
  private readonly signingKmsUrl = process.env.SIGNING_KMS_URL || 'http://localhost:3008';

  async sign(data: Buffer): Promise<{ signature: string; key_id: string }> {
    const res = await fetch(`${this.signingKmsUrl}/signing/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data_base64: data.toString('base64'),
        purpose: 'content',
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`Signing-KMS sign failed: ${await res.text()}`);
    }
    const payload = await res.json() as { signature: string; key_id: string };
    return { signature: payload.signature, key_id: payload.key_id };
  }

  async verify(data: Buffer, signature: string, keyId: string): Promise<boolean> {
    const res = await fetch(`${this.signingKmsUrl}/signing/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data_base64: data.toString('base64'),
        signature,
        key_id: keyId,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const payload = await res.json() as { valid: boolean };
    return payload.valid === true;
  }
}
