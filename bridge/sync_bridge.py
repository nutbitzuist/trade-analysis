#!/usr/bin/env python3
"""
Trade Sync Bridge
Watches for trade data files from MT4 EA and sends them to the dashboard API.

Usage:
    python sync_bridge.py --mt4-folder "C:/Users/YourName/AppData/Roaming/MetaQuotes/Terminal/XXXXX/MQL4/Files/TradeSync"
    
Or set the MT4_FILES_FOLDER environment variable.
"""

import os
import sys
import json
import time
import argparse
import requests
from pathlib import Path
from datetime import datetime

# Configuration
API_URL = os.environ.get('API_URL', 'http://localhost:3001/api/sync')
POLL_INTERVAL = 5  # seconds

def find_mt4_files_folder():
    """Try to find MT4 Files folder automatically on Windows."""
    if sys.platform == 'win32':
        appdata = os.environ.get('APPDATA', '')
        mq_path = Path(appdata) / 'MetaQuotes' / 'Terminal'
        
        if mq_path.exists():
            # Find all terminal folders
            for terminal_folder in mq_path.iterdir():
                if terminal_folder.is_dir():
                    files_folder = terminal_folder / 'MQL4' / 'Files' / 'TradeSync'
                    if files_folder.exists():
                        return str(files_folder)
    
    return None

def send_to_api(data: dict) -> bool:
    """Send trade data to the dashboard API."""
    try:
        response = requests.post(
            API_URL,
            json=data,
            headers={'Content-Type': 'application/json'},
            timeout=10
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"[OK] Synced {result.get('synced', 0)} trades")
            return True
        else:
            print(f"[ERROR] API returned {response.status_code}: {response.text}")
            return False
            
    except requests.exceptions.ConnectionError:
        print(f"[ERROR] Cannot connect to API at {API_URL}")
        print("        Make sure the backend server is running (npm run server)")
        return False
    except Exception as e:
        print(f"[ERROR] {e}")
        return False

def process_trade_file(filepath: Path) -> bool:
    """Read and process a trade JSON file."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read().strip()
            
        if not content:
            return False
            
        data = json.loads(content)
        
        api_key = data.get('api_key', 'unknown')
        trades_count = len(data.get('trades', []))
        account_info = data.get('account_info', {})
        
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Processing file: {filepath.name}")
        print(f"    API Key: {api_key[:8]}...")
        print(f"    Account: {account_info.get('account_number', 'N/A')}")
        print(f"    Balance: ${account_info.get('balance', 0):.2f}")
        print(f"    Trades: {trades_count}")
        
        return send_to_api(data)
        
    except json.JSONDecodeError as e:
        print(f"[ERROR] Invalid JSON in {filepath}: {e}")
        return False
    except Exception as e:
        print(f"[ERROR] Failed to process {filepath}: {e}")
        return False

def watch_folder(folder_path: str):
    """Watch folder for new trade data files."""
    folder = Path(folder_path)
    
    if not folder.exists():
        print(f"[ERROR] Folder does not exist: {folder}")
        print("\nMake sure:")
        print("1. The TradeSyncFile EA is attached to a chart in MT4")
        print("2. The EA has written at least one sync")
        print(f"3. The folder path is correct")
        sys.exit(1)
    
    print(f"\n{'='*60}")
    print("Trade Sync Bridge")
    print(f"{'='*60}")
    print(f"Watching: {folder}")
    print(f"API URL:  {API_URL}")
    print(f"Poll interval: {POLL_INTERVAL}s")
    print(f"{'='*60}")
    print("\nWaiting for trade data from MT4...")
    print("(Make sure TradeSyncFile EA is running in MT4)\n")
    
    processed_flags = set()
    
    while True:
        try:
            # Look for flag files that indicate new data
            for flag_file in folder.glob('ready_*.flag'):
                if str(flag_file) not in processed_flags:
                    # Extract API key from filename
                    api_key = flag_file.stem.replace('ready_', '')
                    trade_file = folder / f'trades_{api_key}.json'
                    
                    if trade_file.exists():
                        if process_trade_file(trade_file):
                            processed_flags.add(str(flag_file))
                            # Remove flag file after processing
                            try:
                                flag_file.unlink()
                            except:
                                pass
            
            # Also check for trade files directly (in case flag wasn't created)
            for trade_file in folder.glob('trades_*.json'):
                # Check if file was modified recently (within last poll interval * 2)
                mtime = trade_file.stat().st_mtime
                if time.time() - mtime < POLL_INTERVAL * 2:
                    flag_key = f"direct_{trade_file.name}_{mtime}"
                    if flag_key not in processed_flags:
                        if process_trade_file(trade_file):
                            processed_flags.add(flag_key)
            
            time.sleep(POLL_INTERVAL)
            
        except KeyboardInterrupt:
            print("\n\nBridge stopped.")
            break
        except Exception as e:
            print(f"[ERROR] {e}")
            time.sleep(POLL_INTERVAL)

def main():
    parser = argparse.ArgumentParser(description='MT4 Trade Sync Bridge')
    parser.add_argument(
        '--mt4-folder', 
        type=str,
        help='Path to MT4 MQL4/Files/TradeSync folder'
    )
    parser.add_argument(
        '--api-url',
        type=str,
        default=API_URL,
        help=f'Dashboard API URL (default: {API_URL})'
    )
    parser.add_argument(
        '--interval',
        type=int,
        default=POLL_INTERVAL,
        help=f'Poll interval in seconds (default: {POLL_INTERVAL})'
    )
    
    args = parser.parse_args()
    
    global API_URL, POLL_INTERVAL
    API_URL = args.api_url
    POLL_INTERVAL = args.interval
    
    # Determine MT4 folder
    mt4_folder = args.mt4_folder or os.environ.get('MT4_FILES_FOLDER')
    
    if not mt4_folder:
        # Try to find automatically
        mt4_folder = find_mt4_files_folder()
        
    if not mt4_folder:
        print("ERROR: MT4 Files folder not specified.")
        print("\nPlease provide the path to your MT4 MQL4/Files/TradeSync folder:")
        print("  python sync_bridge.py --mt4-folder \"C:/path/to/MQL4/Files/TradeSync\"")
        print("\nTo find this folder:")
        print("  1. In MT4, go to File -> Open Data Folder")
        print("  2. Navigate to MQL4/Files/TradeSync")
        print("  3. Copy the full path")
        sys.exit(1)
    
    watch_folder(mt4_folder)

if __name__ == '__main__':
    main()
