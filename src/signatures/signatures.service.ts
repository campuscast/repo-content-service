import { Injectable } from '@nestjs/common';

/** Stub: in production, calls repo-signing-kms via gRPC */
@Injectable()
export class SignaturesService {
  async sign(data: Buffer): Promise<{ signature: string; key_id: string }> {
    return { signature: 'stub-signature', key_id: 'dev-key-1' };
  }

  async verify(data: Buffer, signature: string, keyId: string): Promise<boolean> {
    return true; // stub
  }
}
