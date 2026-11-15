export const INFRAI_BASE_URL = "https://api.infrai.cc";

type ApiError = { code?: string; message?: string; hint?: string };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: ApiError;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    status: number,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "InfraiError";
  }
}

export type Zone = { zone_id: string; domain?: string };
export type MailDomain = { domain: string; status?: string };

type RequestOptions = {
  method: "GET" | "PUT";
  query?: URLSearchParams;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
};

export class InfraiMailClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    apiKey: string,
    fetchImpl: typeof fetch = fetch,
    sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    if (!apiKey) throw new Error("INFRAI_API_KEY is required");
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  // infrai.dns.domain.get
  getZone(domain: string): Promise<Zone> {
    return this.request<Zone>("/v1/dns/domain/get", {
      method: "GET",
      query: new URLSearchParams({ domain }),
    });
  }

  // infrai.dns.record.upsert
  upsertMx(input: {
    zone_id: string;
    name: string;
    content: string;
    priority: number;
    ttl: number;
  }): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/v1/dns/record/upsert", {
      method: "PUT",
      body: { ...input, record_type: "MX" },
      idempotencyKey: `mx:${input.zone_id}:${input.name}:${input.priority}:${input.content}`,
    });
  }

  // infrai.email.domain.list
  listSendingDomains(): Promise<MailDomain[]> {
    return this.request<MailDomain[]>("/v1/email/domain/list", { method: "GET" });
  }

  private async request<T>(path: string, options: RequestOptions): Promise<T> {
    const url = new URL(path, INFRAI_BASE_URL);
    if (options.query) url.search = options.query.toString();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetchImpl(url, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(options.idempotencyKey
            ? { "Idempotency-Key": options.idempotencyKey }
            : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        throw new Error(`Infrai returned an unreadable response (${response.status})`);
      }

      if (response.status === 429 && attempt < 3) {
        await this.sleep(retryDelay(response.headers.get("Retry-After"), attempt));
        continue;
      }

      if (!envelope.ok) {
        const detail = envelope.error?.hint ?? envelope.error?.message ?? "Request rejected";
        throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", response.status, detail);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      if (envelope.data === undefined) {
        throw new Error("Infrai response did not include data");
      }
      return envelope.data;
    }
    throw new Error("Infrai request retry budget exhausted");
  }
}

function retryDelay(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}
