const sensitiveEnvValue = (name) => /KEY|SECRET|PASSWORD|TOKEN|URL/i.test(name);

export function safeExternalMessage(value) {
  if (typeof value !== "string") return undefined;
  let message = value;
  for (const [name, secret] of Object.entries(process.env)) {
    if (sensitiveEnvValue(name) && secret && secret.length >= 4) message = message.split(secret).join("[REDACTED]");
  }
  message = message.replace(/https?:\/\/[^\s"'<>]+/gi, (value) => {
    try { return new URL(value).origin; } catch { return "[REDACTED_URL]"; }
  });
  return message.replace(/\b(Bearer\s+)\S+/gi, "$1[REDACTED]").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) || undefined;
}

export function withExternalContext(error, service, operation) {
  const wrapped = new Error(`${service} ${operation} request failed`, { cause: error });
  wrapped.externalService = service;
  wrapped.externalOperation = operation;
  return wrapped;
}

export function externalErrorDetails(error) {
  const causes = [];
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1, current = current.cause) {
    causes.push({
      name: typeof current.name === "string" ? current.name.slice(0, 80) : "Error",
      ...(typeof current.code === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(current.code) ? { code: current.code } : {}),
      ...(typeof current.syscall === "string" ? { syscall: current.syscall.slice(0, 80) } : {}),
      ...(typeof current.hostname === "string" ? { hostname: current.hostname.slice(0, 180) } : {}),
      ...(typeof current.$metadata?.httpStatusCode === "number" ? { httpStatus: current.$metadata.httpStatusCode } : {}),
      ...(safeExternalMessage(current.message) ? { message: safeExternalMessage(current.message) } : {}),
    });
  }
  return {
    ...(error?.externalService ? { externalService: error.externalService } : {}),
    ...(error?.externalOperation ? { externalOperation: error.externalOperation } : {}),
    causes,
  };
}
