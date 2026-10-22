import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { decryptBackup, encryptBackup, HEADER_BYTES } from "../../../scripts/lib/backup-envelope.mjs";

async function collect(stream: PassThrough) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function encrypted(plaintext: Buffer, passphrase = "synthetic-passphrase-that-is-long-enough") {
  const output = new PassThrough();
  const result = collect(output);
  await encryptBackup(Readable.from(plaintext), output, passphrase, (size: number) => Buffer.alloc(size, 7));
  return result;
}

describe("authenticated database backup envelope", () => {
  it("handles destination errors during asynchronous key derivation", async () => {
    const output = new PassThrough();
    const pending = encryptBackup(Readable.from("archive"), output, "synthetic-passphrase-that-is-long-enough");
    queueMicrotask(() => output.destroy(new Error("synthetic output failure")));
    await expect(pending).rejects.toThrow("synthetic output failure");
  });

  it("handles input errors during decryption key derivation", async () => {
    const envelope = await encrypted(Buffer.from("archive"));
    const input = new PassThrough();
    const pending = decryptBackup(input, new PassThrough(), "synthetic-passphrase-that-is-long-enough", envelope.subarray(0, HEADER_BYTES));
    queueMicrotask(() => input.destroy(new Error("synthetic input failure")));
    await expect(pending).rejects.toThrow("synthetic input failure");
  });
  it("round-trips binary custom-archive bytes", async () => {
    const plaintext = Buffer.from([0, 255, 80, 71, 68, 77, 80, 1, 2, 3]);
    const envelope = await encrypted(plaintext);
    const output = new PassThrough();
    const result = collect(output);

    await decryptBackup(
      Readable.from(envelope.subarray(HEADER_BYTES)),
      output,
      "synthetic-passphrase-that-is-long-enough",
      envelope.subarray(0, HEADER_BYTES),
    );

    expect(await result).toEqual(plaintext);
    expect(envelope).not.toContain(plaintext);
  });

  it("rejects changed ciphertext before accepting the archive", async () => {
    const envelope = await encrypted(Buffer.from("synthetic custom archive"));
    envelope[HEADER_BYTES + 2] ^= 1;

    await expect(
      decryptBackup(
        Readable.from(envelope.subarray(HEADER_BYTES)),
        new PassThrough(),
        "synthetic-passphrase-that-is-long-enough",
        envelope.subarray(0, HEADER_BYTES),
      ),
    ).rejects.toThrow("backup authentication failed");
  });

  it("rejects a wrong passphrase and truncated authentication tag", async () => {
    const envelope = await encrypted(Buffer.from("archive"));
    await expect(
      decryptBackup(Readable.from(envelope.subarray(HEADER_BYTES)), new PassThrough(), "wrong-passphrase-that-is-still-32-chars", envelope.subarray(0, HEADER_BYTES)),
    ).rejects.toThrow("backup authentication failed");
    await expect(
      decryptBackup(Readable.from(envelope.subarray(HEADER_BYTES, -1)), new PassThrough(), "synthetic-passphrase-that-is-long-enough", envelope.subarray(0, HEADER_BYTES)),
    ).rejects.toThrow("backup authentication failed");
  });
});
