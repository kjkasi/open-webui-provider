import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as {
  name: string;
  files: string[];
  scripts: Record<string, string>;
  pi: { extensions: string[] };
};
const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");

describe("package contract", () => {
  test("declares conventional Pi package discovery and release files", () => {
    expect(packageJson.name).toBe("pi-open-webui-provider");
    expect(packageJson.pi.extensions).toEqual(["./src/extension.ts"]);
    expect(packageJson.files).toEqual(["src", "README.md"]);
    expect(packageJson.scripts.test).toBe("vitest --run");
    expect(packageJson.scripts.typecheck).toBe("tsc --noEmit");
  });

  test("documents setup, refresh behavior, scope, and credential safety", () => {
    for (const requiredText of [
      "pi install npm:pi-open-webui-provider",
      "/login open-webui",
      "Open WebUI base URL",
      "Open WebUI API token",
      "/model",
      "/reload",
      "zero cost",
      "does not persist",
      "does not log",
    ]) {
      expect(readme).toContain(requiredText);
    }
    expect(readme).not.toContain("OPEN_WEBUI_BASE_URL");
    expect(readme).not.toContain("OPEN_WEBUI_API_KEY");
  });
});
