import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJsonPath = path.resolve(__dirname, "../package.json");
const versionFilePath = path.resolve(__dirname, "../src/version.ts");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
const version = packageJson.version;

const content = `// This file is auto-generated. Do not edit manually.
export const CLAWBR_SOCIAL_VERSION = "${version}";
`;

fs.writeFileSync(versionFilePath, content);
console.log(`Updated version to ${version} in src/version.ts`);
