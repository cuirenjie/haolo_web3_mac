import { setTimeout as delay } from "node:timers/promises";

export class DrainState {
  phase = "ready";
  operations = 0;
  get ready() { return this.phase === "ready"; }
  begin() { this.phase = "draining"; }

  http(handler) {
    return async (request, response) => {
      if (!this.ready && request.url !== "/health") {
        response.writeHead(503, { "content-type": "application/json", "cache-control": "no-store", connection: "close" });
        response.end('{"status":"draining"}');
        return;
      }
      this.operations += 1;
      let handlerDone = false;
      let responseDone = false;
      let released = false;
      const release = () => {
        if (!released && handlerDone && responseDone) { released = true; this.operations -= 1; }
      };
      for (const event of ["finish", "close"]) response.once(event, () => { responseDone = true; release(); });
      try { await handler(request, response); }
      finally { handlerDone = true; release(); }
    };
  }

  upgrade(handler) {
    return async (request, socket, head) => {
      if (!this.ready) {
        socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      this.operations += 1;
      try { await handler(request, socket, head); }
      finally { this.operations -= 1; }
    };
  }

  async idle(extra = () => true) {
    // A supervisor deadline retains this instance. Never force-close WS/CONNECT.
    while (this.operations > 0 || !extra()) await delay(20);
  }
}

export function closeHttp(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
    server.closeIdleConnections?.();
  });
}
