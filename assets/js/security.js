/**
 * Unravel - Browser Crypto Vault & Session Security
 * Implements Web Crypto API AES-GCM 256-bit password-based key derivation (PBKDF2).
 * Enables zero-trust encrypted client-side caching of sensitive business and user records.
 */

class UnravelSecurity {
  static SALT_KEY = 'unravel_vault_salt';
  static VERIFY_KEY = 'unravel_vault_verify';
  static SESSION_KEY = 'unravel_session_active';
  static DATA_CACHE_KEY = 'unravel_vault_data';

  /**
   * Check if a master vault password has been set on this browser
   */
  static hasVaultPassword() {
    return localStorage.getItem(this.VERIFY_KEY) !== null;
  }

  /**
   * Check if current browser session is unlocked
   */
  static isSessionUnlocked() {
    return sessionStorage.getItem(this.SESSION_KEY) === 'unlocked' || localStorage.getItem('unravel_vault_unlocked') === 'true';
  }

  /**
   * Generate or retrieve random salt
   */
  static getOrCreateSalt() {
    let saltHex = localStorage.getItem(this.SALT_KEY);
    if (!saltHex) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(this.SALT_KEY, saltHex);
    }
    const match = saltHex.match(/.{1,2}/g);
    return new Uint8Array(match.map(byte => parseInt(byte, 16)));
  }

  /**
   * Derive AES-GCM Key from user passphrase
   */
  static async deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );

    return await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Setup/Initialize Vault Password
   */
  static async setupVaultPassword(password) {
    const salt = this.getOrCreateSalt();
    const key = await this.deriveKey(password, salt);
    
    // Encrypt verification token "UNRAVEL_VAULT_OK"
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      enc.encode("UNRAVEL_VAULT_OK")
    );

    const payload = {
      iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
      data: Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, '0')).join('')
    };

    localStorage.setItem(this.VERIFY_KEY, JSON.stringify(payload));
    sessionStorage.setItem(this.SESSION_KEY, 'unlocked');
    localStorage.setItem('unravel_vault_unlocked', 'true');
    return true;
  }

  /**
   * Verify Vault Password
   */
  static async verifyVaultPassword(password) {
    const verifyData = localStorage.getItem(this.VERIFY_KEY);
    if (!verifyData) return false;

    try {
      const { iv, data } = JSON.parse(verifyData);
      const salt = this.getOrCreateSalt();
      const key = await this.deriveKey(password, salt);

      const ivArr = new Uint8Array(iv.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
      const dataArr = new Uint8Array(data.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivArr },
        key,
        dataArr
      );

      const dec = new TextDecoder();
      const text = dec.decode(decrypted);

      if (text === "UNRAVEL_VAULT_OK") {
        sessionStorage.setItem(this.SESSION_KEY, 'unlocked');
        localStorage.setItem('unravel_vault_unlocked', 'true');
        return true;
      }
      return false;
    } catch (err) {
      console.warn("Vault unlock failed:", err);
      return false;
    }
  }

  /**
   * Lock Session
   */
  static lockSession() {
    sessionStorage.removeItem(this.SESSION_KEY);
    localStorage.removeItem('unravel_vault_unlocked');
  }

  /**
   * Reset Vault: Clears saved master password, verification payload, and vault session state,
   * without destroying user projects, schemas, or templates.
   */
  static resetVault() {
    try {
      localStorage.removeItem(this.VERIFY_KEY);
      localStorage.removeItem(this.SALT_KEY);
      localStorage.removeItem('unravel_vault_unlocked');
      sessionStorage.removeItem(this.SESSION_KEY);
      sessionStorage.removeItem(this.DATA_CACHE_KEY);
    } catch (err) {
      console.warn("Vault reset failed:", err);
    }
  }

  // =========================================================================
  // HYBRID IN-TRANSIT ENCRYPTION (RSA-OAEP + AES-256-GCM)
  // For End-to-End Secure Cloud Transit to Decryption Microservice
  // =========================================================================

  /**
   * Convert PEM public key string to Web Crypto CryptoKey (RSA-OAEP, SHA-256)
   */
  static async importRsaPublicKey(pemString) {
    const cleanPem = pemString
      .replace(/-----BEGIN PUBLIC KEY-----/g, '')
      .replace(/-----END PUBLIC KEY-----/g, '')
      .replace(/[\r\n\s]/g, '');
    const binaryDer = Uint8Array.from(atob(cleanPem), c => c.charCodeAt(0));

    return await window.crypto.subtle.importKey(
      "spki",
      binaryDer.buffer,
      {
        name: "RSA-OAEP",
        hash: "SHA-256"
      },
      false,
      ["encrypt"]
    );
  }

  /**
   * Encrypt payload using Hybrid Encryption (Ephemeral AES-256-GCM + RSA-OAEP Key Wrapping)
   */
  static async encryptPayloadHybrid(payloadObj, rsaPublicKeyPem) {
    // 1. Import server RSA public key
    const rsaKey = await this.importRsaPublicKey(rsaPublicKeyPem);

    // 2. Generate single-use ephemeral AES-256-GCM session key
    const aesKey = await window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );

    // 3. Encrypt payload JSON with AES-256-GCM
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encodedPayload = new TextEncoder().encode(JSON.stringify(payloadObj));
    const encryptedPayloadBuffer = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      aesKey,
      encodedPayload
    );

    // 4. Export and wrap the AES key using RSA-OAEP
    const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);
    const wrappedKeyBuffer = await window.crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      rsaKey,
      rawAesKey
    );

    // Convert to base64
    const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));

    return {
      encryptedKey: toB64(wrappedKeyBuffer),
      encryptedPayload: toB64(encryptedPayloadBuffer),
      iv: toB64(iv),
      aesKey: aesKey // Retained in browser memory to decrypt response
    };
  }

  /**
   * Decrypt server's AES-256-GCM encrypted response using the session AES key
   */
  static async decryptPayloadHybrid(encryptedPayloadB64, ivB64, aesKey) {
    const fromB64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
    const encBuffer = fromB64(encryptedPayloadB64);
    const ivBuffer = fromB64(ivB64);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBuffer },
      aesKey,
      encBuffer
    );

    const decryptedText = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(decryptedText);
  }
}

if (typeof window !== 'undefined') {
  window.UnravelSecurity = UnravelSecurity;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UnravelSecurity;
}
