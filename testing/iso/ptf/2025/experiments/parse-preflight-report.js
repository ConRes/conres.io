#!/usr/bin/env node
// @ts-check
/**
 * Parse Acrobat Preflight text reports
 *
 * All paths are resolved relative to CWD.
 * Run from: testing/iso/ptf/2025/experiments/
 *
 * Usage:
 *   node scripts/parse-preflight-report.js <report.txt>
 *   node scripts/parse-preflight-report.js <report1.txt> <report2.txt> --compare
 *   node scripts/parse-preflight-report.js <report.txt> --json
 *   node scripts/parse-preflight-report.js <report.txt> --summary
 */

// =============================================================================
// AGENT RESTRICTIONS - READ BEFORE MODIFYING
// =============================================================================
//
// This script uses CWD-RELATIVE path resolution.
// Paths passed as arguments are resolved relative to process.cwd().
//
// DO NOT add magic path resolution patterns.
// If paths don't work, you're running from the wrong directory.
//
// =============================================================================

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { readFile, writeFile } from 'fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// CLI Argument Parsing (Node.js parseArgs)
// ============================================================================

const { values: options, positionals } = parseArgs({
    // Filter out empty strings that may come from shell argument parsing edge cases
    args: process.argv.slice(2).filter(arg => arg.length > 0),
    allowPositionals: true,
    options: {
        'json': { type: 'boolean', default: false },
        'compare': { type: 'boolean', default: false },
        'help': { type: 'boolean', short: 'h', default: false },
    }
});

/**
 * @typedef {{
 *   filename: string,
 *   pages: string,
 *   profile: string,
 *   document: PreflightSection,
 *   pageIssues: Map<number, PreflightSection>,
 *   summary: PreflightSummary,
 * }} PreflightReport
 *
 * @typedef {{
 *   issues: PreflightIssue[],
 *   issueCount: number,
 * }} PreflightSection
 *
 * @typedef {{
 *   name: string,
 *   details: string[],
 *   count: number,
 * }} PreflightIssue
 *
 * @typedef {{
 *   totalIssues: number,
 *   documentIssues: number,
 *   pageIssues: number,
 *   issuesByType: Map<string, number>,
 *   pages: number[],
 * }} PreflightSummary
 */

/**
 * Parse a Preflight text report
 * @param {string} text - Report text content
 * @returns {PreflightReport}
 */
function parsePreflightReport(text) {
    const lines = text.split('\n');

    // Parse header
    const headerMatch = lines[0]?.match(/Pages\s+(\d+\s*-\s*\d+)\s+from\s+"([^"]+)"/);
    const filename = headerMatch?.[2] ?? 'unknown';
    const pages = headerMatch?.[1] ?? '?';

    // Find profile
    let profile = 'unknown';
    for (const line of lines) {
        const profileMatch = line.match(/Used profile:\s*"([^"]+)"/);
        if (profileMatch) {
            profile = profileMatch[1];
            break;
        }
    }

    // Parse sections
    /** @type {PreflightSection} */
    const documentSection = { issues: [], issueCount: 0 };
    /** @type {Map<number, PreflightSection>} */
    const pageIssues = new Map();

    let currentSection = 'none';
    let currentPage = 0;
    /** @type {PreflightIssue | null} */
    let currentIssue = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip empty lines
        if (!trimmed) continue;

        // Count leading tabs
        const tabCount = line.match(/^\t*/)?.[0]?.length ?? 0;

        // Check for section headers
        if (tabCount === 2 && trimmed === 'Document') {
            currentSection = 'document';
            currentIssue = null;
            continue;
        }

        const pageMatch = trimmed.match(/^Page:\s*(\d+)$/);
        if (tabCount === 2 && pageMatch) {
            currentSection = 'page';
            currentPage = parseInt(pageMatch[1], 10);
            if (!pageIssues.has(currentPage)) {
                pageIssues.set(currentPage, { issues: [], issueCount: 0 });
            }
            currentIssue = null;
            continue;
        }

        // Parse issues (tab level 3)
        if (tabCount === 3 && currentSection !== 'none') {
            // Save previous issue
            if (currentIssue) {
                if (currentSection === 'document') {
                    documentSection.issues.push(currentIssue);
                    documentSection.issueCount++;
                } else if (currentSection === 'page') {
                    const pageSection = pageIssues.get(currentPage);
                    if (pageSection) {
                        pageSection.issues.push(currentIssue);
                        pageSection.issueCount++;
                    }
                }
            }

            currentIssue = {
                name: trimmed,
                details: [],
                count: 1,
            };
            continue;
        }

        // Parse details (tab level 4+)
        if (tabCount >= 4 && currentIssue) {
            currentIssue.details.push(trimmed);
        }
    }

    // Save last issue
    if (currentIssue) {
        if (currentSection === 'document') {
            documentSection.issues.push(currentIssue);
            documentSection.issueCount++;
        } else if (currentSection === 'page') {
            const pageSection = pageIssues.get(currentPage);
            if (pageSection) {
                pageSection.issues.push(currentIssue);
                pageSection.issueCount++;
            }
        }
    }

    // Build summary
    /** @type {Map<string, number>} */
    const issuesByType = new Map();

    for (const issue of documentSection.issues) {
        issuesByType.set(issue.name, (issuesByType.get(issue.name) ?? 0) + 1);
    }

    let totalPageIssues = 0;
    const pageNumbers = [...pageIssues.keys()].sort((a, b) => a - b);

    for (const [, section] of pageIssues) {
        totalPageIssues += section.issueCount;
        for (const issue of section.issues) {
            issuesByType.set(issue.name, (issuesByType.get(issue.name) ?? 0) + 1);
        }
    }

    const summary = {
        totalIssues: documentSection.issueCount + totalPageIssues,
        documentIssues: documentSection.issueCount,
        pageIssues: totalPageIssues,
        issuesByType,
        pages: pageNumbers,
    };

    return {
        filename,
        pages,
        profile,
        document: documentSection,
        pageIssues,
        summary,
    };
}

/**
 * Format report as summary text
 * @param {PreflightReport} report
 * @returns {string}
 */
function formatSummary(report) {
    const lines = [];

    lines.push('═'.repeat(80));
    lines.push(`Preflight Report Summary: ${basename(report.filename)}`);
    lines.push('═'.repeat(80));
    lines.push('');
    lines.push(`Pages: ${report.pages}`);
    lines.push(`Profile: ${report.profile}`);
    lines.push('');
    lines.push('─ Issue Counts ─');
    lines.push(`  Total issues: ${report.summary.totalIssues}`);
    lines.push(`  Document-level: ${report.summary.documentIssues}`);
    lines.push(`  Page-level: ${report.summary.pageIssues}`);
    lines.push('');
    lines.push('─ Issues by Type (sorted by count) ─');

    // Sort by count descending
    const sortedIssues = [...report.summary.issuesByType.entries()]
        .sort((a, b) => b[1] - a[1]);

    for (const [name, count] of sortedIssues) {
        lines.push(`  ${count.toString().padStart(4)} × ${name}`);
    }

    lines.push('');
    lines.push('─ Per-Page Breakdown ─');

    for (const pageNum of report.summary.pages) {
        const pageSection = report.pageIssues.get(pageNum);
        if (pageSection) {
            lines.push(`  Page ${pageNum}: ${pageSection.issueCount} issues`);
        }
    }

    lines.push('');
    lines.push('═'.repeat(80));

    return lines.join('\n');
}

/**
 * Compare two reports and show differences
 * @param {PreflightReport} report1
 * @param {PreflightReport} report2
 * @returns {string}
 */
function compareReports(report1, report2) {
    const lines = [];

    lines.push('═'.repeat(80));
    lines.push('Preflight Report Comparison');
    lines.push('═'.repeat(80));
    lines.push('');
    lines.push(`Report A: ${basename(report1.filename)}`);
    lines.push(`Report B: ${basename(report2.filename)}`);
    lines.push('');

    // Compare totals
    lines.push('─ Issue Count Comparison ─');
    lines.push(`  Total:    A=${report1.summary.totalIssues}, B=${report2.summary.totalIssues}, Δ=${report2.summary.totalIssues - report1.summary.totalIssues}`);
    lines.push(`  Document: A=${report1.summary.documentIssues}, B=${report2.summary.documentIssues}, Δ=${report2.summary.documentIssues - report1.summary.documentIssues}`);
    lines.push(`  Pages:    A=${report1.summary.pageIssues}, B=${report2.summary.pageIssues}, Δ=${report2.summary.pageIssues - report1.summary.pageIssues}`);
    lines.push('');

    // Compare issue types
    lines.push('─ Issues by Type (differences only) ─');

    const allIssueTypes = new Set([
        ...report1.summary.issuesByType.keys(),
        ...report2.summary.issuesByType.keys(),
    ]);

    const differences = [];
    const onlyInA = [];
    const onlyInB = [];

    for (const issueType of allIssueTypes) {
        const countA = report1.summary.issuesByType.get(issueType) ?? 0;
        const countB = report2.summary.issuesByType.get(issueType) ?? 0;

        if (countA !== countB) {
            if (countA === 0) {
                onlyInB.push({ name: issueType, count: countB });
            } else if (countB === 0) {
                onlyInA.push({ name: issueType, count: countA });
            } else {
                differences.push({ name: issueType, countA, countB, delta: countB - countA });
            }
        }
    }

    if (differences.length === 0 && onlyInA.length === 0 && onlyInB.length === 0) {
        lines.push('  No differences in issue types!');
    } else {
        if (differences.length > 0) {
            lines.push('  Changed counts:');
            for (const diff of differences.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))) {
                const sign = diff.delta > 0 ? '+' : '';
                lines.push(`    ${diff.name}: ${diff.countA} → ${diff.countB} (${sign}${diff.delta})`);
            }
        }

        if (onlyInA.length > 0) {
            lines.push('');
            lines.push('  Only in Report A:');
            for (const item of onlyInA.sort((a, b) => b.count - a.count)) {
                lines.push(`    ${item.count} × ${item.name}`);
            }
        }

        if (onlyInB.length > 0) {
            lines.push('');
            lines.push('  Only in Report B:');
            for (const item of onlyInB.sort((a, b) => b.count - a.count)) {
                lines.push(`    ${item.count} × ${item.name}`);
            }
        }
    }

    // Compare per-page
    lines.push('');
    lines.push('─ Per-Page Comparison ─');

    const allPages = new Set([...report1.summary.pages, ...report2.summary.pages]);
    const sortedPages = [...allPages].sort((a, b) => a - b);

    for (const pageNum of sortedPages) {
        const countA = report1.pageIssues.get(pageNum)?.issueCount ?? 0;
        const countB = report2.pageIssues.get(pageNum)?.issueCount ?? 0;

        if (countA !== countB) {
            const sign = countB - countA > 0 ? '+' : '';
            lines.push(`  Page ${pageNum}: ${countA} → ${countB} (${sign}${countB - countA})`);
        } else {
            lines.push(`  Page ${pageNum}: ${countA} (unchanged)`);
        }
    }

    lines.push('');
    lines.push('═'.repeat(80));

    return lines.join('\n');
}

/**
 * Convert report to JSON-serializable object
 * @param {PreflightReport} report
 * @returns {object}
 */
function toJSON(report) {
    return {
        filename: report.filename,
        pages: report.pages,
        profile: report.profile,
        document: {
            issueCount: report.document.issueCount,
            issues: report.document.issues,
        },
        pageIssues: Object.fromEntries(
            [...report.pageIssues.entries()].map(([page, section]) => [
                page,
                { issueCount: section.issueCount, issues: section.issues },
            ])
        ),
        summary: {
            totalIssues: report.summary.totalIssues,
            documentIssues: report.summary.documentIssues,
            pageIssues: report.summary.pageIssues,
            issuesByType: Object.fromEntries(report.summary.issuesByType),
            pages: report.summary.pages,
        },
    };
}

async function main() {
    // Show help if requested or no arguments
    if (positionals.length === 0 || options['help']) {
        console.log(`
Usage:
  node scripts/parse-preflight-report.js <report.txt>                     Show summary
  node scripts/parse-preflight-report.js <report.txt> --json              Output as JSON
  node scripts/parse-preflight-report.js <report1.txt> <report2.txt>      Compare reports
  node scripts/parse-preflight-report.js --help                           Show this help

Options:
  --json      Output parsed report as JSON
  --compare   Compare two reports (implicit when two files provided)
  -h, --help  Show this help message
`);
        return;
    }

    const files = positionals;
    const isJson = options['json'];
    const isCompare = options['compare'] || files.length >= 2;

    if (files.length === 0) {
        console.error('Error: No report file specified');
        process.exit(1);
    }

    // Load first report
    const text1 = await readFile(files[0], 'utf-8');
    const report1 = parsePreflightReport(text1);

    if (isCompare && files.length >= 2) {
        // Compare mode
        const text2 = await readFile(files[1], 'utf-8');
        const report2 = parsePreflightReport(text2);

        if (isJson) {
            console.log(JSON.stringify({
                reportA: toJSON(report1),
                reportB: toJSON(report2),
            }, null, 2));
        } else {
            console.log(compareReports(report1, report2));
        }
    } else {
        // Single report mode
        if (isJson) {
            console.log(JSON.stringify(toJSON(report1), null, 2));
        } else {
            console.log(formatSummary(report1));
        }
    }
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
