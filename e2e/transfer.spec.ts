import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  statSync,
  writeFileSync,
  openSync,
  writeSync,
  closeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newDevice, uniqueEmail } from './helpers';

const MB = 1024 * 1024;

/** Random file on disk; Chrome reads it lazily via setInputFiles (no 1 GB in test memory). */
function makeFile(name: string, size: number): string {
  const dir = process.env.E2E_TMP ?? tmpdir();
  const file = path.join(dir, name);
  if (existsSync(file) && statSync(file).size === size) return file;
  const fd = openSync(file, 'w');
  const block = Buffer.alloc(4 * MB);
  for (let written = 0; written < size; written += block.length) {
    for (let i = 0; i < block.length; i += 65536)
      block.set(crypto.getRandomValues(new Uint8Array(65536)), i);
    writeSync(fd, block, 0, Math.min(block.length, size - written));
  }
  closeSync(fd);
  return file;
}

async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

/** JS heap + ArrayBuffer backing stores, via CDP. */
async function memorySampler(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  let peak = 0;
  const samples: number[] = [];
  const timer = setInterval(async () => {
    try {
      const u = (await cdp.send('Runtime.getHeapUsage')) as {
        usedSize: number;
        backingStorageSize?: number;
      };
      const total = u.usedSize + (u.backingStorageSize ?? 0);
      samples.push(total);
      peak = Math.max(peak, total);
    } catch {
      /* page closing */
    }
  }, 1000);
  return {
    stop: () => clearInterval(timer),
    get peak() {
      return peak;
    },
    samples,
  };
}

async function sendFile(sender: Page, receiver: Page, file: string) {
  const hashes: string[] = [];
  receiver.on('console', (m) => {
    const match = m.text().match(/\[dev\] received sha256 ([0-9a-f]{64}) ok=(\w+)/);
    if (match) hashes.push(`${match[1]}:${match[2]}`);
  });
  await sender.goto('/send');
  await sender.locator('input[type=file]').setInputFiles(file);
  await sender.getByRole('button', { name: /^Send 1 file$/ }).click();
  return hashes;
}

test.describe.configure({ mode: 'serial' });

test('sends a 20 MB file P2P and it arrives intact', async ({ browser }) => {
  const email = uniqueEmail('m5s');
  const phone = await newDevice(browser, email);
  const mac = await newDevice(browser, email);
  await mac.evaluate(() => localStorage.setItem('droplink:dev-sink', 'discard'));
  await mac.goto('/receive');

  const file = makeFile('droplink-e2e-20mb.bin', 20 * MB);
  const expected = await sha256File(file);
  const hashes = await sendFile(phone, mac, file);

  await expect(phone.getByText('Delivered')).toBeVisible({ timeout: 60_000 });
  await expect(mac.getByText('✓ checksum')).toBeVisible();
  expect(hashes).toEqual([`${expected}:true`]);
});

test('sends a 1 GB file with stable memory and a matching SHA-256', async ({ browser }) => {
  test.skip(!process.env.E2E_BIG, 'set E2E_BIG=1 to run the 1 GB test');
  const email = uniqueEmail('m5b');
  const phone = await newDevice(browser, email);
  const mac = await newDevice(browser, email);
  await mac.evaluate(() => localStorage.setItem('droplink:dev-sink', 'discard'));
  await mac.goto('/receive');

  const size = 1024 * MB;
  const file = makeFile('droplink-e2e-1gb.bin', size);
  const expected = await sha256File(file);

  const memSender = await memorySampler(phone);
  const memReceiver = await memorySampler(mac);
  const started = Date.now();
  const hashes = await sendFile(phone, mac, file);
  await expect(phone.getByText('Delivered')).toBeVisible({ timeout: 8 * 60_000 });
  const seconds = (Date.now() - started) / 1000;
  memSender.stop();
  memReceiver.stop();

  await expect(mac.getByText('✓ checksum')).toBeVisible();
  expect(hashes).toEqual([`${expected}:true`]);

  const report = {
    seconds: Math.round(seconds),
    mbPerSecond: Math.round(size / MB / seconds),
    senderPeakMB: Math.round(memSender.peak / MB),
    receiverPeakMB: Math.round(memReceiver.peak / MB),
  };
  console.log('1 GB transfer:', JSON.stringify(report));
  writeFileSync(
    path.join(process.env.E2E_TMP ?? tmpdir(), 'droplink-1gb-report.json'),
    JSON.stringify(report),
  );
  // "Stable memory": nowhere near the file size on either side.
  expect(memSender.peak).toBeLessThan(200 * MB);
  expect(memReceiver.peak).toBeLessThan(200 * MB);
});

test('resumes a file after the connection drops mid-transfer', async ({ browser }) => {
  const email = uniqueEmail('m5r');
  const phone = await newDevice(browser, email);
  const mac = await newDevice(browser, email);
  await mac.evaluate(() => localStorage.setItem('droplink:dev-sink', 'discard'));
  await mac.goto('/receive');
  const resumes: number[] = [];
  mac.on('console', (m) => {
    const r = m.text().match(/\[dev\] resuming at chunk (\d+)/);
    if (r) resumes.push(Number(r[1]));
  });

  const file = makeFile('droplink-e2e-200mb.bin', 200 * MB);
  const expected = await sha256File(file);
  const hashes = await sendFile(phone, mac, file);

  // Wait until some data has arrived, then kill the connection from the receiver.
  await expect(mac.getByText(/MB of 200 MB/)).toBeVisible({ timeout: 30_000 });
  await mac.waitForTimeout(1500);
  await mac.evaluate(() =>
    (window as unknown as { __droplink: { dropConnections(): void } }).__droplink.dropConnections(),
  );

  await expect(phone.getByText('Delivered')).toBeVisible({ timeout: 3 * 60_000 });
  expect(resumes.length).toBeGreaterThan(0);
  expect(resumes[0]).toBeGreaterThan(0); // resumed mid-file, not from scratch
  expect(hashes).toEqual([`${expected}:true`]);
});
