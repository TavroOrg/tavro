import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import fs from 'fs';
import path from 'path';

const RESULTS_DIR = path.resolve('test-results-e2e');
const CSV_FILE    = path.join(RESULTS_DIR, 'results.csv');

type Row = {
  Environment:        string;
  Project:            string;
  File:               string;
  Suite:              string;
  Test:               string;
  Status:             string;
  Duration_s:         string;
  Error:              string;
  Likely_Cause:       string;
  Recommended_Action: string;
  Next_Step:          string;
};

function cleanError(msg: string | undefined): string {
  if (!msg) return '';
  return msg
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\r\n|\n|\r/g, ' ')
    .slice(0, 250);
}

function likelyCause(status: string, file: string, err: string): string {
  if (status === 'passed') return 'N/A';
  if (status === 'timedOut') return 'Element or navigation not found within timeout';
  if (err.includes('toHaveURL')) return 'Route did not navigate to expected URL';
  if (err.includes('toBeVisible')) return 'Expected element not visible in DOM';
  if (err.includes('toHaveLength') || err.includes('toHaveCount')) return 'Count mismatch — UI rendered unexpected number of elements';
  if (err.includes('401') || err.includes('403')) return 'Auth token rejected by backend — check token validity';
  if (err.includes('ECONNREFUSED') || err.includes('fetch failed')) return 'Backend not reachable — is the Docker stack running?';
  if (file.includes('api')) return 'Backend API returned unexpected status or shape';
  return 'Unexpected failure — inspect the Error column for details';
}

function recommendedAction(status: string, file: string, suite: string, err: string): string {
  if (status === 'passed') return 'No action needed';
  if (err.includes('ECONNREFUSED') || err.includes('fetch failed')) return 'Start Docker stack: docker compose up -d';
  if (err.includes('401') || err.includes('403')) return 'Verify E2E_USERNAME and E2E_PASSWORD are correct in .env.e2e';
  if (file.includes('auth')) return 'Check Zitadel credentials and login form selectors in auth.real.setup.ts';
  if (suite.includes('Backend API')) return 'Confirm E2E_API_URL=http://localhost:8000 in .env.e2e and backend is healthy';
  if (suite.includes('Catalog')) return 'Check MCP token is set after login and MCP server is running';
  if (suite.includes('Navigation')) return 'Check route component for crash or infinite redirect';
  return 'Run npm run test:e2e:debug to step through the failure';
}

function nextStep(status: string, suite: string, err: string): string {
  if (status === 'passed') return 'Monitor for regressions';
  if (err.includes('ECONNREFUSED')) return 'docker compose ps — check which containers are not running';
  if (err.includes('401')) return 'Decode the JWT at jwt.io and verify exp and iss match Zitadel config';
  if (suite.includes('Backend API')) return 'curl http://localhost:8000/api/v1/agents -H "Authorization: Bearer <token>" to test directly';
  if (suite.includes('Auth')) return 'Run npm run test:e2e:headed and watch the Zitadel login form';
  return 'Run npm run test:e2e:report to open the full HTML trace';
}

class CsvReporter implements Reporter {
  private rows: Row[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    const file  = path.basename(test.location.file);
    const suite = test.parent?.title ?? '';
    const err   = cleanError(result.errors?.[0]?.message);

    this.rows.push({
      Environment:        process.env.E2E_BASE_URL || 'http://localhost:9000',
      Project:            test.parent?.project()?.name ?? '',
      File:               file,
      Suite:              suite,
      Test:               test.title,
      Status:             result.status.toUpperCase(),
      Duration_s:         (result.duration / 1000).toFixed(2),
      Error:              err,
      Likely_Cause:       likelyCause(result.status, file, err),
      Recommended_Action: recommendedAction(result.status, file, suite, err),
      Next_Step:          nextStep(result.status, suite, err),
    });
  }

  onEnd(_result: FullResult): void {
    if (this.rows.length === 0) return;

    fs.mkdirSync(RESULTS_DIR, { recursive: true });

    const headers: (keyof Row)[] = [
      'Project', 'File', 'Suite', 'Test', 'Status',
      'Duration_s', 'Error', 'Likely_Cause', 'Recommended_Action', 'Next_Step', 'Environment',
    ];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines  = [
      headers.join(','),
      ...this.rows.map(r => headers.map(h => escape(r[h])).join(',')),
    ];

    // BOM tells Excel to read the file as UTF-8 instead of Windows-1252
    fs.writeFileSync(CSV_FILE, '﻿' + lines.join('\n'), 'utf8');

    const passed   = this.rows.filter(r => r.Status === 'PASSED').length;
    const failed   = this.rows.filter(r => r.Status === 'FAILED').length;
    const timedOut = this.rows.filter(r => r.Status === 'TIMEDOUT').length;

    console.log(`\n[csv-reporter] Results saved → ${CSV_FILE}`);
    console.log(`               Total: ${this.rows.length}  Passed: ${passed}  Failed: ${failed}  TimedOut: ${timedOut}`);
  }
}

export default CsvReporter;
