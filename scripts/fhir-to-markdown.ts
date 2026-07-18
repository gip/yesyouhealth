#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

import { fhirToMarkdown } from "../lib/fhir-markdown";

const gunzipAsync = promisify(gunzip);

interface CliOptions {
  input: string;
  output: string;
  title?: string;
}

function usage(): string {
  return [
    "Convert FHIR JSON into a concise longitudinal Markdown record.",
    "",
    "Usage:",
    "  pnpm fhir:markdown -- <input.json|input.json.gz|-> [output.md]",
    "  pnpm fhir:markdown -- --input <input.json|input.json.gz|-> --output <output.md> [--title <title>]",
    "",
    'Use "-" as the input path to read JSON from standard input.',
  ].join("\n");
}

function defaultOutput(input: string): string {
  if (input === "-") return "fhir-summary.md";
  if (input.toLocaleLowerCase().endsWith(".json.gz")) {
    return join(dirname(input), `${basename(input).slice(0, -".json.gz".length)}.md`);
  }
  const extension = extname(input);
  const stem = basename(input, extension);
  return join(dirname(input), `${stem}.md`);
}

function parseArguments(args: string[]): CliOptions {
  let input: string | undefined;
  let output: string | undefined;
  let title: string | undefined;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (argument === "--input" || argument === "-i") {
      input = args[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--output" || argument === "-o") {
      output = args[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--title") {
      title = args[index + 1];
      index += 1;
      continue;
    }
    if (argument?.startsWith("-") && argument !== "-") {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (argument) positional.push(argument);
  }

  input ??= positional[0];
  output ??= positional[1];
  if (!input) throw new Error("An input JSON path is required.");
  if (positional.length > 2) throw new Error("Too many positional arguments.");

  return {
    input,
    output: output ?? defaultOutput(input),
    ...(title ? { title } : {}),
  };
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readInput(input: string): Promise<string> {
  const bytes = input === "-" ? await readStdin() : await readFile(input);
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return bytes.toString("utf8");
  try {
    return (await gunzipAsync(bytes)).toString("utf8");
  } catch (error) {
    throw new Error(
      `Could not decompress FHIR JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const source = await readInput(options.input);
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Could not parse FHIR JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const markdown = fhirToMarkdown(input, options.title ? { title: options.title } : {});
  await writeFile(options.output, markdown, "utf8");
  process.stdout.write(`Wrote ${options.output}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
