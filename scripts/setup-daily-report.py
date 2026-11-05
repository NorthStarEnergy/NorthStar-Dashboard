"""Configure a local XLSM template and browser runtime; enable the requested Eastern schedule."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import northstar_daily_report as report
import northstar_report_workbook as workbook

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--template',type=Path,required=True)
    p.add_argument('--node',default='node')
    p.add_argument('--playwright-module',default='playwright')
    p.add_argument('--browser-channel',default='msedge',choices=['msedge','chrome','chromium'])
    p.add_argument('--reading-timezone',default='America/New_York',choices=['America/Winnipeg','America/New_York'])
    p.add_argument('--enable',action='store_true')
    p.add_argument('--replace',action='store_true',help='Explicitly replace an existing template configuration')
    args=p.parse_args();template=args.template.resolve();targets=workbook.inspect_template(template)
    report.home().mkdir(parents=True,exist_ok=True);path=report.home()/'config.json'
    if path.exists() and not args.replace:raise SystemExit('Configuration already exists; use --replace after reviewing the template')
    report.write_json(path,dict(template=str(template),node=args.node,playwrightModule=args.playwright_module,browserChannel=args.browser_channel))
    report.save_settings(dict(enabled=args.enable,time='06:30',timezone='America/New_York',readingTimezone=args.reading_timezone,retryMinutes=60),'local-setup')
    print(f'Configured {len(targets)} image targets; daily 06:30 Eastern, hourly retries until noon; enabled={args.enable}')
if __name__=='__main__':main()
