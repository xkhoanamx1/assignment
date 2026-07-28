import os

import requests

key = os.environ.get('GEMINI_API_KEY')
if not key:
    raise SystemExit('Set GEMINI_API_KEY before running this script.')

url = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={key}'
payload = {
    'contents': [
        {'parts': [{'text': 'Reply with JSON: {"answer":"ok","explanation":"test"}'}]}
    ]
}

try:
    r = requests.post(url, json=payload, timeout=30)
    print('status', r.status_code)
    print(r.text)
except Exception as e:
    print('ERROR', e)
