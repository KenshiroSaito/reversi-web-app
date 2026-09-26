import { createServer, RequestListener } from "node:http";
import { AddressInfo } from "node:net";

export interface TestServer {
  baseUrl: string;
  close(): Promise<void>;
}

/** Serves the handler on 127.0.0.1 and a random free port. */
export async function startTestServer(handler: RequestListener): Promise<TestServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

export interface ApiResponse {
  status: number;
  body: any;
  setCookie: string | undefined;
  headers: Headers;
}

export interface PostOptions {
  /** Send the CSRF header (default true). */
  csrf?: boolean;
  /** Origin header to send (default: the server's own origin). */
  origin?: string;
}

/**
 * A browser-like client with its own cookie jar. By default it sends what the
 * real frontend sends on POST: the CSRF header and a same-origin Origin.
 */
export class Guest {
  cookie: string | undefined;

  constructor(private _server: TestServer) {}

  get(path: string): Promise<ApiResponse> {
    return this.send("GET", path, undefined, {});
  }

  post(path: string, body?: unknown, options: PostOptions = {}): Promise<ApiResponse> {
    return this.send("POST", path, body, options);
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    options: PostOptions,
  ): Promise<ApiResponse> {
    const headers: Record<string, string> = {};
    if (this.cookie) {
      headers.Cookie = this.cookie;
    }
    if (method !== "GET") {
      if (options.csrf !== false) {
        headers["X-Requested-With"] = "reversi";
      }
      headers.Origin = options.origin ?? this._server.baseUrl;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(this._server.baseUrl + path, {
      method,
      headers,
      // A string is sent as-is, so tests can send malformed JSON.
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });

    // Node 24 has Headers.getSetCookie(); TypeScript 4.8's DOM typings predate it.
    const setCookie = (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie()[0];
    if (setCookie) {
      this.cookie = setCookie.split(";")[0];
    }
    return {
      status: response.status,
      body: parseBody(await response.text()),
      setCookie,
      headers: response.headers,
    };
  }
}

// JSON when it is JSON; Express's default 404 page (before a route exists) is HTML.
function parseBody(text: string): any {
  if (text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
