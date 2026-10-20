import "server-only";

/** Environment variables as supplied by the host, e.g. `process.env`. */
export type EnvRecord = Readonly<Record<string, string | undefined>>;

/** A validation problem. Names the variable only; never carries its value (D-37). */
export interface ConfigIssue {
  readonly variable: string;
  readonly message: string;
}

export type AppEnv = "local" | "test" | "development" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type AiProvider = "soc_llm" | "fake";

/** The D-28 core set. Readiness requires it to be valid. */
export interface CoreConfig {
  readonly appEnv: AppEnv;
  readonly publicAppUrl: string;
  readonly database: {
    readonly url: string;
    /** `null` only in local/test with a loopback database (D-30). */
    readonly caCert: string | null;
  };
  readonly sessionSecret: string;
  readonly rateLimitKeySecret: string;
  readonly sessionTtlSeconds: number;
  readonly reportSuspensionThreshold: number;
}

export type CoreConfigResult =
  | { readonly valid: true; readonly value: CoreConfig }
  | { readonly valid: false; readonly issues: readonly ConfigIssue[] };

/** When disabled, both cron routes reject every request with 401 (D-28). */
export type CronConfig =
  | { readonly enabled: true; readonly secret: string }
  | { readonly enabled: false; readonly issues: readonly ConfigIssue[] };

export type AdminBootstrapConfig =
  | { readonly enabled: true; readonly secret: string; readonly email: string; readonly password: string }
  | { readonly enabled: false; readonly issues: readonly ConfigIssue[] };

export interface AiSettings {
  readonly provider: AiProvider;
  readonly soc: {
    /** HTTPS, without a trailing `/v1`; the adapter appends versioned paths. */
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly model: string;
  };
  readonly quotas: {
    readonly requestsPerMinute: number;
  };
  readonly budget: {
    readonly dailyMicrodollars: number;
    readonly inputPriceMicrodollarsPerMTok: number;
    readonly outputPriceMicrodollarsPerMTok: number;
  };
  readonly execution: {
    readonly maxConcurrentRequests: number;
    readonly attemptTimeoutMs: number;
    readonly maxAttempts: number;
    readonly executionDeadlineMs: number;
    readonly inputTokenLimit: number;
  };
  readonly summaries: {
    readonly sampleSize: number;
    readonly intervalDays: number;
    readonly maxMoviesPerRun: number;
  };
  readonly moderation: {
    readonly maxExecutions: number;
    readonly recoveryMaxReviews: number;
  };
}

/** AI is enabled only when AI_ENABLED=true and every AI variable is valid; it never affects core (D-28). */
export type AiConfig =
  | { readonly enabled: true; readonly value: AiSettings }
  | { readonly enabled: false; readonly issues: readonly ConfigIssue[] };

export interface AppConfig {
  readonly core: CoreConfigResult;
  readonly cron: CronConfig;
  readonly bootstrap: AdminBootstrapConfig;
  readonly ai: AiConfig;
  readonly logLevel: LogLevel;
}
