import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { transformSync } from "esbuild";

const adapterSource = readFileSync(resolve("src/enrichment/obsidian-adapter.ts"), "utf8");

test("owned body writes rebind a refreshed inode and TFile before frontmatter", async () => {
  const harness = createAdapterHarness();
  const services = harness.createServices();
  const original = await services.resolveMarkdown("Inbox/target.md");
  assert.ok(original);

  const rebound = await services.process(original, (current) => `${current}\nManaged links\n`);

  assert.notEqual(rebound, original);
  assert.equal(await services.validate(original), false);
  assert.equal(await services.validate(rebound), true);
  assert.equal(await services.read(rebound), "# Target\n\nManaged links\n");
  await services.processFrontMatter(rebound, (frontmatter) => {
    frontmatter.omd_home_status = "reviewed";
  });
  assert.deepEqual(harness.frontmatter, { omd_home_status: "reviewed" });
  assert.equal(harness.processCalls, 1);
});

test("an external identity change before Apply remains a conflict", async () => {
  const harness = createAdapterHarness();
  const services = harness.createServices();
  const bound = await services.resolveMarkdown("Inbox/target.md");
  assert.ok(bound);
  harness.replaceIdentity();

  await assert.rejects(
    () => services.process(bound, (current) => `${current}\nShould not write\n`),
    (error: unknown) => error instanceof Error
      && "code" in error
      && (error as { code?: unknown }).code === "note_conflict",
  );
  assert.equal(harness.content, "# Target\n");
  assert.equal(harness.processCalls, 0);
});

type FileRef = object;

interface AdapterServices {
  resolveMarkdown(path: string): Promise<FileRef | null>;
  validate(file: FileRef): Promise<boolean>;
  read(file: FileRef): Promise<string>;
  process(file: FileRef, update: (current: string) => string): Promise<FileRef>;
  processFrontMatter(file: FileRef, update: (frontmatter: Record<string, unknown>) => void): Promise<void>;
}

function createAdapterHarness(): {
  createServices(): AdapterServices;
  replaceIdentity(): void;
  readonly content: string;
  readonly frontmatter: Record<string, unknown>;
  readonly processCalls: number;
} {
  class FakeFileSystemAdapter {
    getBasePath(): string { return "/vault"; }
  }
  class FakeTFile {
    readonly path: string;
    readonly basename: string;

    constructor(path: string, basename: string) {
      this.path = path;
      this.basename = basename;
    }
  }
  class FakeOmdEnrichmentError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }

  let inode = 41;
  let currentFile = new FakeTFile("Inbox/target.md", "target");
  let content = "# Target\n";
  let frontmatter: Record<string, unknown> = {};
  let processCalls = 0;
  const replaceIdentity = (): void => {
    inode += 1;
    currentFile = new FakeTFile("Inbox/target.md", "target");
  };

  const app = {
    vault: {
      adapter: new FakeFileSystemAdapter(),
      getFileByPath(path: string) {
        return path === currentFile.path ? currentFile : null;
      },
      async read(file: InstanceType<typeof FakeTFile>) {
        assert.equal(file, currentFile);
        return content;
      },
      async process(file: InstanceType<typeof FakeTFile>, update: (current: string) => string) {
        assert.equal(file, currentFile);
        processCalls += 1;
        content = update(content);
        replaceIdentity();
      },
    },
    fileManager: {
      async processFrontMatter(
        file: InstanceType<typeof FakeTFile>,
        update: (value: Record<string, unknown>) => void,
      ) {
        assert.equal(file, currentFile);
        const next = structuredClone(frontmatter);
        update(next);
        frontmatter = next;
      },
      generateMarkdownLink() {
        return "[[Target]]";
      },
    },
  };

  const compiled = transformSync(adapterSource, {
    loader: "ts",
    format: "cjs",
    target: "es2022",
  }).code;
  const module = { exports: {} as Record<string, unknown> };
  const localRequire = (specifier: string): unknown => {
    if (specifier === "obsidian") return { FileSystemAdapter: FakeFileSystemAdapter, TFile: FakeTFile };
    if (specifier === "./errors.ts") return { OmdEnrichmentError: FakeOmdEnrichmentError };
    if (specifier === "./path-safety.ts") {
      return {
        normalizeRelativeMarkdownPath(path: string) {
          return path === "Inbox/target.md" ? path : null;
        },
        async inspectVaultRelativeMarkdownPath(vaultRoot: string, path: string) {
          return {
            ok: true,
            normalizedPath: path,
            absolutePath: `${vaultRoot}/${path}`,
            device: 7,
            inode,
            reason: null,
          };
        },
      };
    }
    throw new Error(`Unexpected adapter dependency: ${specifier}`);
  };
  new Function("require", "module", "exports", compiled)(localRequire, module, module.exports);
  const exports = module.exports as {
    createObsidianApplyServices(app: unknown, vaultRoot: string): AdapterServices;
  };

  return {
    createServices: () => exports.createObsidianApplyServices(app, "/vault"),
    replaceIdentity,
    get content() { return content; },
    get frontmatter() { return frontmatter; },
    get processCalls() { return processCalls; },
  };
}
