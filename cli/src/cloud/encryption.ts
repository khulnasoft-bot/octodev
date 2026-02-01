import crypto from 'crypto';
import { createLogger } from '@/utils/logger';

const logger = createLogger('cloud-encryption');

/**
 * E2E Encryption utility for sensitive data (macros, prompts)
 * Uses AES-256-GCM for authenticated encryption
 */
export class E2EEncryption {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly KEY_LENGTH = 32; // 256 bits
  private static readonly IV_LENGTH = 12; // 96 bits (recommended for GCM)
  private static readonly TAG_LENGTH = 16; // 128 bits

  /**
   * Generate a random encryption key from passphrase
   */
  static deriveKey(passphrase: string): Buffer {
    return crypto
      .pbkdf2Sync(passphrase, 'octodev-salt', 100000, this.KEY_LENGTH, 'sha256');
  }

  /**
   * Encrypt plaintext with AES-256-GCM
   */
  static encrypt(plaintext: string, key: Buffer): string {
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();
    const payload = iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;

    logger.debug({ length: plaintext.length }, 'Data encrypted');
    return payload;
  }

  /**
   * Decrypt ciphertext with AES-256-GCM
   */
  static decrypt(ciphertext: string, key: Buffer): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    logger.debug({ length: decrypted.length }, 'Data decrypted');
    return decrypted;
  }

  /**
   * Hash a value for comparison
   */
  static hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}

/**
 * Local encryption key manager
 */
export class KeyManager {
  private key: Buffer | null = null;
  private keyPath: string;

  constructor(keyPath?: string) {
    this.keyPath = keyPath || `${process.env.HOME}/.octodev/encryption-key`;
  }

  /**
   * Get or create encryption key
   */
  getKey(passphrase: string): Buffer {
    if (!this.key) {
      this.key = E2EEncryption.deriveKey(passphrase);
    }
    return this.key;
  }

  /**
   * Clear key from memory
   */
  clearKey(): void {
    if (this.key) {
      this.key.fill(0);
      this.key = null;
    }
  }
}
