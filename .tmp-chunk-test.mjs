import { readFileSync } from "node:fs";

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const interactiveFooterPatterns = [
  /press enter to continue/i,
  /press enter to confirm/i,
  /select an option/i,
  /use (?:the )?(?:up and down )?arrow keys/i,
];
const numberedOptionPattern = /^\s*(?:[>›❯]\s*)?(\d+)\.\s+(.+?)\s*$/;

function stripAnsi(value) {
  return value.replace(ANSI_PATTERN, "");
}
function takeTail(value, maxLength) {
  return value.length <= maxLength ? value : value.slice(value.length - maxLength);
}

function derive(text) {
  const lines = stripAnsi(text)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd());
  for (let footerIndex = lines.length - 1; footerIndex >= 0; footerIndex -= 1) {
    const footerLine = lines[footerIndex]?.trim();
    if (!footerLine || !interactiveFooterPatterns.some((p) => p.test(footerLine))) continue;
    const options = [];
    let optionLineIndex = footerIndex - 1;
    while (optionLineIndex >= 0 && !lines[optionLineIndex]?.trim()) optionLineIndex -= 1;
    for (let lineIndex = optionLineIndex; lineIndex >= 0; lineIndex -= 1) {
      const line = lines[lineIndex];
      if (!line?.trim()) break;
      const match = numberedOptionPattern.exec(line);
      if (!match) break;
      options.unshift({ id: Number(match[1]), label: match[2].trim(), lineIndex });
    }
    if (options.length < 2 || !options.every((o, i) => o.id === i + 1)) continue;
    const promptLines = [];
    let li = options[0].lineIndex - 1;
    while (li >= 0 && !lines[li]?.trim()) li -= 1;
    for (; li >= 0; li -= 1) {
      const line = lines[li]?.trim();
      if (!line) break;
      promptLines.unshift(line);
    }
    const prompt = promptLines.join(" ").trim();
    if (!prompt) continue;
    return { prompt, options: options.map((o) => ({ id: String(o.id), label: o.label })) };
  }
  return undefined;
}

const raw = readFileSync(process.argv[2], "utf8");

// Method 1: full-file strip (what the debug script does)
const method1 = takeTail(stripAnsi(raw), 10000);

// Method 2: simulate per-chunk accumulation (what runtime does)
// Try multiple chunk sizes to find any that break
const chunkSizeTests = [50, 100, 150, 200, 300, 500, 1000];
for (const chunkSize of chunkSizeTests) {
  let recentText = "";
  let pos = 0;
  while (pos < raw.length) {
    const chunk = raw.slice(pos, pos + chunkSize);
    recentText = takeTail(recentText + stripAnsi(chunk), 10000);
    pos += chunkSize;
  }
  const hint = derive(recentText);
  console.log(`chunkSize=${chunkSize}: len=${recentText.length}, detected=${!!hint}`);
  if (!hint) {
    // Show what the end of recentText looks like
    const tail = recentText.slice(-400).replace(/\r/g, "<CR>").replace(/\n/g, "<NL>\n");
    console.log("  TAIL:", tail);
  }
}

// Also test with the full-file approach
const hintFull = derive(method1);
console.log(`full-file: len=${method1.length}, detected=${!!hintFull}`);

// Show difference between method1 and a per-chunk version
let method2 = "";
let pos = 0;
while (pos < raw.length) {
  const chunk = raw.slice(pos, pos + 100);
  method2 = takeTail(method2 + stripAnsi(chunk), 10000);
  pos += 100;
}
console.log("\nmethod1 === method2?", method1 === method2);
console.log("method1 length:", method1.length, "method2 length:", method2.length);
if (method1 !== method2) {
  let diffs = 0;
  for (let i = 0; i < Math.max(method1.length, method2.length); i++) {
    if (method1[i] !== method2[i]) {
      if (diffs < 3) {
        console.log(
          `  diff at ${i}: m1=${JSON.stringify(method1.slice(Math.max(0, i - 5), i + 15))} m2=${JSON.stringify(method2.slice(Math.max(0, i - 5), i + 15))}`,
        );
      }
      diffs++;
    }
  }
  console.log(`  total diffs: ${diffs}`);
}
