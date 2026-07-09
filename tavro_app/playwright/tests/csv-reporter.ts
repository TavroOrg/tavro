import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.resolve(__dirname, '../test-results-api');
const CSV_FILE    = path.join(RESULTS_DIR, 'results.csv');

type Row = {
  Suite:              string;
  Test:               string;
  Status:             string;
  Duration_s:         string;
  Error:              string;
  Likely_Cause:       string;
  Recommended_Action: string;
};

function cleanError(msg: string | undefined): string {
  if (!msg) return '';
  return msg
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\r\n|\n|\r/g, ' ')
    .slice(0, 250);
}

function formatStatus(status: string): string {
  if (status === 'passed') return 'Pass';
  if (status === 'failed') return 'Fail';
  if (status === 'timedOut') return 'TimedOut';
  return status;
}

function likelyCause(status: string, err: string): string {
  if (status === 'passed') return 'N/A';
  if (err.includes('ECONNREFUSED') || err.includes('fetch failed')) return 'Backend not reachable — is tavro_api running?';
  if (err.includes('toBe(404)') || err.includes('expected 404')) return 'Cross-tenant/cross-company record leaked — isolation not enforced';
  if (err.includes('toBe(200)') || err.includes('toBe(201)')) return 'Unexpected status code — check request payload/headers';
  return 'Business-logic assertion failed — inspect the Error column for details';
}

function recommendedAction(status: string, err: string): string {
  if (status === 'passed') return 'No action needed';
  if (err.includes('ECONNREFUSED') || err.includes('fetch failed')) return 'Start the backend: docker compose up -d api';
  if (err.includes('leak') || err.includes('404')) return 'Review company_id/tenant_id WHERE clauses in the relevant router for the global-record OR-clause bug';
  return 'Re-run with --debug and inspect the failing request/response pair';
}

class CsvReporter implements Reporter {
  private rows: Row[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    const suite = test.parent?.title ?? '';
    const err   = cleanError(result.errors?.[0]?.message);

    this.rows.push({
      Suite:              suite,
      Test:               test.title,
      Status:             formatStatus(result.status),
      Duration_s:         (result.duration / 1000).toFixed(2),
      Error:              err,
      Likely_Cause:       likelyCause(result.status, err),
      Recommended_Action: recommendedAction(result.status, err),
    });
  }

  onEnd(_result: FullResult): void {
    if (this.rows.length === 0) return;

    fs.mkdirSync(RESULTS_DIR, { recursive: true });

    const headers: (keyof Row)[] = [
      'Suite', 'Test', 'Status', 'Duration_s', 'Error', 'Likely_Cause', 'Recommended_Action',
    ];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines  = [
      headers.join(','),
      ...this.rows.map(r => headers.map(h => escape(r[h])).join(',')),
    ];

    // BOM tells Excel to read the file as UTF-8 instead of Windows-1252
    fs.writeFileSync(CSV_FILE, '﻿' + lines.join('\n'), 'utf8');

    const passed   = this.rows.filter(r => r.Status === 'Pass').length;
    const failed   = this.rows.filter(r => r.Status === 'Fail').length;
    const timedOut = this.rows.filter(r => r.Status === 'TimedOut').length;

    console.log(`\n[csv-reporter] Results saved -> ${CSV_FILE}`);
    console.log(`               Total: ${this.rows.length}  Passed: ${passed}  Failed: ${failed}  TimedOut: ${timedOut}`);
  }
}

export default CsvReporter;
