import fs from "fs";
import { PDFParse } from "pdf-parse";

async function extractText(file) {
  const parser = new PDFParse({ data: fs.readFileSync(file) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

function parseDocumentControl(text) {
  const start = text.indexOf("Field");
  if (start < 0) return [];
  const slice = text.slice(start);
  const endIdx = slice.search(
    /Revision History|Important Notice|TABLE OF CONTENTS|This Schedule A forms|This Schedule D forms|1\. PURPOSE|1\. Definitions/i
  );
  const block = endIdx > 0 ? slice.slice(0, endIdx) : slice.slice(0, 1200);
  const rows = [];
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || /^Field\s/i.test(trimmed) || trimmed === "Value") continue;
    const tabParts = trimmed.split(/\t+/);
    if (tabParts.length >= 2) {
      rows.push({ field: tabParts[0].trim(), value: tabParts.slice(1).join(" ").trim() });
    }
  }
  return rows;
}

function parseRevisionHistory(text) {
  const m = text.match(/Revision History[\s\S]*?Version\s+Date\s+Changes\s*\n([\s\S]*?)(?:Confidential|Important Notice)/i);
  if (!m) return [];
  const rows = [];
  for (const line of m[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes("--")) continue;
    const tabParts = trimmed.split(/\t+/);
    if (tabParts.length >= 3) {
      rows.push({ version: tabParts[0], date: tabParts[1], changes: tabParts.slice(2).join(" ") });
    } else {
      const match = trimmed.match(/^(\d+\.\d+)\s+(.+?)\s{2,}(.+)$/);
      if (match) rows.push({ version: match[1], date: match[2], changes: match[3] });
    }
  }
  return rows;
}

function stripArtifacts(text) {
  return text
    .replace(/PREP SERVICES FBA LLC \| Master Service Agreement \| Version [\d.]+/g, "")
    .replace(/Confidential Client Agreement \| \d+ of \d+/g, "")
    .replace(/-- \d+ of \d+ --/g, "")
    .replace(/\n\d+\n(?=\n--)/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseTopLevelSections(text, fromMarker) {
  const cleaned = stripArtifacts(text);
  let idx = cleaned.search(fromMarker);
  const bodyStart = cleaned.search(/\n1\. Definitions\n1\.1\s/i);
  if (bodyStart >= 0) idx = bodyStart;
  else if (idx < 0) idx = 0;
  const body = cleaned.slice(idx);
  const regex = /(?:^|\n)(\d+)\.\s+([A-Z][^\n]+)\n/g;
  const matches = [...body.matchAll(regex)];
  const byNum = new Map();
  for (let i = 0; i < matches.length; i++) {
    const num = matches[i][1];
    const title = matches[i][2].trim();
    if (title.length > 100) continue;
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
    let sectionBody = body.slice(start, end).trim();
    sectionBody = sectionBody
      .replace(/Prep Services FBA LLC[\s\S]*Document: Schedule[\s\S]*$/i, "")
      .replace(/Version\s+Date\s+Changes[\s\S]*$/i, "")
      .trim();
    const entry = { title: `${num}. ${title}`, body: sectionBody };
    const existing = byNum.get(num);
    if (!existing || sectionBody.length > existing.body.length) byNum.set(num, entry);
  }
  return [...byNum.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, v]) => v)
    .filter((s) => s.body.length > 20);
}

function between(text, startRe, endRe) {
  const m = text.match(new RegExp(`${startRe.source}([\\s\\S]*?)${endRe.source}`, "i"));
  return m ? m[1].trim() : "";
}

const msaText = await extractText("public/Prep_Services_FBA_Master_Service_Agreement_v1_Final.pdf");
const termsText = await extractText("public/SCHEDULE A - PRICING _ COMMERCIAL TERMS.pdf");
const privacyText = await extractText(
  "public/SCHEDULE D - PRIVACY, DATA PROCESSING _ INFORMATION SECURITY POLICY.pdf"
);

const out = {
  msa: {
    headerLine: "PREP SERVICES FBA LLC | Master Service Agreement",
    showDocumentControlHeading: true,
    coverTitle: "MASTER SERVICE AGREEMENT",
    coverSubtitle: "Enterprise Client Agreement for Warehouse Services and PrepCorex WMS",
    documentControl: parseDocumentControl(msaText),
    revisionHistory: parseRevisionHistory(msaText),
    preamble: between(msaText, /Important Notice\s*/i, /Table of Contents/i),
    tableOfContents: between(msaText, /Table of Contents\s*/i, /1\. Definitions/i),
    sections: parseTopLevelSections(msaText, /1\. Definitions/),
    footerLine: "Confidential Client Agreement",
  },
  terms: {
    headerLine: "SCHEDULE A - PRICING & COMMERCIAL TERMS",
    showDocumentControlHeading: false,
    coverSubtitle: "Master Service Agreement Schedule A",
    documentControl: parseDocumentControl(termsText),
    intro: between(termsText, /Status\s+Active\s*/i, /1\. PURPOSE/i),
    sections: parseTopLevelSections(termsText, /1\. PURPOSE/),
    footerLine: "Schedule A – Pricing & Commercial Terms",
  },
  privacy: {
    headerLine: "SCHEDULE D - PRIVACY, DATA PROCESSING & INFORMATION SECURITY POLICY",
    showDocumentControlHeading: false,
    coverSubtitle: "Master Service Agreement – Schedule D",
    documentControl: parseDocumentControl(privacyText),
    intro: between(privacyText, /Status\s+Active\s*/i, /TABLE OF CONTENTS/i),
    tableOfContents: between(privacyText, /TABLE OF CONTENTS\s*/i, /1\. PURPOSE/i),
    sections: parseTopLevelSections(privacyText, /1\. PURPOSE/),
    footerLine: "Schedule D – Privacy, Data Processing & Information Security Policy",
  },
};

console.log("MSA", out.msa.sections.length, "rows", out.msa.documentControl.length);
console.log("Terms", out.terms.sections.length);
console.log("Privacy", out.privacy.sections.length);

fs.writeFileSync("src/lib/platform-documents-pdf-content.json", JSON.stringify(out, null, 2));
