import { context, trace, SpanStatusCode, type Attributes, type Context, type Span } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

function parseBoolean(raw: string | undefined): boolean {
  const normalized = (raw ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseOptionalNumber(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function sanitizeAttributes(input: Attributes | undefined): Attributes {
  if (!input) {
    return {};
  }
  const output: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (value == null) {
      continue;
    }
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      output[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      const normalized = value.filter(
        (entry): entry is string | number | boolean =>
          typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean'
      );
      if (normalized.length > 0) {
        output[key] = normalized.map((entry) => String(entry));
      }
      continue;
    }
    output[key] = String(value);
  }
  return output;
}

export interface ManagedTelemetrySpan {
  readonly context: Context | undefined;
  setAttribute(key: string, value: string | number | boolean | undefined): void;
  addEvent(name: string, attributes?: Attributes): void;
  endSuccess(): void;
  endError(error: unknown): void;
}

class NoopManagedTelemetrySpan implements ManagedTelemetrySpan {
  readonly context = undefined;

  setAttribute(): void {
    // no-op
  }

  addEvent(): void {
    // no-op
  }

  endSuccess(): void {
    // no-op
  }

  endError(): void {
    // no-op
  }
}

class OTelManagedTelemetrySpan implements ManagedTelemetrySpan {
  private ended = false;

  readonly context: Context;

  constructor(private readonly span: Span, parentContext: Context | undefined) {
    this.context = trace.setSpan(parentContext ?? context.active(), span);
  }

  setAttribute(key: string, value: string | number | boolean | undefined): void {
    if (this.ended || value == null) {
      return;
    }
    this.span.setAttribute(key, value);
  }

  addEvent(name: string, attributes?: Attributes): void {
    if (this.ended) {
      return;
    }
    this.span.addEvent(name, sanitizeAttributes(attributes));
  }

  endSuccess(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.span.setStatus({
      code: SpanStatusCode.OK
    });
    this.span.end();
  }

  endError(error: unknown): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    if (error instanceof Error) {
      this.span.recordException(error);
      this.span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      });
    } else {
      this.span.recordException({
        message: String(error)
      });
      this.span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(error)
      });
    }
    this.span.end();
  }
}

export interface LangfuseTelemetry {
  readonly enabled: boolean;
  readonly initWarning?: string;
  startSpan(name: string, attributes?: Attributes, parentContext?: Context): ManagedTelemetrySpan;
  flush(): Promise<void>;
}

class NoopLangfuseTelemetry implements LangfuseTelemetry {
  constructor(public readonly initWarning?: string) {}

  readonly enabled = false;

  startSpan(): ManagedTelemetrySpan {
    return new NoopManagedTelemetrySpan();
  }

  async flush(): Promise<void> {
    // no-op
  }
}

class OTelLangfuseTelemetry implements LangfuseTelemetry {
  readonly enabled = true;

  private readonly tracer = trace.getTracer('web-agentic-codex.runtime', '0.1.0');

  constructor(private readonly spanProcessor: LangfuseSpanProcessor) {}

  startSpan(name: string, attributes?: Attributes, parentContext?: Context): ManagedTelemetrySpan {
    const span = this.tracer.startSpan(name, {
      attributes: sanitizeAttributes(attributes)
    }, parentContext ?? context.active());
    return new OTelManagedTelemetrySpan(span, parentContext);
  }

  async flush(): Promise<void> {
    await this.spanProcessor.forceFlush();
  }
}

let singleton: LangfuseTelemetry | undefined;

function createTelemetryFromEnv(): LangfuseTelemetry {
  if (!parseBoolean(process.env.LANGFUSE_ENABLED)) {
    return new NoopLangfuseTelemetry();
  }

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) {
    return new NoopLangfuseTelemetry(
      'LANGFUSE_ENABLED=1 but LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY is missing'
    );
  }

  const baseUrl = process.env.LANGFUSE_BASE_URL?.trim();
  const timeoutSeconds = parseOptionalNumber(process.env.LANGFUSE_TIMEOUT_SECONDS);

  try {
    const spanProcessor = new LangfuseSpanProcessor({
      publicKey,
      secretKey,
      baseUrl: baseUrl && baseUrl.length > 0 ? baseUrl : undefined,
      timeout: timeoutSeconds && timeoutSeconds > 0 ? timeoutSeconds : undefined,
      environment: process.env.LANGFUSE_ENV?.trim() || process.env.NODE_ENV || 'development',
      release: process.env.LANGFUSE_RELEASE?.trim() || undefined
    });
    const provider = new NodeTracerProvider({
      spanProcessors: [spanProcessor]
    });
    provider.register();
    return new OTelLangfuseTelemetry(spanProcessor);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new NoopLangfuseTelemetry(`Langfuse initialization failed: ${message}`);
  }
}

export function getLangfuseTelemetry(): LangfuseTelemetry {
  if (!singleton) {
    singleton = createTelemetryFromEnv();
  }
  return singleton;
}

export function __resetLangfuseTelemetryForTests(): void {
  singleton = undefined;
}
