import { createServer } from "node:net";
import { LOCAL_FORWARD_HOST } from "./constants";

export async function allocateEphemeralPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, LOCAL_FORWARD_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to determine allocated local port")));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function assertPortIsBindable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, LOCAL_FORWARD_HOST, () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
}

export async function ensureLocalPortAvailable(reservedPorts: Set<number>): Promise<number> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = await allocateEphemeralPort();
    if (reservedPorts.has(candidate)) {
      continue;
    }
    await assertPortIsBindable(candidate);
    return candidate;
  }

  throw new Error("Failed to allocate a local port for forwarding");
}
