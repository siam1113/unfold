import type { Browser } from "playwright";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export interface ResourceSample {
  browserRssMB: number;
  browserCpuPercent: number;
  browserCpuMs: number;
  processes: number;
}
export class BrowserResources {
  private previous = new Map<number, number>();
  private time = 0;
  private totalCpu = 0;
  constructor(private browser: Browser) {}
  async sample(): Promise<ResourceSample> {
    const session = await this.browser.newBrowserCDPSession();
    try {
      const { processInfo } = await session.send("SystemInfo.getProcessInfo");
      const now = Date.now();
      let delta = 0;
      for (const p of processInfo) {
        delta += Math.max(0, p.cpuTime - (this.previous.get(p.id) || 0));
        this.previous.set(p.id, p.cpuTime);
      }
      this.totalCpu += delta * 1000;
      let rssKB = 0;
      if (process.platform === "linux") {
        const sizes = await Promise.all(
          processInfo.map(async (p) => {
            try {
              return Number(
                (await readFile(`/proc/${p.id}/status`, "utf8")).match(
                  /^VmRSS:\s+(\d+)/m,
                )?.[1] || 0,
              );
            } catch {
              return 0;
            }
          }),
        );
        rssKB = sizes.reduce((a, b) => a + b, 0);
      } else {
        const { stdout } = await exec("ps", [
          "-o",
          "rss=",
          "-p",
          processInfo.map((p) => p.id).join(","),
        ]);
        rssKB = stdout
          .trim()
          .split(/\s+/)
          .reduce((sum, n) => sum + Number(n || 0), 0);
      }
      const result = {
        browserRssMB: rssKB / 1024,
        browserCpuPercent: this.time
          ? (delta * 100000) / Math.max(1, now - this.time)
          : 0,
        browserCpuMs: this.totalCpu,
        processes: processInfo.length,
      };
      this.time = now;
      return result;
    } finally {
      await session.detach();
    }
  }
}
export function resourcePressure(
  sample: ResourceSample,
  memoryMB: number,
  cpuPercent: number,
) {
  return sample.browserRssMB >= memoryMB
    ? "memory"
    : sample.browserCpuPercent >= cpuPercent
      ? "cpu"
      : undefined;
}
