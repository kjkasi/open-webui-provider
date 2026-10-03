import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as {
  name: string;
  scripts: Record<string, string>;
  pi: { extensions: string[] };
};
const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");

describe("package contract", () => {
  test("declares the Git-installable Pi package manifest and development scripts", () => {
    expect(packageJson.name).toBe("pi-open-webui-provider");
    expect(packageJson.pi.extensions).toEqual(["./src/extension.ts"]);
    expect(packageJson.scripts.test).toBe("vitest --run");
    expect(packageJson.scripts.typecheck).toBe("tsc --noEmit");
    expect(packageJson).not.toHaveProperty("keywords");
    expect(packageJson).not.toHaveProperty("files");
    expect(existsSync(fileURLToPath(new URL("../package-lock.json", import.meta.url)))).toBe(false);
  });

  test("documents setup, refresh behavior, scope, and credential safety", () => {
    for (const requiredText of [
      "pi install git:github.com/kjkasi/open-webui-provider",
      "/login open-webui",
      "Open WebUI base URL",
      "Open WebUI API token",
      "OPEN_WEBUI_BASE_URL",
      "OPEN_WEBUI_API_KEY",
      "do not append `/api`",
      "/model",
      "/reload",
      "zero cost",
      "does not persist",
      "does not log",
    ]) {
      expect(readme).toContain(requiredText);
    }
    expect(readme).not.toContain("pi install npm:pi-open-webui-provider");
    for (const troubleshootingText of [
      "401/403",
      "404:",
      "429:",
      "5xx:",
      "Connection or HTTPS errors",
      "Diagnostics never include the API token.",
    ]) {
      expect(readme).toContain(troubleshootingText);
    }
  });
});
