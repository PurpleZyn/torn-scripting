# Torn Financial Analyzer

Version 1.0.1 — read-only Tampermonkey userscript for exporting a financial snapshot and historical activity from Torn's official API.

## Installation

[Install or update the userscript](https://raw.githubusercontent.com/PurpleZyn/torn-scripting/main/financial-analyzer/financial-analyzer.user.js). Open the link in a browser with Tampermonkey enabled, confirm installation, and refresh Torn. If a previous local copy remains enabled, disable the duplicate. Future releases use the stable raw URL in the update metadata.

## Usage

Open Financial Analyzer in the lower-right corner of Torn, enter a dedicated API key with Full Access or the necessary custom selections, select the history window (30, 60, 90 or 180 days), and click Collect report. To obtain a financial report, keep inventory enabled and leave all activity logs unchecked. Download JSON when collection finishes. Warnings are included in the output; inspect them before treating a report as complete.

## Privacy

Requests go only to Torn's official API. Saving the key in Tampermonkey is optional. The key is redacted from exports, but exported reports can contain private gameplay information. Review reports before sharing and never commit them or API keys to this public repository.

## Status

Version 1.0.1 addresses issues identified in the first live report. Syntax checked; revised inventory and history collection still require live-account verification. Reports contain raw financial evidence, not reconciled profit.

[Changelog](CHANGELOG.md)
