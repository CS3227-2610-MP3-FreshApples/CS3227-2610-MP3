import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export const MAGIC = Buffer.from("MP3DBBACKUP\x01", "binary");
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;

async function keyFor(passphrase, salt) {
  return scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export async function encryptionHeader(passphrase, random = randomBytes) {
  const salt = random(SALT_BYTES);
  const iv = random(IV_BYTES);
  const header = Buffer.concat([MAGIC, salt, iv]);
  return { header, iv, key: await keyFor(passphrase, salt) };
}

export async function encryptBackup(source, destination, passphrase, random = randomBytes) {
  let cipher;
  const encrypt = new Transform({
    construct(callback) {
      // pipeline installs stream error handlers before asynchronous key derivation starts.
      encryptionHeader(passphrase, random).then(({ header, iv, key }) => {
        cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(header);
        this.push(header);
        callback();
      }).catch(callback);
    },
    transform(chunk, _encoding, callback) {
      try { callback(null, cipher.update(chunk)); } catch (error) { callback(error); }
    },
    flush(callback) {
      try { this.push(cipher.final()); this.push(cipher.getAuthTag()); callback(); } catch (error) { callback(error); }
    },
  });
  await pipeline(source, encrypt, destination);
}

export function parseHeader(header) {
  if (header.length !== HEADER_BYTES || !header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("backup envelope is invalid");
  }
  return {
    salt: header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES),
    iv: header.subarray(MAGIC.length + SALT_BYTES),
  };
}

export async function decryptBackup(source, destination, passphrase, header) {
  const { salt, iv } = parseHeader(header);
  let decipher;
  let tail = Buffer.alloc(0);
  const decrypt = new Transform({
    construct(callback) {
      keyFor(passphrase, salt).then((key) => {
        decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(header);
        callback();
      }).catch(callback);
    },
    transform(chunk, _encoding, callback) {
      try {
        const combined = Buffer.concat([tail, chunk]);
        if (combined.length <= TAG_BYTES) { tail = combined; callback(); return; }
        const split = combined.length - TAG_BYTES;
        tail = combined.subarray(split);
        callback(null, decipher.update(combined.subarray(0, split)));
      } catch (error) { callback(error); }
    },
    flush(callback) {
      try {
        if (tail.length !== TAG_BYTES) throw new Error("backup envelope is truncated");
        decipher.setAuthTag(tail);
        this.push(decipher.final());
        callback();
      } catch { callback(new Error("backup authentication failed")); }
    },
  });
  await pipeline(source, decrypt, destination);
}

export function verificationSink() {
  return new Writable({ write(_chunk, _encoding, callback) { callback(); } });
}
