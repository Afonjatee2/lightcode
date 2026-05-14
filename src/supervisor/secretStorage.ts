import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import type { SharedSettings } from "@/shared/settings";

const SECRET_PREFIX = "lc-safe:v1:";

let configuredSecretKey: Buffer | undefined;
let testFallbackSecretKey: Buffer | undefined;

export function configureSecretStorageKey(rawKey: string | undefined): void {
  if (!rawKey) return;
  const key = Buffer.from(rawKey, "base64");
  if (key.length !== 32) {
    throw new Error("Invalid Lightcode secret key.");
  }
  configuredSecretKey = key;
}

function readSecretKey(): Buffer {
  if (configuredSecretKey) return configuredSecretKey;
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    testFallbackSecretKey ??= randomBytes(32);
    return testFallbackSecretKey;
  }
  throw new Error("Lightcode secret storage key is not initialized.");
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(SECRET_PREFIX);
}

export function encryptSecret(_baseDir: string, value: string): string {
  if (isEncryptedSecret(value)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", readSecretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SECRET_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(_baseDir: string, value: string): string {
  if (!isEncryptedSecret(value)) return value;
  const [ivPart, tagPart, ciphertextPart] = value.slice(SECRET_PREFIX.length).split(":");
  if (!ivPart || !tagPart || !ciphertextPart) {
    throw new Error("Invalid encrypted secret");
  }
  const decipher = createDecipheriv("aes-256-gcm", readSecretKey(), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function transformSensitiveAgentSecrets(
  settings: SharedSettings,
  baseDir: string,
  transform: (baseDir: string, value: string) => string,
): SharedSettings {
  let changed = false;
  const agentInstances = { ...settings.agentInstances };

  for (const [instanceId, instance] of Object.entries(settings.agentInstances)) {
    if (!instance.environment) continue;
    let environmentChanged = false;
    const environment = { ...instance.environment };
    for (const [name, variable] of Object.entries(instance.environment)) {
      if (variable.sensitive !== true) continue;
      environment[name] = { ...variable, value: transform(baseDir, variable.value) };
      environmentChanged = true;
    }
    if (!environmentChanged) continue;
    agentInstances[instanceId] = { ...instance, environment };
    changed = true;
  }

  return changed ? { ...settings, agentInstances } : settings;
}
