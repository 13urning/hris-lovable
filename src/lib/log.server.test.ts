// Emitter and label-parsing tests. Complements log-redact.test.ts: that file
// proves WHAT may be written, this one proves the record is well-formed, the
// trace correlation works, and — most importantly — that nothing in the logging
// path can take down a request.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  logError,
  logInfo,
  logWarn,
  parseTraceContext,
  runWithRequestContext,
  setRequestActor,
} from "@/lib/log.server";
import { serverFnLabel } from "@/lib/observability-middleware";

const EMP_UUID = "a3f1e2d4-5b6c-4890-9234-567890123456";

// Capture what the emitter writes to stdout without letting it reach the
// terminal, then parse it back as the JSON Cloud Logging would receive.
function captureRecords(fn: () => void): Record<string, unknown>[] {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
}

afterEach(() => vi.restoreAllMocks());

describe("record shape", () => {
  it("emits one line of valid JSON with a Cloud Logging severity", () => {
    const [rec] = captureRecords(() => logInfo("server_fn", { serverFn: "fileLeaveRequest" }));
    expect(rec.severity).toBe("INFO");
    expect(rec.message).toBe("server_fn");
    expect(rec.serverFn).toBe("fileLeaveRequest");
  });

  it("labels every record with env and service for alert filtering", () => {
    const [rec] = captureRecords(() => logWarn("something"));
    const labels = rec["logging.googleapis.com/labels"] as Record<string, string>;
    expect(labels.env).toBeTruthy();
    expect(labels.service).toBeTruthy();
  });

  it("attaches the Error Reporting @type on ERROR so new signatures notify", () => {
    const [rec] = captureRecords(() => logError("server_fn_failed", new Error("boom")));
    expect(rec["@type"]).toBe(
      "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent",
    );
    // Error Reporting reads the stack out of `message`.
    expect(String(rec.message)).toContain("boom");
  });

  it("does NOT attach @type on INFO — routine traffic is not an incident", () => {
    const [rec] = captureRecords(() => logInfo("server_fn"));
    expect(rec["@type"]).toBeUndefined();
  });

  it("carries the SQLSTATE that was missing on 23 July", () => {
    const err = new Error("could not determine data type of parameter $5") as Error &
      Record<string, unknown>;
    err.code = "42P08";
    const [rec] = captureRecords(() => logError("server_fn_failed", err));
    expect((rec.err as { code?: string }).code).toBe("42P08");
  });
});

describe("trace correlation", () => {
  it("parses the Cloud Run trace header", () => {
    const ctx = parseTraceContext("105445aa7843bc8bf206b12000100000/1;o=1");
    expect(ctx.traceId).toBe("105445aa7843bc8bf206b12000100000");
    expect(ctx.spanId).toBe("0000000000000001");
  });

  it("shrugs off a malformed or absent header", () => {
    expect(parseTraceContext(null)).toEqual({});
    expect(parseTraceContext("")).toEqual({});
    expect(parseTraceContext("garbage")).toEqual({});
    expect(parseTraceContext("../../etc/passwd")).toEqual({});
  });

  it("stamps the trace on records emitted inside the request scope", () => {
    const recs = captureRecords(() =>
      runWithRequestContext({ traceId: "105445aa7843bc8bf206b12000100000" }, () => {
        logInfo("a");
        logInfo("b");
      }),
    );
    const traces = recs.map((r) => r["logging.googleapis.com/trace"]);
    expect(new Set(traces).size).toBe(1);
    expect(String(traces[0])).toContain("/traces/105445aa7843bc8bf206b12000100000");
  });

  it("inherits the actor set by the auth middleware, as UUIDs only", () => {
    const [rec] = captureRecords(() =>
      runWithRequestContext({}, () => {
        setRequestActor(EMP_UUID, "kQ7xFirebaseUid");
        logInfo("server_fn", { serverFn: "fetchMyLeaves" });
      }),
    );
    expect(rec.actor).toEqual({ dbUserId: EMP_UUID, firebaseUid: "kQ7xFirebaseUid" });
  });

  it("does not leak an actor across request scopes", () => {
    const recs = captureRecords(() => {
      runWithRequestContext({}, () => {
        setRequestActor(EMP_UUID, "uid-1");
        logInfo("first");
      });
      runWithRequestContext({}, () => logInfo("second"));
    });
    expect(recs[0].actor).toBeDefined();
    expect(recs[1].actor).toBeUndefined();
  });
});

describe("fail-open — verification item 6", () => {
  it("never throws when stdout rejects the write", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => {
      throw new Error("EPIPE");
    });
    expect(() => logError("boom", new Error("x"))).not.toThrow();
    expect(() => logInfo("fine")).not.toThrow();
    spy.mockRestore();
  });

  it("never throws on a hostile error object", () => {
    const hostile = {
      get stack() {
        throw new Error("nope");
      },
    };
    let rec: Record<string, unknown> | undefined;
    expect(() => {
      [rec] = captureRecords(() => logError("server_fn_failed", hostile));
    }).not.toThrow();
    // Degraded to a placeholder — a line lost, not a request.
    expect((rec?.err as { message?: string }).message).toBe("[unserialisable]");
  });

  it("degrades a circular field rather than failing", () => {
    const circular: Record<string, unknown> = { serverFn: "x" };
    circular.self = circular;
    let rec: Record<string, unknown> | undefined;
    expect(() => {
      [rec] = captureRecords(() => logInfo("server_fn", circular));
    }).not.toThrow();
    expect(rec?.serverFn).toBe("x");
  });

  it("emits nothing dangerous when called outside a request scope", () => {
    const [rec] = captureRecords(() => logInfo("orphan"));
    expect(rec["logging.googleapis.com/trace"]).toBeUndefined();
    expect(rec.actor).toBeUndefined();
  });
});

describe("serverFnLabel — the per-function alert dimension", () => {
  it("extracts the readable function name from a TanStack server-fn id", () => {
    expect(
      serverFnLabel(
        "https://x.run.app/_serverFn/src_lib_leave-functions_ts--fileLeaveRequest_createServerFn_handler",
      ),
    ).toBe("fileLeaveRequest");
  });

  it("handles a URL-encoded id", () => {
    expect(serverFnLabel("https://x.run.app/_serverFn/plain%5Fid")).toBe("plain_id");
  });

  it("falls back to unknown rather than throwing", () => {
    expect(serverFnLabel("https://x.run.app/dashboard")).toBe("unknown");
    expect(serverFnLabel("not a url")).toBe("unknown");
    expect(serverFnLabel("")).toBe("unknown");
  });

  it("caps and sanitises the label so one bad request cannot inflate cardinality", () => {
    const nasty = `https://x.run.app/_serverFn/${"A".repeat(500)}`;
    const label = serverFnLabel(nasty);
    expect(label.length).toBeLessThanOrEqual(80);
    expect(label).toMatch(/^[A-Za-z0-9_.-]+$/);
  });
});
