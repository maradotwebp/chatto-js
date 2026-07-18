import { fromJson, toJson, type DescMessage, type DescService, type JsonValue, type Message } from "@bufbuild/protobuf";

interface MockRoute {
  readonly input: DescMessage;
  readonly output: DescMessage;
  readonly handler: (input: Message, request: Request) => JsonValue | Promise<JsonValue>;
}

export interface CapturedConnectRequest {
  readonly path: string;
  readonly headers: Headers;
  readonly input: Message;
}

export interface MockConnectServer {
  readonly baseUrl: string;
  readonly requests: CapturedConnectRequest[];
  route(
    service: DescService,
    localMethodName: string,
    handler: (input: Message, request: Request) => JsonValue | Promise<JsonValue>,
  ): void;
  error(service: DescService, localMethodName: string, code: string, message: string, status?: number): void;
  stop(): Promise<void>;
}

export function startMockConnectServer(): MockConnectServer {
  const routes = new Map<string, MockRoute>();
  const errors = new Map<string, { code: string; message: string; status: number }>();
  const requests: CapturedConnectRequest[] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const route = routes.get(path);
      const error = errors.get(path);

      if (error) {
        return Response.json({ code: error.code, message: error.message }, {
          status: error.status,
          headers: { "Connect-Protocol-Version": "1" },
        });
      }
      if (!route) return new Response("not found", { status: 404 });
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

      const inputJson = await request.json() as JsonValue;
      const input = fromJson(route.input, inputJson);
      requests.push({ path, headers: new Headers(request.headers), input });
      const outputJson = await route.handler(input, request);
      const output = fromJson(route.output, outputJson);

      return Response.json(toJson(route.output, output), {
        headers: {
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
        },
      });
    },
  });

  function methodPath(service: DescService, localMethodName: string): { path: string; method: DescService["methods"][number] } {
    const method = service.methods.find((candidate) => candidate.localName === localMethodName);
    if (!method) throw new Error(`Unknown method ${service.typeName}.${localMethodName}`);
    return { path: `/api/connect/${service.typeName}/${method.name}`, method };
  }

  return {
    baseUrl: `http://${server.hostname}:${server.port}`,
    requests,
    route(service, localMethodName, handler) {
      const { path, method } = methodPath(service, localMethodName);
      routes.set(path, { input: method.input, output: method.output, handler });
    },
    error(service, localMethodName, code, message, status = 400) {
      const { path } = methodPath(service, localMethodName);
      errors.set(path, { code, message, status });
    },
    async stop() {
      await server.stop(true);
    },
  };
}
